"""R-001 live throughput probe — observed sustained req/s on the configured free RPC endpoints.

Purpose: the R-001 gate (Task 9 opening) requires OBSERVED throughput numbers before the
owner decides free vs keyed-free vs paid. The paper analysis (r001_input ledger entry):
~152k RPC calls total, 42/N hours at N sustained req/s, and no client-side rate limiter —
so the sustained clean rate of the configured endpoints is the decision input.

Production fidelity (verified against internal/ingest/walker.go + internal/chain/chain.go):
  - One walker window = 6 calls: eth_blockNumber, header(cursor), header(tip),
    eth_getLogs[from,to,addresses], header(tip) recheck, header(cursor) recheck.
    Headers are eth_getBlockByNumber(n, false); getLogs is ADDRESS-ONLY (no topics).
  - Window span 2000 (config/contracts.json, every stream); per-attempt timeout 30s
    (chain.go defaultAttemptTimeout).
  - Ranges walked are the real deep-history stream ranges: OP debt-manager from
    149,521,228 (0x0078C5a459132e279056B2371fE8A8eC973A9553); ETH aave pool from
    20,625,519 (0x0AA97c284e98396202b6A04024F5E2c65026F3c0). Windows NEVER repeat
    across phases so provider caches cannot flatter the measurement.

Axes VARIED: request rate (2/5/10/20 req/s, 45s phases, early-exit when a phase's clean
rate falls below 50% of submitted); payload class (production 1:4:1 blockNumber:header:
getLogs mix); window span (separate single-shot ceiling check at 2000/5000/10000/20000 —
evidence for the "window >2000" lever, NOT part of the rate phases).
Axes FIXED: concurrency cap 8 in-flight (brackets the daemon's per-chain walker fan-out);
timeout 30s; span 2000 during rate phases; deep-history depth.

Provider grouping: optimism.drpc.org and eth.drpc.org are ONE provider (drpc) — probed
sequentially with a 30s cooldown so the first measurement's throttle state does not
corrupt the second. Distinct providers run concurrently (independent limits).

Output: r001-results.json next to this file (machine record); human summary on stdout.
Stdlib only. Run: python probe.py
"""

import json
import statistics
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

TIMEOUT_S = 30  # production defaultAttemptTimeout
PHASE_TARGETS_RPS = [2, 5, 10, 20]
PHASE_SECONDS = 45
PHASE_GAP_S = 5
MAX_IN_FLIGHT = 8
CEILING_SPANS = [2000, 5000, 10000, 20000]
RATE_SPAN = 2000  # production window

OP_DM_ADDR = "0x0078C5a459132e279056B2371fE8A8eC973A9553"
OP_START = 149_521_228
ETH_POOL_ADDR = "0x0AA97c284e98396202b6A04024F5E2c65026F3c0"
ETH_START = 20_625_519

# groups run concurrently; endpoints inside a group run sequentially (shared provider limits)
GROUPS = [
    ("op-foundation", [("op", "https://mainnet.optimism.io")]),
    ("drpc", [("op", "https://optimism.drpc.org"), ("eth", "https://eth.drpc.org")]),
    ("publicnode", [("eth", "https://ethereum-rpc.publicnode.com")]),
]
GROUP_COOLDOWN_S = 30

CHAIN_PARAMS = {
    "op": {"addr": OP_DM_ADDR, "start": OP_START},
    "eth": {"addr": ETH_POOL_ADDR, "start": ETH_START},
}

RATE_LIMIT_TEXT = ("rate", "limit", "too many", "capacity", "exceed", "quota", "throttl")


def rpc_body(method, params, req_id):
    return json.dumps(
        {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}
    ).encode()


