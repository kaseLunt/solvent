#!/usr/bin/env python3
"""Reviewable mutation applier for Task 8's price unit.

WHY THIS FILE EXISTS. Waves 5-15 all reported mutation matrices, and the applier that
produced them lived only in a shell history and in the prose of each report. Codex round
11P's [medium] #4: a matrix is evidence about the TESTS, and evidence nobody can re-run
or inspect is an assertion. So the applier is committed, the mutation set is committed as
data, and every run writes a transcript naming the SHA it ran against.

THE ONE PROPERTY THAT MATTERS, AND WHERE IT IS ENFORCED: `apply_edit` below refuses
unless the search pattern occurs EXACTLY ONCE in the file, and the driver refuses to run
a test for an edit that did not apply. This is not fastidiousness. Wave 12's matrix was
nearly ruined by `perl -0pi` patterns containing "\\n" that silently matched nothing
against CRLF files, and every such mutation would have been recorded as SURVIVED — a
green test suite vouching for coverage that was never exercised. A mutation that is not
verified applied is not a data point in either direction, so this refuses to produce one.

FILES ARE READ AND WRITTEN AS BYTES. The repo's .gitattributes plus core.autocrlf give
Go files CRLF in the working tree. Any text-mode round trip would rewrite line endings
across the whole file and the "restore" would not be a restore.

RESTORES COME FROM AN IN-MEMORY COPY TAKEN BEFORE THE EDIT — never `git checkout`. That
is the standing rule since wave 6 and it has been violated twice, each time destroying a
concurrent wave's uncommitted work (waves 6 and 12). The restore is then VERIFIED byte
for byte, and the driver aborts the whole run if any file does not come back identical.

Usage:
    python mutate.py --spec mutations.json --repo <path> [--only M4 M7] [--dry-run]

Exit status is 0 only if every mutation applied, every test ran, and every file was
restored byte-identically. A SURVIVED mutation is a finding, not an error, and does not
by itself change the exit status — it is reported.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path


# --------------------------------------------------------------------------------
# The assertion this whole file exists for.
# --------------------------------------------------------------------------------

class NotApplied(Exception):
    """Raised when a search pattern does not occur exactly once."""


def apply_edit(data: bytes, search: str, replace: str, path: str) -> tuple[bytes, int]:
    """Replace `search` with `replace` in `data`, or refuse.

    EXACTLY ONE OCCURRENCE IS REQUIRED. Zero means the pattern never matched — the CRLF
    trap, or a comment that has since been reworded — and the mutation was never made.
    Two or more means the edit is ambiguous: it would mutate call sites the author did
    not enumerate, and a kill could then be attributed to the wrong one. Both are
    refusals, both are loud, and neither is allowed to reach a test run.

    Returns the mutated bytes and the 1-based line number of the first mutated line.
    """
    needle = search.encode("utf-8")
    count = data.count(needle)
    if count != 1:
        raise NotApplied(
            f"{path}: pattern occurs {count} times, exactly 1 required.\n"
            f"  pattern: {search[:160]!r}\n"
            f"  (0 usually means the text moved or the pattern spans a line break in a "
            f"CRLF file; >1 means the edit is ambiguous and must be made more specific)"
        )
    offset = data.index(needle)
    line_no = data[:offset].count(b"\n") + 1
    return data[:offset] + replace.encode("utf-8") + data[offset + len(needle):], line_no


# --------------------------------------------------------------------------------
# Spec model
# --------------------------------------------------------------------------------

@dataclass
class Edit:
    file: str
    search: str
    replace: str


@dataclass
class Mutation:
    id: str
    property: str          # what the CODE is supposed to do; a kill is only evidence
                           # about the tests, so the property has to be written down
                           # separately or the matrix is confidence-theatre.
    description: str
    test: list[str]
    edits: list[Edit]
    expect: str = "KILLED"
    note: str = ""
    # populated by the run
    applied_lines: list[str] = field(default_factory=list)
    result: str = ""
    failing_tests: list[str] = field(default_factory=list)


def load_spec(path: Path) -> tuple[dict, list[Mutation]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    muts = []
    for m in raw["mutations"]:
        muts.append(Mutation(
            id=m["id"],
            property=m["property"],
            description=m["description"],
            test=m["test"],
            edits=[Edit(**e) for e in m["edits"]],
            expect=m.get("expect", "KILLED"),
            note=m.get("note", ""),
        ))
    return raw.get("meta", {}), muts


# --------------------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------------------

def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args],
                          capture_output=True, text=True, check=True).stdout.strip()


def clean_at_head(repo: Path, files: set[str]) -> list[str]:
    """Files whose working-tree bytes differ from HEAD.

    THE MUTATION LOOP RUNS AGAINST COMMITTED WORK (the brief's rule since wave 6, after
    a loop destroyed its own uncommitted output). Anything dirty here would be mutated
    and restored to a state no commit holds, so it is refused up front.
    """
    dirty = git(repo, "status", "--porcelain", "--", *sorted(files))
    return [line for line in dirty.splitlines() if line.strip()]


def run_tests(repo: Path, cmd: list[str], env: dict) -> tuple[bool, list[str], str]:
    proc = subprocess.run(cmd, cwd=str(repo), capture_output=True, text=True, env=env)
    out = proc.stdout + proc.stderr
    failing = sorted({line.split()[2] for line in out.splitlines()
                      if line.strip().startswith("--- FAIL:") and len(line.split()) > 2})
    return proc.returncode == 0, failing, out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--dry-run", action="store_true",
                    help="apply and restore each mutation without running its tests")
    ap.add_argument("--transcript", default=None)
    args = ap.parse_args()

    repo = Path(args.repo).resolve()
    spec_path = Path(args.spec).resolve()
    meta, mutations = load_spec(spec_path)
    if args.only:
        mutations = [m for m in mutations if m.id in set(args.only)]
        if not mutations:
            print("no mutations selected", file=sys.stderr)
            return 2

    touched = {e.file for m in mutations for e in m.edits}
    dirty = clean_at_head(repo, touched)
    if dirty:
        print("REFUSING: these files differ from HEAD; commit before mutating:",
              file=sys.stderr)
        for d in dirty:
            print("  " + d, file=sys.stderr)
        return 2

    sha = git(repo, "rev-parse", "HEAD")
    started = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()
    env = dict(os.environ)

    lines: list[str] = []

    def say(s: str = "") -> None:
        print(s)
        lines.append(s)

    say(f"# mutation transcript")
    say()
    say(f"- spec: `{spec_path.name}`")
    say(f"- repo: `{repo}`")
    say(f"- **tested SHA: `{sha}`**  ({git(repo, 'log', '-1', '--format=%s')})")
    say(f"- started (UTC): {started}")
    say(f"- applier: `mutate.py`, exactly-one-occurrence assertion in `apply_edit`")
    if args.dry_run:
        say("- **DRY RUN** — mutations applied and restored, no tests run")
    say()

    ok = True
    for m in mutations:
        say(f"## {m.id} — {m.description}")
        say()
        say(f"**Property under attack:** {m.property}")
        if m.note:
            say()
            say(f"*{m.note}*")
        say()

        backups: dict[str, bytes] = {}
        try:
            for e in m.edits:
                target = repo / e.file
                original = target.read_bytes()
                backups.setdefault(e.file, original)
                mutated, line_no = apply_edit(original, e.search, e.replace, e.file)
                target.write_bytes(mutated)
                m.applied_lines.append(f"{e.file}:{line_no}")
                say("```diff")
                say(f"--- {e.file}:{line_no}")
                for ln in e.search.splitlines():
                    say(f"-{ln}")
                for ln in e.replace.splitlines():
                    say(f"+{ln}")
                say("```")
                say(f"APPLIED at {e.file}:{line_no} (1 occurrence, asserted)")
                say()

            if args.dry_run:
                m.result = "APPLIED (dry run)"
            else:
                say(f"`{' '.join(m.test)}`")
                say()
                passed, failing, _out = run_tests(repo, m.test, env)
                m.failing_tests = failing
                m.result = "SURVIVED" if passed else "KILLED"
                if failing:
                    say("Killed by:")
                    for f in failing:
                        say(f"  - `{f}`")
                else:
                    say("No test failed.")
                say()
        except NotApplied as exc:
            m.result = "NOT APPLIED"
            ok = False
            say("```")
            say(f"NOT APPLIED: {exc}")
            say("```")
            say()
        finally:
            for path, original in backups.items():
                target = repo / path
                target.write_bytes(original)
                if target.read_bytes() != original:
                    say(f"**RESTORE FAILED for {path}** — aborting")
                    return 3

        verdict = m.result
        if m.result in ("KILLED", "SURVIVED") and m.result != m.expect:
            verdict += f"  (EXPECTED {m.expect})"
            ok = False
        say(f"**Result: {verdict}**")
        say()

    residual = clean_at_head(repo, touched)
    say("## restore verification")
    say()
    if residual:
        ok = False
        say("**FILES DID NOT COME BACK CLEAN:**")
        for d in residual:
            say(f"  - `{d}`")
    else:
        say(f"`git status --porcelain` over the {len(touched)} mutated file(s) is EMPTY: "
            f"every file is byte-identical to `{sha[:7]}`. Restores came from in-memory "
            f"copies taken before each edit; `git checkout` is never used.")
    say()

    say("## summary")
    say()
    say("| # | result | property | killed by |")
    say("|---|---|---|---|")
    for m in mutations:
        killers = "<br>".join(f"`{f}`" for f in m.failing_tests) or "—"
        say(f"| {m.id} | **{m.result}** | {m.property} | {killers} |")
    say()
    killed = sum(1 for m in mutations if m.result == "KILLED")
    survived = sum(1 for m in mutations if m.result == "SURVIVED")
    say(f"{len(mutations)} mutants, {killed} killed, {survived} survived.")

    if args.transcript:
        Path(args.transcript).write_text("\n".join(lines) + "\n", encoding="utf-8")

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
