// web/lib/address-lookup.ts
"use client";

// The Inspector's data seam (spec 2026-09-15 §5.3). Every result is keyed by
// the address it answers FOR — a result for another address is simply not
// this page's state — and the position lookup is repaired on resume with its
// own envelope (Wave R4/R6 laws, moved from the old surface). The surface is
// mounted with key={addr} as well; the keying here is the second lock.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AddressLookup, HistoryLookup, StressLookup } from "@solvent/client";
import { getSolventClient, solventBaseUrl } from "./api";
import type { EvidenceManifest } from "./evidence";
import { isAddress } from "./format";
import { receiptIdentity } from "./freshness";
import { fetchAddressHistory, fetchEvents, fetchParams, type ChainEvent, type ParamChange } from "./inspector-data";
import { CASH } from "./inspector-position";
import { useAnchoredAgeSeconds, type LiveAgeReading } from "./live-age";
import { describeLookupError } from "./lookup-error";
import { useCursorPages, type CursorPages } from "./pagination";

export type Phase<T> =
  | { readonly phase: "loading" }
  | { readonly phase: "error"; readonly message: string }
  | { readonly phase: "ready"; readonly value: T };

export interface AddressReading {
  readonly address: string;
  readonly valid: boolean;
  readonly lookup: Phase<AddressLookup>;
  readonly history: Phase<HistoryLookup>;
  readonly stress: Phase<StressLookup>;
  readonly params: Phase<readonly ParamChange[]>;
  readonly evidence: EvidenceManifest | null;
  readonly age: LiveAgeReading;
  readonly reload: () => void;
}

type Keyed<T> = { readonly for: string; readonly state: Phase<T> } | null;
const LOADING = { phase: "loading" } as const;

function forAddress<T>(keyed: Keyed<T>, addr: string): Phase<T> {
  return keyed !== null && keyed.for === addr ? keyed.state : LOADING;
}

/** One address-keyed fetch. `fetcher` must be referentially stable per address (useCallback on addr). */
function useKeyedFetch<T>(addr: string, enabled: boolean, epoch: number, fetcher: (signal: AbortSignal) => Promise<T>): Phase<T> {
  const [result, setResult] = useState<Keyed<T>>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetcher(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setResult({ for: addr, state: { phase: "ready", value } });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) setResult({ for: addr, state: { phase: "error", message: describeLookupError(cause) } });
      },
    );
    return () => {
      controller.abort();
    };
  }, [addr, enabled, epoch, fetcher]);
  return enabled ? forAddress(result, addr) : LOADING;
}

const fetchCashParams = async (signal: AbortSignal): Promise<readonly ParamChange[]> =>
  (await fetchParams(solventBaseUrl(), { engine: CASH }, signal)).params;

export function useAddressLookup(addr: string): AddressReading {
  const valid = isAddress(addr);
  const [epoch, setEpoch] = useState(0);
  const [lookupResult, setLookupResult] = useState<Keyed<AddressLookup>>(null);
  const [evidence, setEvidence] = useState<EvidenceManifest | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const loadLookup = useCallback(
    (options?: { keepOnFailure?: boolean }): Promise<boolean> => {
      if (!valid) return Promise.resolve(false);
      const keepOnFailure = options?.keepOnFailure ?? false;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      return getSolventClient()
        .address(addr, controller.signal)
        .then(
          (value) => {
            // An abort is a supersession, not an answer: the request that replaced this one reports for itself.
            if (controller.signal.aborted) return false;
            setLookupResult({ for: addr, state: { phase: "ready", value } });
            return true;
          },
          (cause: unknown) => {
            if (controller.signal.aborted) return false;
            const failure: Keyed<AddressLookup> = { for: addr, state: { phase: "error", message: describeLookupError(cause) } };
            // A failed BACKGROUND repair never replaces a rendered position; a foreground failure is stated in full.
            setLookupResult((previous) =>
              keepOnFailure && previous !== null && previous.for === addr && previous.state.phase === "ready" ? previous : failure,
            );
            return false;
          },
        );
    },
    [addr, valid],
  );

  useEffect(() => {
    void loadLookup();
    return () => {
      controllerRef.current?.abort();
    };
  }, [loadLookup, epoch]);

  const lookup = forAddress(lookupResult, addr);
  const ready = lookup.phase === "ready" ? lookup.value : null;
  const hasCash = ready !== null && ready.outcome === "found" && ready.response.positions.some((p) => p.engine === CASH);

  const fetchHistory = useCallback((signal: AbortSignal) => fetchAddressHistory(solventBaseUrl(), addr, { limit: 100, signal }), [addr]);
  const fetchStress = useCallback((signal: AbortSignal) => getSolventClient().addressStress(addr, signal), [addr]);
  const history = useKeyedFetch(addr, valid, epoch, fetchHistory);
  const stress = useKeyedFetch(addr, valid, epoch, fetchStress);
  const params = useKeyedFetch(addr, hasCash, epoch, fetchCashParams);

  // Book-level, not address-keyed: the committed reconcile receipt behind the Trust card's last item.
  useEffect(() => {
    const controller = new AbortController();
    getSolventClient()
      .evidence(controller.signal)
      .then(
        (manifest) => {
          if (!controller.signal.aborted) setEvidence(manifest);
        },
        () => {
          /* the Trust item reads "receipt unavailable" */
        },
      );
    return () => {
      controller.abort();
    };
  }, [epoch]);

  const repair = useCallback(() => loadLookup({ keepOnFailure: true }), [loadLookup]);
  const age = useAnchoredAgeSeconds(
    ready === null
      ? null
      : { ageSeconds: ready.response.batch.age_seconds, receiptId: receiptIdentity(ready.response.served_at, ready.response.batch.id) },
    repair,
  );
  const reload = useCallback(() => {
    setEpoch((e) => e + 1);
  }, []);

  return { address: addr, valid, lookup, history, stress, params, evidence, age, reload };
}

/** Cursor-paged activity for one address. Mount the consumer with key={addr}: a fresh mount can never hold another address's rows. */
export function useAddressActivity(addr: string, valid: boolean): CursorPages<ChainEvent> {
  const fetchPage = useCallback(
    async (cursor: string | null, signal: AbortSignal) => {
      const page = await fetchEvents(solventBaseUrl(), { account: addr, limit: 25, ...(cursor === null ? {} : { cursor }) }, signal);
      return { rows: page.events, nextCursor: page.next_cursor };
    },
    [addr],
  );
  const pages = useCursorPages<ChainEvent, string>(fetchPage);
  const { loadMore } = pages;
  const startedRef = useRef(false);
  useEffect(() => {
    if (!valid || startedRef.current) return;
    startedRef.current = true;
    loadMore();
  }, [valid, loadMore]);
  return pages;
}