def one_request(url, method, params, req_id):
    """Returns a dict: kind in {ok, http-429, http-403, http-other, jsonrpc-ratelimit,
    jsonrpc-error, timeout, conn-error}; plus latency/bytes/logs/retry_after/message."""
    req = urllib.request.Request(
        url,
        data=rpc_body(method, params, req_id),
        headers={"Content-Type": "application/json", "User-Agent": "solvent-r001-probe/1"},
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            raw = resp.read()
        dt = time.perf_counter() - t0
        try:
            payload = json.loads(raw)
        except ValueError:
            return {"kind": "http-other", "message": "non-JSON 200 body", "latency": dt}
        if isinstance(payload, dict) and "error" in payload:
            msg = str(payload["error"].get("message", ""))[:200]
            code = payload["error"].get("code")
            kind = (
                "jsonrpc-ratelimit"
                if any(t in msg.lower() for t in RATE_LIMIT_TEXT)
                else "jsonrpc-error"
            )
            return {"kind": kind, "message": f"code={code} {msg}", "latency": dt}
        out = {"kind": "ok", "latency": dt, "bytes": len(raw)}
        if method == "eth_getLogs" and isinstance(payload.get("result"), list):
            out["logs"] = len(payload["result"])
        if method == "eth_blockNumber" and isinstance(payload.get("result"), str):
            out["head"] = int(payload["result"], 16)
        return out
    except urllib.error.HTTPError as e:
        dt = time.perf_counter() - t0
        kind = {429: "http-429", 403: "http-403"}.get(e.code, "http-other")
        out = {"kind": kind, "message": f"HTTP {e.code}", "latency": dt}
        ra = e.headers.get("Retry-After") if e.headers else None
        if ra:
            out["retry_after"] = ra
        return out
    except Exception as e:  # timeouts + connection errors
        dt = time.perf_counter() - t0
        is_timeout = "timed out" in str(e).lower() or "timeout" in str(e).lower()
        return {
            "kind": "timeout" if is_timeout else "conn-error",
            "message": str(e)[:200],
            "latency": dt,
        }


class WindowWalk:
    """Yields the production 6-call window pattern over never-repeating ranges."""

    def __init__(self, chain):
        p = CHAIN_PARAMS[chain]
        self.addr = p["addr"]
        self.next_from = p["start"]
        self.i = 0

    def next_call(self):
        frm = self.next_from
        to = frm + RATE_SPAN - 1
        cursor = frm - 1 if frm > 0 else 0
        pattern = [
            ("eth_blockNumber", []),
            ("eth_getBlockByNumber", [hex(cursor), False]),
            ("eth_getBlockByNumber", [hex(to), False]),
            (
                "eth_getLogs",
                [{"fromBlock": hex(frm), "toBlock": hex(to), "address": [self.addr]}],
            ),
            ("eth_getBlockByNumber", [hex(to), False]),
            ("eth_getBlockByNumber", [hex(cursor), False]),
        ]
        method, params = pattern[self.i % 6]
        self.i += 1
        if self.i % 6 == 0:
            self.next_from += RATE_SPAN  # advance: windows never repeat
        return method, params


def pct(vals, p):
    if not vals:
        return None
    return round(statistics.quantiles(vals, n=100)[p - 1], 3) if len(vals) >= 2 else round(vals[0], 3)


def run_phase(url, walk, target_rps, seconds):
    interval = 1.0 / target_rps
    stats = {
        "target_rps": target_rps,
        "seconds": seconds,
        "submitted": 0,
        "dropped_saturated": 0,
        "counts": {},
        "error_samples": [],
        "retry_after_samples": [],
        "ok_latencies": [],
        "getlogs_ok_latencies": [],
        "getlogs_logs_total": 0,
    }
    lock = threading.Lock()
    sem = threading.Semaphore(MAX_IN_FLIGHT)

    def fire(method, params, rid):
        try:
            r = one_request(url, method, params, rid)
        finally:
            sem.release()
        with lock:
            stats["counts"][r["kind"]] = stats["counts"].get(r["kind"], 0) + 1
            if r["kind"] == "ok":
                stats["ok_latencies"].append(r["latency"])
                if method == "eth_getLogs":
                    stats["getlogs_ok_latencies"].append(r["latency"])
                    stats["getlogs_logs_total"] += r.get("logs", 0)
            else:
                msg = r.get("message", r["kind"])
                if msg not in [s[1] for s in stats["error_samples"]][:8] and len(stats["error_samples"]) < 8:
                    stats["error_samples"].append([r["kind"], msg])
                if "retry_after" in r and len(stats["retry_after_samples"]) < 5:
                    stats["retry_after_samples"].append(r["retry_after"])

    with ThreadPoolExecutor(max_workers=MAX_IN_FLIGHT) as pool:
        start = time.perf_counter()
        rid = 0
        while True:
            now = time.perf_counter()
            if now - start >= seconds:
                break
            sched = start + rid * interval
            if sched > now:
                time.sleep(min(sched - now, 0.25))
                continue
            method, params = walk.next_call()
            rid += 1
            if sem.acquire(blocking=False):
                stats["submitted"] += 1
                pool.submit(fire, method, params, rid)
            else:
                stats["dropped_saturated"] += 1  # open-loop: saturation is recorded, not hidden

    ok = stats["counts"].get("ok", 0)
    lat = sorted(stats["ok_latencies"])
    glat = sorted(stats["getlogs_ok_latencies"])
    stats["ok"] = ok
    stats["clean_fraction"] = round(ok / stats["submitted"], 4) if stats["submitted"] else 0.0
    stats["achieved_ok_rps"] = round(ok / seconds, 2)
    stats["latency_p50"] = pct(lat, 50)
    stats["latency_p95"] = pct(lat, 95)
    stats["getlogs_latency_p50"] = pct(glat, 50)
    stats["getlogs_latency_p95"] = pct(glat, 95)
    del stats["ok_latencies"], stats["getlogs_ok_latencies"]
    return stats


def probe_endpoint(chain, url):
    result = {"url": url, "chain": chain, "started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    p = CHAIN_PARAMS[chain]

    head = one_request(url, "eth_blockNumber", [], 1)
    result["head"] = head.get("head")
    result["head_check"] = head["kind"]

    # window-span ceiling check (lever-1 evidence) — single shots, not rate-limited load
    ceilings = []
    for span in CEILING_SPANS:
        frm, to = p["start"], p["start"] + span - 1
        r = one_request(
            url,
            "eth_getLogs",
            [{"fromBlock": hex(frm), "toBlock": hex(to), "address": [p["addr"]]}],
            2,
        )
        ceilings.append(
            {
                "span": span,
                "kind": r["kind"],
                "logs": r.get("logs"),
                "bytes": r.get("bytes"),
                "latency": round(r.get("latency", 0), 3),
                "message": r.get("message"),
            }
        )
        time.sleep(2)
    result["window_ceiling"] = ceilings

    walk = WindowWalk(chain)
    phases = []
    for target in PHASE_TARGETS_RPS:
        ph = run_phase(url, walk, target, PHASE_SECONDS)
        phases.append(ph)
        print(
            f"[{url}] {target} rps: ok={ph['ok']}/{ph['submitted']} "
            f"clean={ph['clean_fraction']} p50={ph['latency_p50']} p95={ph['latency_p95']} "
            f"getLogs_p95={ph['getlogs_latency_p95']} dropped={ph['dropped_saturated']} "
            f"errors={ph['counts']}",
            flush=True,
        )
        if ph["clean_fraction"] < 0.5:
            result["early_exit"] = f"phase {target} rps collapsed (clean {ph['clean_fraction']}); higher phases skipped"
            break
        time.sleep(PHASE_GAP_S)
    result["phases"] = phases

    sustained = 0
    for ph in phases:
        if ph["clean_fraction"] >= 0.99 and ph["dropped_saturated"] == 0:
            sustained = max(sustained, ph["achieved_ok_rps"])
    result["max_clean_sustained_rps"] = sustained
    return result


def main():
    results = {"probe_started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "endpoints": []}
    lock = threading.Lock()

    def run_group(name, endpoints):
        for i, (chain, url) in enumerate(endpoints):
            if i > 0:
                print(f"[group {name}] cooldown {GROUP_COOLDOWN_S}s before next endpoint", flush=True)
                time.sleep(GROUP_COOLDOWN_S)
            print(f"[group {name}] probing {url} ({chain})", flush=True)
            r = probe_endpoint(chain, url)
            r["provider_group"] = name
            with lock:
                results["endpoints"].append(r)

    threads = [threading.Thread(target=run_group, args=(n, eps)) for n, eps in GROUPS]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    results["probe_finished_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    out = __file__.rsplit("probe.py", 1)[0] + "r001-results.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"\nwrote {out}", flush=True)

    print("\n=== SUMMARY ===")
    for r in sorted(results["endpoints"], key=lambda x: x["url"]):
        print(f"{r['url']} ({r['chain']}, {r['provider_group']}):")
        print(f"  max clean sustained: {r['max_clean_sustained_rps']} req/s"
              + (f"  [{r['early_exit']}]" if "early_exit" in r else ""))
        for c in r["window_ceiling"]:
            status = f"ok logs={c['logs']} {c['latency']}s" if c["kind"] == "ok" else f"{c['kind']}: {c['message']}"
            print(f"  span {c['span']}: {status}")


if __name__ == "__main__":
    main()
