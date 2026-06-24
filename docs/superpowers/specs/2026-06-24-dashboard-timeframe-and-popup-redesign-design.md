# Obolus — Dashboard timeframe selector + menu-bar popup redesign

**Date:** 2026-06-24
**Status:** Approved design, pre-implementation

## Problem

Two issues with the current surfaces, both rooted in a missing "time window" concept:

1. **Dashboard (web + app window) is all-time only.** `/api/summary` returns the full
   `ScanSummary` with no time filtering, so the top KPIs (Estimated cost / Runs / Tokens),
   "Where it goes", and "Spend breakdown" always show all-time totals. Users cannot ask
   "what did this cost in the last day / week / month?".

2. **Menu-bar popup leads with meaningless anchors.** The live layout's hero is
   "This session" — running spend since the SSE stream connected (≈ app launch), an arbitrary
   anchor that crosses calendar days and does not map to any Claude Code session. "Latest run"
   is single-row noise. Neither answers the popup's actual job: *in 2 seconds, how much did I
   spend today, is that normal, and is something burning right now?*

## Goals

- Add a `1d / 7d / 30d / All` time-window selector to the dashboard (web + app window),
  driving every section. Default = 7d.
- Redesign the popup around "Today + trend": today's spend as the hero, compared to the recent
  daily average, with a 7-day sparkline; a minimal live pulse only when actively coding.
- Reuse the existing filter pipeline; no data-model changes.

## Non-goals

- No time selector inside the popup itself (it stays a fixed, glanceable view).
- No change to the SSE live stream contract.
- No blocking / gating (v1 invariant: observe only).

## Design

### A. Server — `?since=` on `/api/summary`

In `sendSummary` (`src/dashboard/serve.ts`), read `since` from the request URL query. When
present, `parseSince(since)` → ISO cutoff, then `filterEvents(events, { since })` before
`summarize`. Absent or `all` → current all-time behavior.

- UI windows map to relative spans: `1d`, `7d`, `30d`. `All` omits the param.
- Attribution (commit-resolution) runs on the filtered events, as today.

### B. Dashboard selector (web + app window), default 7d

**Web (`src/dashboard/html.ts`):** a segmented control `1d · 7d · 30d · All` in the header.
On change, refetch `/api/summary?since=<span>` and re-render the whole page (KPIs,
"Where it goes", "Spend breakdown", everything). Initial load uses `7d`. The demo-data
fallback is unchanged. The SSE live overlay is independent of the selector.

**App (`apps/desktop/Sources/Obolus/Views/DashboardView.swift`):** a matching `Picker`.
Because the popup also consumes `store.summary` and must stay on a fixed window, the dashboard
window keeps its own timeframe state and fetches independently:

- Extend `SummaryStore` with a windowed fetch (`windowedSummary` + `setTimeframe(_:)`),
  hitting `/api/summary?since=`.
- `All` reuses the existing all-time `summary` (no extra fetch).
- The popup's `summary` (all-time, 15s poll) is untouched.

### C. Popup redesign — "Today + trend" (`MenuBarView.swift`)

Remove `sessionHero` ("This session") and `lastRunRow` ("Latest run"). A single layout; the
live state adds one row.

- **Hero (always):** caption "Today"; big number = `costToday()`; a comparison chip vs the
  trailing-7-day daily average (`↑ 1.4× avg` / `≈ avg` / `↓ 0.5× avg`), reusing the volatility
  helper at day granularity; `MiniSparkline(recentDays(7))` underneath.
- **Live row (only when `isLive`):** `● live · <repo · branch>` (existing `activeContext`) plus
  `last 10m $X` = sum of `liveFeed` runs with `timestamp >= now - 10m`.
- **Idle (when not live):** show Top repos (top 3 from `summary.byRepo`), as today.
- Footer unchanged.

Notes:

- `costToday()` lags up to 15s behind a just-finished run (it comes from the polled summary).
  Optional later refinement: overlay today's live runs for instant update. Out of scope here.
- Day-level average: mean of the prior days' daily spend in `recentDays` (excluding today).
  A pure helper in ObolusKit.

### D. Testing

- **TS:** unit-test the `since` query parsing in the serve layer and that a filtered summarize
  equals `filterEvents` → `summarize`. (`filterEvents` itself is already covered.)
- **Swift:** pure-function tests in ObolusKit for the day-level average comparison and the
  last-10-minute burn computation. No View tests.

## Open questions

None blocking. Minor: exact wording of the day-average chip ("avg/day" vs "vs daily avg") —
finalize during implementation.
