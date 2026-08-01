// A compact OpenAPI 3.0 validator for the subset `api/openapi.yaml` uses.
//
// # Why this exists rather than a JSON-schema library
//
// The Go side validates every response against the contract with
// `getkin/kin-openapi`. Without an equivalent here, the client fixtures would be
// "shapes I typed", and the claim that they mirror the server would rest on my
// having transcribed them correctly. This validator closes that gap: it reads
// THE CONTRACT and enforces the two conventions the contract's own header calls
// load-bearing —
//
//   `additionalProperties: false` on every object, so an unknown field is a
//   failure rather than something a permissive schema ignores; and
//
//   the `Decimal` pattern, so a money quantity serialized as a JSON number is
//   caught (that is exactly `TestContractValidatorCanReject`'s second case).
//
// It supports what the contract uses and nothing more: $ref, type, enum,
// pattern, nullable, required, properties, additionalProperties, items, allOf,
// format: date-time, and integer/number minimum/maximum. Anything it meets that
// it does not understand is reported as an ERROR, so it can never silently pass
// a construct it cannot check.

import { readFileSync } from "node:fs";

import { parse } from "yaml";

interface Schema {
  $ref?: string;
  type?: string;
  enum?: unknown[];
  pattern?: string;
  format?: string;
  nullable?: boolean;
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  items?: Schema;
  allOf?: Schema[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  description?: string;
  [key: string]: unknown;
}

/** Keys a schema may carry that carry no constraint we need to enforce. */
const IGNORED_KEYS = new Set(["description", "summary", "title", "example", "default", "deprecated"]);

const SUPPORTED_KEYS = new Set([
  "$ref",
  "type",
  "enum",
  "pattern",
  "format",
  "nullable",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "allOf",
  "minimum",
  "maximum",
  "minItems",
]);

export interface Contract {
  /** Resolve a response schema for `path` + status, e.g. ("/v1/book", 200). */
  schemaFor(path: string, status: number): Schema;
  /** A named component schema, e.g. "StreamPayload". */
  component(name: string): Schema;
  validate(schema: Schema, value: unknown): string[];
  /** The contract's `info.version`. */
  version: string;
}

interface Document {
  info: { version: string };
  paths: Record<string, Record<string, { responses: Record<string, ResponseObject> }>>;
  components: {
    schemas: Record<string, Schema>;
    responses: Record<string, ResponseObject>;
    parameters?: Record<string, unknown>;
  };
}

interface ResponseObject {
  $ref?: string;
  content?: Record<string, { schema: Schema }>;
}

export function loadContract(contractPath: string): Contract {
  const doc = parse(readFileSync(contractPath, "utf8")) as Document;

  const deref = <T>(node: T & { $ref?: string }): T => {
    let cur = node;
    let hops = 0;
    while (cur.$ref !== undefined) {
      if (++hops > 32) throw new Error(`$ref cycle at ${String(cur.$ref)}`);
      const ref = cur.$ref;
      const parts = ref.replace(/^#\//, "").split("/");
      let target: unknown = doc;
      for (const part of parts) {
        target = (target as Record<string, unknown>)[part];
        if (target === undefined) throw new Error(`unresolvable $ref ${ref}`);
      }
      cur = target as T & { $ref?: string };
    }
    return cur;
  };

  const contract: Contract = {
    version: doc.info.version,

    component(name) {
      const schema = doc.components.schemas[name];
      if (schema === undefined) throw new Error(`no component schema named ${name}`);
      return schema;
    },

    schemaFor(path, status) {
      const item = doc.paths[path];
      if (item === undefined) throw new Error(`contract has no path ${path}`);
      const op = item["get"];
      if (op === undefined) throw new Error(`contract has no GET on ${path}`);
      const response = op.responses[String(status)];
      if (response === undefined) throw new Error(`contract has no ${status} on GET ${path}`);
      const resolved = deref(response);
      const content = resolved.content?.["application/json"];
      if (content === undefined) {
        throw new Error(`GET ${path} ${status} has no application/json response schema`);
      }
      return content.schema;
    },

    validate(schema, value) {
      const errors: string[] = [];
      walk(schema, value, "$", errors);
      return errors;
    },
  };

  /** Merge an `allOf` chain (the contract uses it only for nullable + $ref). */
  function flatten(schema: Schema): Schema {
    const resolved = deref(schema);
    if (resolved.allOf === undefined) return resolved;
    const merged: Schema = {};
    for (const [key, v] of Object.entries(resolved)) {
      if (key !== "allOf") merged[key] = v;
    }
    for (const part of resolved.allOf) {
      const flat = flatten(part);
      for (const [key, v] of Object.entries(flat)) {
        if (key === "required") {
          merged.required = [...(merged.required ?? []), ...(v as string[])];
        } else if (key === "properties") {
          merged.properties = { ...(merged.properties ?? {}), ...(v as Record<string, Schema>) };
        } else if (merged[key] === undefined) {
          merged[key] = v;
        }
      }
    }
    return merged;
  }

  function walk(raw: Schema, value: unknown, path: string, errors: string[]): void {
    const schema = flatten(raw);

    for (const key of Object.keys(schema)) {
      if (!SUPPORTED_KEYS.has(key) && !IGNORED_KEYS.has(key)) {
        errors.push(`${path}: this validator does not understand schema keyword \`${key}\` — refusing to pass it`);
      }
    }

    if (value === null) {
      if (schema.nullable !== true) errors.push(`${path}: null is not permitted (nullable is not set)`);
      return;
    }

    if (schema.enum !== undefined && !schema.enum.includes(value)) {
      errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
    }

    switch (schema.type) {
      case "object": {
        if (typeof value !== "object" || Array.isArray(value)) {
          errors.push(`${path}: expected an object, got ${describe(value)}`);
          return;
        }
        const obj = value as Record<string, unknown>;
        const props = schema.properties ?? {};
        for (const key of schema.required ?? []) {
          if (!(key in obj)) errors.push(`${path}.${key}: required property is absent`);
        }
        if (schema.additionalProperties === false) {
          for (const key of Object.keys(obj)) {
            if (!(key in props)) {
              errors.push(`${path}.${key}: unknown property (additionalProperties is false)`);
            }
          }
        } else if (schema.additionalProperties !== undefined) {
          errors.push(`${path}: additionalProperties must be false on every object in this contract`);
        }
        for (const [key, sub] of Object.entries(props)) {
          if (key in obj) walk(sub, obj[key], `${path}.${key}`, errors);
        }
        return;
      }
      case "array": {
        if (!Array.isArray(value)) {
          errors.push(`${path}: expected an array, got ${describe(value)}`);
          return;
        }
        if (schema.items === undefined) {
          errors.push(`${path}: array schema has no \`items\``);
          return;
        }
        // 1.2.2: the sweep-disclosure law licenses liquidatable counts
        // through required watermark arrays, so their non-emptiness is part
        // of the CONTRACT (minItems) and this validator enforces it — an
        // empty vector under minItems is a licence with no evidence behind
        // it.
        if (schema.minItems !== undefined && value.length < schema.minItems) {
          errors.push(`${path}: array has ${value.length} item(s), below minItems ${schema.minItems}`);
        }
        value.forEach((element, i) => walk(schema.items as Schema, element, `${path}[${i}]`, errors));
        return;
      }
      case "string": {
        if (typeof value !== "string") {
          errors.push(`${path}: expected a string, got ${describe(value)}`);
          return;
        }
        if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
          errors.push(`${path}: ${JSON.stringify(value)} does not match /${schema.pattern}/`);
        }
        if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
          errors.push(`${path}: ${JSON.stringify(value)} is not an RFC 3339 date-time`);
        }
        return;
      }
      case "integer": {
        if (typeof value !== "number" || !Number.isInteger(value)) {
          errors.push(`${path}: expected an integer, got ${describe(value)}`);
          return;
        }
        checkRange(schema, value, path, errors);
        return;
      }
      case "number": {
        if (typeof value !== "number" || Number.isNaN(value)) {
          errors.push(`${path}: expected a number, got ${describe(value)}`);
          return;
        }
        checkRange(schema, value, path, errors);
        return;
      }
      case "boolean": {
        if (typeof value !== "boolean") errors.push(`${path}: expected a boolean, got ${describe(value)}`);
        return;
      }
      case undefined: {
        // A schema with no type and no allOf constrains nothing; the contract has
        // none, so meeting one means the document changed shape.
        errors.push(`${path}: schema has no \`type\` — this validator will not pass an unconstrained node`);
        return;
      }
      default:
        errors.push(`${path}: unsupported schema type ${String(schema.type)}`);
    }
  }

  function checkRange(schema: Schema, value: number, path: string, errors: string[]): void {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: ${value} is below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: ${value} is above maximum ${schema.maximum}`);
    }
  }

  return contract;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value} (${JSON.stringify(value)})`;
}
