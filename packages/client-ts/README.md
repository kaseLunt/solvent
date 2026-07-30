# `@solvent/client`

A typed TypeScript client for the **Solvent Risk API** — a read-only view of
ether.fi lending risk across the Aave v3 ether.fi market (Ethereum) and the
ether.fi Debt Manager (Optimism).

**Not published.** `private: true` in `package.json` holds until P5. This package
is *built and proven* — typecheck clean, tests green, `npm pack` produces a
tarball — but nothing is on a registry, and `npm publish` is deliberately not
wired up. See [Publishing (P5)](#publishing-p5).

## What it is

`api/openapi.yaml` at the repository root **is the contract**. Every type here is
generated from it by [`openapi-typescript`](https://openapi-ts.dev); the
hand-written layer is thin and does four things:

- **`fetch`-based client** for the six routes, with zero runtime dependencies.
- **Typed errors** carrying machine-readable fields — a 429 with its
  `Retry-After`, a 503 that says it is about the *service* and not about an empty
  book, a network failure that is distinguishable from a server refusal, and a
  contract-mismatch refusal.
- **SSE client** with snapshot-on-connect semantics surfaced to the consumer,
  jittered reconnect backoff, and heartbeat-timeout detection.
- **Exact bigint helpers** that parse the contract's decimal strings without loss
  and **throw rather than round**.

### No money as a number. Anywhere.

Every money quantity in the contract is a decimal **string**. Health factors are
18-decimal integers, Aave base values 8-decimal, Debt Manager USD 6-decimal —
several are wider than an IEEE-754 double carries losslessly.

This client never converts one. Responses come back exactly as the wire carried
them, and the helpers in `src/decimal.ts` are opt-in and refuse on loss:

```ts
import { formatUnits, toNumber, parseDecimal, PrecisionLossError } from "@solvent/client";

const hf = "1080000000000000000";        // 1.08, 18-decimal

parseDecimal(hf);                         // 1080000000000000000n — exact
formatUnits(hf, 18);                      // "1.080000000000000000"
formatUnits(hf, 18, { trim: true });      // "1.08"
toNumber(hf);                             // throws PrecisionLossError
```

That last line is the point, and the reason is subtler than it looks:
`1080000000000000000` *is* exactly representable as a double. But it sits above
`Number.MAX_SAFE_INTEGER`, so `x + 1 === x` — handing it back as a `number` would
be rounding one step later. `toNumber` therefore admits only the safe-integer
range, and is for counts, block numbers and seconds. Never for money.

The same rule runs through the rest of the module: `rescale` refuses a narrowing
that would drop a non-zero digit, `parseUnits` refuses a literal with more
fractional digits than the scale admits, and `compareRatio` compares by
cross-multiplication so no ratio is ever reduced to a float.

### Absent is not zero

The contract distinguishes them, and so does this client. `parseNullableDecimal`
returns `null` for `null`; `requireDecimal` throws `AbsentQuantityError` rather
than substituting `0n`. A withheld engine serves `total_collateral: null` — never
`"0"` — and nothing here turns that into a number.

`positionEligible(position)` returns `boolean | null`, using each engine's own
comparator and never blending them: the Debt Manager's strict `liquidatable`
boolean, or Aave's `health_factor.wad < 1e18` on the wad. A refused or
never-swept position returns `null`, because the service withheld a verdict and
this client does not invent one.

## Quickstart against a local `cmd/api`

From the repository root:

```bash
make db-up                 # Postgres
make run-api               # cmd/api on :8080  (needs a materialized risk batch)
```

Then, in this package:

```bash
npm install
npm run verify             # typecheck + tests + build
```

```ts
import { SolventClient, formatUnits, positionEligible } from "@solvent/client";

const client = new SolventClient({
  baseUrl: "http://localhost:8080",
  // Optional: refuse to interpret a payload from a server this client was not built against.
  expectedSchemaVersion: 14,
  expectedScenarioConfigVersion: "v1",
});

const book = await client.book();
for (const engine of book.engines) {
  if (engine.refused) {
    console.log(`${engine.engine}: WITHHELD — ${engine.refusal?.code}`);
    continue;                                     // totals are null, not zero
  }
  console.log(
    engine.engine,
    formatUnits(engine.total_collateral!, engine.value_decimals),
    `(${engine.refused_positions} refused)`,
  );
}

const result = await client.address("0x70daaac436465a0d03e45916fa68ddee6086e5fe");
if (result.outcome === "found") {
  for (const p of result.response.positions) {
    console.log(p.engine, p.status, positionEligible(p), p.health_factor?.wad);
  }
}
```

### The six routes

| Method | Route |
| --- | --- |
| `client.book()` | `GET /v1/book` — aggregates, HF histogram, liquidation waterfall, bad-debt line |
| `client.address(addr)` | `GET /v1/address/{addr}` — positions, as-ofs, per-input price disclosures, as a **discriminated lookup** |
| `client.addressStress(addr)` | `GET /v1/address/{addr}/stress` — the committed scenario set, as a **discriminated lookup** |
| `client.addressRaw(addr)` / `client.addressStressRaw(addr)` | The same routes' **raw wire bodies** — `found` still `boolean \| null`, no invariant enforcement. For persistence and forensics, never for rendering |
| `client.observatory({ limit })` | `GET /v1/observatory` — per-engine TVL, counts, rate indexes |
| `client.stream(opts)` | `GET /v1/stream` — SSE |
| `client.meta()` | `GET /v1/meta` — watermark vector, reorg posture, price state, constants |

An address with no position answers `200`, not `404`: "no position in this batch"
is an **answer**, and it arrives with the batch that answered it.

### `found` is three-valued, and `!found` is a bug

On `/v1/address/{addr}` and its `/stress` sibling, `found` is `true`, `false`, **or
`null`**. `true` is a positive existence claim. `false` is a *definitive* negative
— no position exists, and every engine was available to be asked. `null` means
**the answer cannot be established**, because a relevant engine's whole book is
withheld; `withheld_engines` names which, and `lookup_complete` is the one-bit
form. Rendering `null` as "no position" publishes a false negative on a
liquidation surface, which is the whole reason the third state exists.

The nullable type is a deliberate breaking change, and on its own it protects
nobody: `if (!found)` takes the same branch for `false` and `null`, and
TypeScript raises nothing, because `!null` is legal. So the primary methods do
not hand back the raw body at all: `address()` and `addressStress()` return a
**sealed discriminated union**. `outcome` has three cases and no boolean
anywhere; `found` is each arm's *literal* (`true`, `false`, `null`), so
`result.found === false` narrows to the one arm where "no position" is true;
and the wide `boolean | null` field is unreachable from every arm —
`result.response` carries everything else the wire said, with `found` sealed
off at the type level *and* at runtime. Branch on `outcome` or on
`found === false`. Never on falsiness.

```ts
const result = await client.address(addr);
switch (result.outcome) {
  case "found":
    // `complete` false means the positions are a FLOOR, not a total —
    // another engine may hold more and could not be consulted.
    render(result.response.positions, { atLeast: !result.complete });
    break;
  case "not-found":
    renderNoPosition();                        // the only state where this is true
    break;
  case "unknowable":
    renderCannotAnswer(result.withheldEngines); // never "no position"
    break;
}
```

Add a `default: const _: never = result` and the vocabulary growing again becomes
a compile error rather than a silent fall-through. `isDefinitiveNegative(response)`
is the one-line form for the only case in which "no position" is a true thing to
render — deliberately not the negation of anything. The same machinery is
available as the free function `lookup()` for a body obtained elsewhere — e.g.
`lookup(await client.addressRaw(addr))`. The raw accessors are the only surface
that exposes the unrefined three-valued `found`, and their names say so.

The lookup also enforces the contract's own invariants and throws
`ContractInvariantError` on a body that contradicts itself. The completeness law
runs *before* the `found` branch, on every outcome: `lookup_complete: true` with
a non-empty `withheld_engines` is refused (a contradictory *positive* would
render a floor as a total), `lookup_complete: false` naming no withheld engine
is refused (the contract defines the list as the engines the lookup could not
consult, so incompleteness must be attributed), and a `found: false` carrying an
incomplete lookup is exactly the definitive negative the service is not entitled
to publish.

## The event stream

```ts
import { fetchEventSource } from "@solvent/client";

const stream = client.stream({
  eventSourceFactory: fetchEventSource(),   // see the heartbeat note below
  heartbeatTimeoutMs: 45_000,
  reconnect: { minDelayMs: 500, maxDelayMs: 30_000, jitter: 0.5 },

  onSnapshot: (payload, e) => {
    // Sent on EVERY connection, including a reconnect, before any tick.
    if (e.isReconnect) resetView();           // never merge a fresh snapshot into stale state
    if (e.recovered) noteRecovery();          // the server's explicit stale-to-current transition
    render(payload);
  },
  onBatch: (payload) => render(payload),      // "a new batch at watermark vector V" — never "a new block"
  onDegradation: (payload) => showTransitions(payload.transitions ?? []),
  onUnavailable: (payload) => showOutage(payload.reason, payload.stale_since_seconds),
  onHeartbeat: (unix) => (lastSeen = unix),
  onError: (error) => console.warn(error.name, error.message),
});

// later
stream.close();
```

Events are discriminated on the wire event names — `snapshot`, `batch`,
`degradation`, `unavailable` — and each delivered event carries its connection
number, whether that connection was a reconnect, and whether it is the
connect-time snapshot. If a tick ever arrives *before* a snapshot on a
connection, the violation is surfaced through `onError` as a
`StreamProtocolError`, the event is **not** delivered, and the connection is
dropped: a delta over a base this consumer never saw is wrong data, and the
contract guarantees the reconnect's snapshot re-establishes true state. With no
`onError` registered the failure is still not silent — nothing reaches the data
callbacks, and the reconnect is observable through `onStateChange` and the
connection counter.

Reconnection is this client's, not `EventSource`'s. On error the source is closed
(which stops the browser's own fixed-interval retry) and a new connection is
scheduled after a jittered exponential delay — `min(maxDelay, minDelay × 2^n)`,
then a uniform draw from `[base × (1 − jitter), base]`. `jitter: 1` is full
jitter. The backoff resets only once a connection delivers its **base frame**
(the snapshot, or `unavailable`) — an HTTP 200 alone is not evidence of a usable
stream, so a server that accepts and closes before its first frame cannot pin
every failure at attempt one.

### Two transports, and the heartbeat caveat

`heartbeatTimeoutMs` treats a connection with no frame inside the window as dead:
it raises `HeartbeatTimeoutError` and reconnects. What counts as a frame depends
on the transport, and this matters:

- **`fetchEventSource()`** (recommended, bundled, zero dependencies, works in
  Node 20+ and browsers) reads the wire directly and therefore **sees the
  `: heartbeat <unix>` comment frames**. The timeout is a real
  stalled-stream detector, and `onHeartbeat` fires.
- **A native `EventSource`** (the default when no factory is passed) **cannot see
  comment frames at all** — the specification does not expose them to
  JavaScript. The timeout then measures time since the last *named event*, so it
  must be set above the batch cadence or it will fire on a healthy but quiet
  stream. `onHeartbeat` never fires.

`heartbeatTimeoutMs` defaults to `0` (off) precisely because the right value
depends on which of those you chose.

In Node, pass a factory: `fetchEventSource()` is the honest choice, and any
EventSource polyfill also satisfies the `EventSourceLike` interface.

## Errors

Every failure is an instance of `SolventError`. Catch the specific class you can
act on:

| Class | When |
| --- | --- |
| `SolventUsageError` | A malformed address or out-of-range `limit`. Refused **locally**, before a request exists, so a bad address can never become a request for a different account. |
| `SolventNetworkError` | No HTTP response at all — refused connection, DNS, abort, or this client's own timeout (`timedOut` says which). |
| `BadRequestError` (400) | |
| `NotFoundError` (404) | |
| `RateLimitedError` (429) | `retryAfterSeconds` from `Retry-After` or the envelope. **This client never retries on its own** — your backoff policy is yours. |
| `InternalError` (500) | |
| `UnavailableError` (503) | No complete risk batch. A statement about the **service**, never a claim that the book is empty. |
| `MalformedResponseError` | A body that is not the contract's — a proxy's HTML error page, or a 200 that is not JSON. Retains the (truncated) raw body. |
| `ContractInvariantError` | A schema-valid body whose claims contradict each other — a `found: false` over an incomplete lookup. |
| `SchemaVersionMismatchError` | The server's published identity is not the one this client was built against. |
| `PrecisionLossError` / `DecimalFormatError` / `AbsentQuantityError` | From the decimal helpers. |
| `StreamProtocolError` / `HeartbeatTimeoutError` / `StreamTransportError` | From the stream. |

### The schema-version refusal

The client's types come from a specific `api/openapi.yaml`. Serving numbers whose
meaning may have changed underneath them is the failure a contract-first design
exists to prevent, so a mismatch is a **refusal**, not a warning:

```ts
const client = new SolventClient({
  baseUrl,
  expectedSchemaVersion: 14,          // service.schema_version — the goose migration version
  expectedAlgorithmRevision: 4,       // service.algorithm_revision
  expectedScenarioConfigVersion: "v1",
});

await client.meta();                  // throws SchemaVersionMismatchError on any mismatch
await client.assertServerCompatible(); // explicit check; enforces even if refuseOnSchemaMismatch is off
```

`seizure_model` is checked **unconditionally**: the contract's enum admits exactly
one value (`pro-rata-over-counted-collateral`), and a server publishing another is
not this contract. No option switches that off.

## Development

```bash
npm install          # exact versions from package-lock.json
npm run gen          # regenerate src/generated/schema.ts from ../../api/openapi.yaml
npm run typecheck    # tsc --noEmit over src AND test (this is where type-level conformance runs)
npm test             # vitest
npm run build        # tsc emit -> dist/ (the exports map's targets)
npm run verify       # typecheck + test + build
```

`src/generated/schema.ts` is **checked in** so consumers and CI need no codegen
step. `test/drift.test.ts` regenerates from the contract in process and fails if
the two have drifted — a checked-in generated file is only trustworthy if
something breaks when it stops matching its source. That is also why every dev
dependency is pinned to an exact version with no `^`: a floating codegen range
would let the same contract produce different types on a different machine.

There is no `client-ts` target in the root `Makefile`. The package is
self-contained; the commands above are the whole interface. A future wave that
wants one can add:

```make
client-ts:
	cd packages/client-ts && npm ci && npm run verify
```

### What the tests actually prove

| Suite | Claim |
| --- | --- |
| `conformance.test.ts` + the `satisfies` clauses in `test/fixtures/data.ts` | The generated types accept every recorded response — checked by `tsc`. Seven `@ts-expect-error` cases (money as a number, an unknown field, a missing required field, a bad enum, a forbidden null, a nullable read as present, `found` read as a boolean) make the build fail if they *stop* being errors, so "the types compile" is not a statement about a type that accepts anything. |
| `lookup.test.ts` | Three-valued `found` as **contract law**: `null` round-trips as null through the raw accessors on both endpoints, the `!found` trap is demonstrated, all three outcomes discriminate, `found: true` under an incomplete lookup is a floor, the union is SEALED (literal `found` per arm, the wide field off the response), the primary `address()`/`addressStress()` return the discriminated lookup, and self-contradicting bodies — including the contradictory positive — are refused. |
| `fixtures.test.ts` | Every fixture validates against `api/openapi.yaml` itself — `additionalProperties: false`, the `Decimal` pattern, required fields, enums, nullability. Seven negative controls prove the validator can reject. Plus: the committed `.json` bytes and the type-checked literals are the same response. |
| `exact-values.test.ts` | The exact numbers, through the real client. Every asserted value is mirrored from `cmd/api`'s seeded Go suite, so client and server pin **the same** arithmetic. |
| `decimal.test.ts` | Exact round trips, precision-loss refusal, and the negative / zero / max-uint256-scale cases. |
| `sse.test.ts` | Connect, snapshot, tick, degradation, unavailable, reconnect backoff, heartbeat timeout — against a mock transport with injected timers, so the backoff is arithmetic rather than a race. Plus the round-1 laws: no unbased delivery (a pre-snapshot tick is reported, dropped, and reconnected), and retry history resets only on a base frame. |
| `sse-server.test.ts` | The wire parser against a **real HTTP server** emitting the exact bytes `cmd/api/sse.go` writes: `event:`/`id:`/`data:` frames, `: heartbeat` comments, frames split across TCP reads, CRLF, CRLF split **between `\r` and `\n`** at every line boundary for every event type, a pre-snapshot tick dropped and recovered over the wire, repeated 200-then-close connections exhausting `maxAttempts`, and a server that closes the connection. |
| `errors.test.ts` | The whole taxonomy above. |
| `drift.test.ts` | The contract-drift gate, plus package hygiene: zero runtime dependencies, exact dev-dependency pins, `private: true`, and the ESM exports map. |

`test/fixtures/index.ts` carries the **fixture provenance record**: which values
are mirrored from the Go suite, which are derived by the same hand-derivation,
which are illustrative deployment policy, and which cover contract surfaces that
have no committed server expectations yet. Read it before trusting a number in
`test/fixtures/`.

## Publishing (P5)

Out of scope here, and deliberately not wired up. When it happens:

1. Drop `"private": true` from `package.json`.
2. Decide the published name and scope, and whether the repository's `LICENSE`
   allows registry distribution.
3. Add a release workflow that runs `npm run verify`, then `npm publish
   --provenance --access public`.
4. Version deliberately against the contract: a breaking `api/openapi.yaml`
   change is a major bump, because the generated types are the public surface.

Until then, `npm pack` produces the tarball for inspection and nothing leaves the
machine.
