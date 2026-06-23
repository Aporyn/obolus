# Spend by commit / release — design

Date: 2026-06-23 · Status: draft for review

## Context

`/usage` shows one number per machine (24h/7d total). Obolus's wedge is **attribution + history**:
*how much did each commit / release actually cost?* — which `/usage` cannot show. This is the most
direct expression of the v0 "beat `/usage`" goal, and the owner's top-priority view.

This feature attributes each agent run's cost to a **commit** and a **release**, and presents a
"git log with prices" timeline plus a release rollup.

## Goals

- Attribute every run's cost to a commit, and roll commits up into releases (git tags).
- Label each attribution's confidence: `exact` (captured live) vs `estimated` (reconstructed) vs
  `unattributed` (can't bracket).
- Surfaces: **native app + CLI first**; the web dashboard gets the same view later, styled to match.
- Compute once in the TS backend; every surface renders the same data (minimize duplication).

## Non-goals (this iteration)

- **push / PR** attribution — deferred to v1-beta's GitHub App (`branch → PR`), the proper home for
  it. Acknowledged as a future must-do.
- Cross-machine / cross-device aggregation (that's the paid server).
- Pixel-identical web vs app — they share a design language, not an implementation.

## Data model & attribution

**Authoritative spend = the transcript scan.** Claude Code writes transcripts regardless of whether
obolus is running, so `scanTranscripts()` → `RunEvent[]` is the complete, gap-free list of runs and
cost. Toggling `watch` on/off never loses spend; it only changes attribution *precision*.

Per-run commit resolution (a `RunEvent` has no commit; resolve it):

1. **exact** — from the live-ledger `LiveRecord.commit` (stamped at run time by `watch` via
   `currentCommit`). Requires an exact join to the scanned run (see "Schema change" below).
2. **estimated** — reconstruct from local git: for the run's `repoPath` + `branch`, bracket
   `run.timestamp` against that branch's commit timestamps and attribute the run to the **capturing
   commit** (the earliest commit whose committer-date ≥ the run's timestamp — i.e. the commit that
   later captured that work). Uncommitted tail → an **"uncommitted (WIP)"** bucket.
3. **unattributed** — `repoPath` missing / not a git repo / rebased beyond recognition → a labeled
   bucket, never silently dropped.

Precedence on conflict: **exact (live SHA) wins**; estimated is the fallback.

**No double counting:** only transcript runs are ever summed. The live-ledger is a *side-table* used
solely to upgrade attribution — it is never added to totals. Conservation invariant:
`sum(byCommit) + unattributed == totalCostUsd`.

**Release mapping:** per repo, list tags with their commit dates; a commit belongs to the **earliest
release (tag) that contains it** (next tag at/after the commit on that branch); else `unreleased`.

SHA format: short `--short=8` everywhere, matching `collector/git.ts`.

## Schema change (small, enabling)

`LiveRecord` ([src/ledger/live-ledger.ts](src/ledger/live-ledger.ts)) currently stores
`commit` but no stable run id, so a scan↔live join can only key on `(sessionId, ts)` (fuzzy). Add
`id: string` to `LiveRecord` and populate it in `watch` from the same `RunEvent.id` the scanner uses
(`requestId ?? uuid ?? sessionId:timestamp`). Then the join is exact. Old ledger lines without `id`
fall back to the `(sessionId, ts)` heuristic.

## New / changed backend modules (TS, `src/`)

- `collector/git-history.ts` (new) — `commitsFor(repoPath, branch)` → `[{ sha, committedAt, subject }]`
  and `tagsFor(repoPath)` → `[{ tag, sha, taggedAt }]`. Wraps `git log` / `git tag` via `execFile`
  (no shell), cached per `(repoPath, branch)`. Returns empty on non-repo (→ unattributed).
- `report/commit-resolution.ts` (new, pure/testable) — given `RunEvent[]` + live records + git
  history, return each run enriched with `{ commit, release, confidence }`. Holds the bracketing,
  exact-wins, and WIP-fallback logic.
- `report/aggregate.ts` (extend) — add `byCommit` and `byRelease` to `ScanSummary`. Each carries the
  usual `GroupTotals` plus per-group `exactUsd` / `estimatedUsd` split and (for commits) `subject` +
  `committedAt`, (for releases) date range + commit count. Reuses `foldBy`.
- `ledger/live-ledger.ts` + `collector/watch.ts` (extend) — add and populate `LiveRecord.id`.
- Reuse as-is: `priceRun`, `summarize`, `currentCommit`, `repoLabelFromCwd`.

## Surfaces

- **CLI** — add `commit` and `release` to the `--by` dimensions ([src/cli.ts](src/cli.ts) +
  [src/report/terminal.ts](src/report/terminal.ts)). Rows show short SHA · subject · cost ·
  confidence. Nearly free; consistent with existing `--by repo|branch|day|…`.
- **API** — `GET /api/summary` gains `byCommit` + `byRelease`. One compute, all surfaces read it.
- **Native app (SwiftUI, primary)** — a "Spend by commit / release" section in the dashboard window:
  commit timeline ("git log with prices"), release rollup, `Commit | Release` toggle, exact/estimated
  dots, and the `/usage`-vs-obolus framing strip. New `Codable` models mirror `byCommit`/`byRelease`;
  new section views; reuse `Fmt`, `SummaryStore`.
- **Web dashboard (secondary, later)** — same section, rendered from the same API, styled with the
  shared design tokens. Not in this iteration's first cut.

## Minimize duplication

- All resolution + aggregation live in the TS backend behind one `/api/summary`; CLI, app, and web are
  thin renderers with no business logic.
- Extract a small **shared design-token spec** (colors, type scale, spacing, KPI-card / list-row /
  badge styles) as the single source of truth, so the SwiftUI app and the HTML dashboard look like
  siblings without sharing code.

## Edge cases (handled, labeled)

- repoPath gone / not git / rebased / squashed → `unattributed` bucket (shown, not hidden).
- Detached HEAD / no branch → limited reconstruction → bucket.
- Multi-block turns already de-duped by `RunEvent.id` in the scanner; resolution operates on deduped
  runs.
- Subscription users: cost stays labeled an estimate (invariant #4); confidence is about *attribution*,
  separate from the cost-estimate caveat.

## Testing

- Unit: `commit-resolution` (bracketing, exact-wins, WIP fallback) over fixture git histories;
  release mapping; `aggregate` `byCommit`/`byRelease`; the conservation invariant.
- Integration: scan a fixture transcript against a temp git repo (known commits/tags) → assert
  per-commit and per-release totals match hand-computed values, and exact vs estimated counts.
- Swift: `Codable` decode of the new `/api/summary` fields; cross-check totals == server.

## Rollout order

1. Backend core: `git-history` + `commit-resolution` + `aggregate` fields + `LiveRecord.id`.
2. CLI `--by commit|release` (validates the core in the terminal, cheaply).
3. API exposure (`byCommit`/`byRelease`).
4. Native app section (SwiftUI).
5. Web dashboard section + shared design tokens (later).
