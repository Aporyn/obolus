# Dashboard timeframe selector + popup redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `1d/7d/30d/All` time-window selector to the web + app dashboards (default 7d), and redesign the menu-bar popup around "Today + trend" instead of the meaningless "This session" / "Latest run".

**Architecture:** One server change — `/api/summary?since=` filters events through the existing `filterEvents` → `summarize` pipeline. The web dashboard and the app's dashboard window each gain a selector that refetches with `?since=`. The popup keeps its all-time `summary` fetch untouched and is re-laid-out to lead with today's calendar-day spend, a "vs daily average" chip, a 7-day sparkline, and (when live) a last-10-minute burn row.

**Tech Stack:** TypeScript (Node http, vitest), vanilla JS in `dashboard.html`, SwiftUI + XCTest (ObolusKit).

---

## Before you start

- The working tree on `main` already has **unrelated uncommitted changes** from a prior session (the server-tool cost work). Do **not** `git add -A`. Each commit step below `git add`s only the exact files it names.
- Create a feature branch first (uncommitted changes follow along; that's fine):

```bash
git checkout -b feat/dashboard-timeframe-popup
```

## File map

| File | Change |
|---|---|
| `src/dashboard/serve.ts` | `sendSummary` reads `?since=`, filters before `summarize` |
| `test/serve.test.ts` | new test: `?since=` filters the summary |
| `src/dashboard/dashboard.html` | timeframe `.seg` control + refetch-on-change (SOURCE; regenerates `html.ts`) |
| `apps/desktop/Sources/ObolusKit/PopupMetrics.swift` | NEW — `SpendTrend`, `recentDailyAverage`, `todayTrend`, `LiveBurn.recentUsd` |
| `apps/desktop/Sources/ObolusKit/Timeframe.swift` | NEW — `Timeframe` enum |
| `apps/desktop/Sources/ObolusKit/SummaryStore.swift` | `summaryURL(base:timeframe:)` + `fetchSummary(timeframe:)` |
| `apps/desktop/Tests/ObolusKitTests/PopupMetricsTests.swift` | NEW — pure-function tests |
| `apps/desktop/Tests/ObolusKitTests/TimeframeTests.swift` | NEW — `Timeframe` + URL tests |
| `apps/desktop/Sources/Obolus/Views/MenuBarView.swift` | popup redesign (Today-first) |
| `apps/desktop/Sources/Obolus/Views/DashboardView.swift` | timeframe `Picker` + windowed render |

---

## Task 1: Server — `?since=` on `/api/summary`

**Files:**
- Modify: `src/dashboard/serve.ts`
- Test: `test/serve.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the `describe('dashboard server', ...)` block in `test/serve.test.ts` (after the first `it(...)`, before `readyLine`):

```ts
  it('filters the summary by ?since= cutoff', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obolus-serve-since-'));
    const project = join(root, 'proj');
    await mkdir(project, { recursive: true });
    const rec = (ts: string, sid: string) =>
      JSON.stringify({
        type: 'assistant',
        uuid: sid,
        cwd: '/x/repoA',
        gitBranch: 'main',
        sessionId: sid,
        timestamp: ts,
        message: { model: 'claude-opus-4-8', usage: { input_tokens: 1000, output_tokens: 500 } },
      });
    await writeFile(
      join(project, 'a.jsonl'),
      `${rec('2026-06-01T00:00:00Z', 's-old')}\n${rec('2026-06-20T00:00:00Z', 's-new')}\n`,
      'utf8',
    );
    const server = createDashboardServer(root);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    try {
      const all = await fetch(`${base}/api/summary`).then((r) => r.json());
      expect(all.totalRuns).toBe(2);

      const since = await fetch(`${base}/api/summary?since=2026-06-15`).then((r) => r.json());
      expect(since.totalRuns).toBe(1);
      expect(since.totalCostUsd).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/serve.test.ts`
Expected: FAIL — the `?since=` case reports `totalRuns` 2 instead of 1 (filtering not implemented yet).

- [ ] **Step 3: Add imports** — in `src/dashboard/serve.ts`, add after the existing `summarize` import (line ~9):

```ts
import { filterEvents } from '../report/filter.js';
import { parseSince } from '../report/timeframe.js';
```

- [ ] **Step 4: Filter inside `sendSummary`** — replace the whole `sendSummary` function with:

```ts
async function sendSummary(res: ServerResponse, root: string, reqUrl: string): Promise<void> {
  try {
    const sinceRaw = new URL(reqUrl, 'http://localhost').searchParams.get('since');
    const since = sinceRaw ? parseSince(sinceRaw) : null;
    const allEvents = await scanTranscripts(root);
    const events = since ? filterEvents(allEvents, { since }) : allEvents;
    const attribution = resolveAttribution(events, await readLiveRecords(), defaultGitHistory);
    const summary = summarize(events, ANTHROPIC_PRICING, { attribution });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(summary));
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}
```

- [ ] **Step 5: Pass the URL at the call site** — in `createDashboardServer`, change the summary branch:

```ts
    if (url.startsWith('/api/summary')) {
      void sendSummary(res, root, url);
      return;
    }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec vitest run test/serve.test.ts`
Expected: PASS (all cases, including the new `?since=` one).

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/serve.ts test/serve.test.ts
git commit -m "feat: filter /api/summary by ?since= window"
```

---

## Task 2: Web dashboard timeframe selector

**Files:**
- Modify: `src/dashboard/dashboard.html` (SOURCE — `html.ts` is regenerated, never hand-edited)

- [ ] **Step 1: Add the selector control to the header** — in `src/dashboard/dashboard.html`, replace the `.status` line (currently line ~201):

```html
    <div class="status"><span class="dot" id="dot"></span><span id="statusText">connecting</span><button id="themeToggle" class="theme-toggle" aria-label="Toggle light or dark theme" title="Toggle light / dark">◐</button></div>
```

with (adds a `.seg` time-range group before the status dot — reuses the existing `.seg` styles):

```html
    <div class="status"><span class="seg" id="tfSeg" role="group" aria-label="Time range"><button data-tf="1d" aria-pressed="false">1d</button><button data-tf="7d" aria-pressed="true">7d</button><button data-tf="30d" aria-pressed="false">30d</button><button data-tf="all" aria-pressed="false">All</button></span><span class="dot" id="dot"></span><span id="statusText">connecting</span><button id="themeToggle" class="theme-toggle" aria-label="Toggle light or dark theme" title="Toggle light / dark">◐</button></div>
```

- [ ] **Step 2: Add the timeframe state variable** — after `var commitMode = "commit";` (line ~264) add:

```js
  var timeframe = "7d";
```

- [ ] **Step 3: Extract the summary fetch + wire the selector** — replace the whole `start()` function (currently lines ~532-549) with:

```js
  function summaryUrl() {
    return timeframe === "all" ? "/api/summary" : "/api/summary?since=" + encodeURIComponent(timeframe);
  }

  function loadSummary() {
    return fetch(summaryUrl()).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (s) {
      if (s && s.error) throw new Error(s.error);
      summary = s;
      sampleMode = false;
      render();
    }).catch(function () { useSample(); });
  }

  function start() {
    var tfSeg = document.getElementById("tfSeg");
    if (tfSeg) {
      tfSeg.addEventListener("click", function (e) {
        var b = e.target.closest("button[data-tf]");
        if (!b) return;
        timeframe = b.getAttribute("data-tf");
        tfSeg.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x === b); });
        loadSummary();
      });
    }

    loadSummary();

    try {
      var es = new EventSource("/api/events");
      es.onopen = function () { setStatus(true); };
      es.onerror = function () { setStatus(false); };
      es.onmessage = function (m) { try { pushLive(JSON.parse(m.data)); } catch (e) {} };
    } catch (e) { setStatus(false); }
  }
```

- [ ] **Step 4: Regenerate `html.ts` and type-check**

Run: `pnpm build`
Expected: `[embed] embedded NNNNN bytes of dashboard HTML into html.ts` then a clean `tsc` (no errors). This rewrites `src/dashboard/html.ts`.

- [ ] **Step 5: Manual smoke** — start the server against a fixture or your real history and confirm the selector refetches:

```bash
node dist/index.js serve --port 4319
```

Open `http://localhost:4319`. Expected: page loads with **7d** pressed; the KPIs/breakdown reflect the last 7 days. Click **All** → numbers jump to all-time; click **1d** → shrink to the last 24h. Network tab shows `/api/summary?since=7d|1d|30d` and `/api/summary` for All. Stop with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/dashboard.html src/dashboard/html.ts
git commit -m "feat: time-range selector on the web dashboard (default 7d)"
```

---

## Task 3: ObolusKit — popup metric helpers (pure, TDD)

**Files:**
- Create: `apps/desktop/Sources/ObolusKit/PopupMetrics.swift`
- Test: `apps/desktop/Tests/ObolusKitTests/PopupMetricsTests.swift`

- [ ] **Step 1: Write the failing tests** — create `apps/desktop/Tests/ObolusKitTests/PopupMetricsTests.swift`:

```swift
import XCTest
@testable import ObolusKit

final class PopupMetricsTests: XCTestCase {
    // Fixed UTC clock + calendar so day-key math is deterministic.
    private let now = ISO8601DateFormatter().date(from: "2026-06-24T12:00:00Z")!
    private var utc: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }

    private func bucket(_ key: String, _ cost: Double) -> GroupTotals {
        GroupTotals(key: key, runs: 1, inputTokens: 0, outputTokens: 0, cacheTokens: 0,
                    totalTokens: 0, costUsd: cost, hasUnpriced: false, hasEstimated: false)
    }

    private func summary(_ days: [GroupTotals]) -> ScanSummary {
        ScanSummary(
            totalRuns: 0, totalTokens: 0, totalCostUsd: 0,
            composition: CostComposition(inputUsd: 0, outputUsd: 0, cacheReadUsd: 0, cacheWriteUsd: 0, serverToolUsd: 0),
            unpricedModels: [], estimatedModels: [],
            byRepo: [], byModel: [], byBranch: [], byDay: days, byWeek: [], byKind: [],
            sessions: [], topRuns: [], byCommit: [], byRelease: []
        )
    }

    func testRecentDailyAverageExcludesTodayAndCountsQuietDaysAsZero() {
        let s = summary([bucket("2026-06-24", 100), bucket("2026-06-23", 10), bucket("2026-06-22", 4)])
        // (10 + 4 + 0*5) / 7 = 2.0
        XCTAssertEqual(s.recentDailyAverage(7, calendar: utc, now: now), 2.0, accuracy: 1e-9)
    }

    func testTodayTrendHighWhenTodayWellAboveAverage() {
        let days = [bucket("2026-06-24", 100)] + (17...23).map { bucket("2026-06-\($0)", 10) }
        // avg = 10, today = 100, ratio 10 -> high
        guard case .high(let r) = summary(days).todayTrend(calendar: utc, now: now) else {
            return XCTFail("expected .high")
        }
        XCTAssertEqual(r, 10, accuracy: 1e-9)
    }

    func testTodayTrendLowWhenTodayWellBelowAverage() {
        let days = [bucket("2026-06-24", 1)] + (17...23).map { bucket("2026-06-\($0)", 10) }
        guard case .low = summary(days).todayTrend(calendar: utc, now: now) else {
            return XCTFail("expected .low")
        }
    }

    func testTodayTrendNoBaselineWhenNoHistory() {
        XCTAssertEqual(summary([bucket("2026-06-24", 50)]).todayTrend(calendar: utc, now: now), .noBaseline)
    }

    func testRecentBurnSumsOnlyRunsWithinWindow() {
        func run(_ ts: String, _ cost: Double) -> LiveRunEvent {
            LiveRunEvent(repo: "r", branch: nil, commit: nil, model: "m", costUsd: cost,
                         tokens: 0, timestamp: ts, isSidechain: false, runningUsd: 0, runningRuns: 0)
        }
        let feed = [
            run("2026-06-24T11:59:00Z", 2),  // 1 min ago — in
            run("2026-06-24T11:55:00Z", 3),  // 5 min ago — in
            run("2026-06-24T11:45:00Z", 5),  // 15 min ago — out
        ]
        XCTAssertEqual(LiveBurn.recentUsd(feed, within: 600, now: now), 5.0, accuracy: 1e-9)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path apps/desktop --filter PopupMetricsTests`
Expected: FAIL to compile — `recentDailyAverage`, `todayTrend`, `SpendTrend`, `LiveBurn` are undefined.

- [ ] **Step 3: Implement the helpers** — create `apps/desktop/Sources/ObolusKit/PopupMetrics.swift`:

```swift
import Foundation

/// Glance metrics derived for the menu-bar popup. Pure and View-free so they can be
/// unit-tested in ObolusKit without a display.

/// How today's spend compares to your recent daily norm — the popup's "is this normal?" cue.
/// Thresholds match the per-run volatility cue the popup used before (≥1.5× high, ≤0.66× low).
public enum SpendTrend: Equatable, Sendable {
    case high(ratio: Double)
    case low(ratio: Double)
    case normal
    case noBaseline
}

public extension ScanSummary {
    /// Mean daily spend over the `count` days *before* today (today is excluded). Days with no
    /// activity count as 0, so a quiet stretch pulls the average down — matching how a developer
    /// reads "my usual day".
    func recentDailyAverage(_ count: Int = 7,
                            calendar: Calendar = ScanSummary.localCalendar,
                            now: Date = Date()) -> Double {
        var sum = 0.0
        for offset in 1...max(count, 1) {
            guard let day = calendar.date(byAdding: .day, value: -offset, to: now) else { continue }
            let key = Self.dayKey(for: day, calendar: calendar)
            sum += byDay.first { $0.key == key }?.costUsd ?? 0
        }
        return sum / Double(max(count, 1))
    }

    /// Today's spend vs the trailing-7-day daily average, bucketed into a trend.
    func todayTrend(calendar: Calendar = ScanSummary.localCalendar, now: Date = Date()) -> SpendTrend {
        let avg = recentDailyAverage(7, calendar: calendar, now: now)
        guard avg > 0 else { return .noBaseline }
        let ratio = costToday(calendar: calendar, now: now) / avg
        if ratio >= 1.5 { return .high(ratio: ratio) }
        if ratio <= 0.66 { return .low(ratio: ratio) }
        return .normal
    }
}

/// "Burning right now" rate for the popup's live row — anchored to *now*, not to app launch.
public enum LiveBurn {
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoNoFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static func parse(_ ts: String) -> Date? {
        iso.date(from: ts) ?? isoNoFraction.date(from: ts)
    }

    /// Sum the cost of live runs whose timestamp falls within `window` seconds of `now`.
    public static func recentUsd(_ feed: [LiveRunEvent],
                                 within window: TimeInterval = 600,
                                 now: Date = Date()) -> Double {
        let cutoff = now.addingTimeInterval(-window)
        return feed.reduce(0) { acc, run in
            guard let t = parse(run.timestamp), t >= cutoff else { return acc }
            return acc + run.costUsd
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path apps/desktop --filter PopupMetricsTests`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/Sources/ObolusKit/PopupMetrics.swift apps/desktop/Tests/ObolusKitTests/PopupMetricsTests.swift
git commit -m "feat: popup metric helpers (daily-average trend, last-10m burn)"
```

---

## Task 4: ObolusKit — `Timeframe` enum + summary URL builder (TDD)

**Files:**
- Create: `apps/desktop/Sources/ObolusKit/Timeframe.swift`
- Modify: `apps/desktop/Sources/ObolusKit/SummaryStore.swift`
- Test: `apps/desktop/Tests/ObolusKitTests/TimeframeTests.swift`

- [ ] **Step 1: Write the failing tests** — create `apps/desktop/Tests/ObolusKitTests/TimeframeTests.swift`:

```swift
import XCTest
@testable import ObolusKit

final class TimeframeTests: XCTestCase {
    func testSinceParamOmittedOnlyForAll() {
        XCTAssertEqual(Timeframe.day.sinceParam, "1d")
        XCTAssertEqual(Timeframe.week.sinceParam, "7d")
        XCTAssertEqual(Timeframe.month.sinceParam, "30d")
        XCTAssertNil(Timeframe.all.sinceParam)
    }

    func testSummaryURLAddsSinceExceptForAll() {
        let base = URL(string: "http://127.0.0.1:4317")!
        XCTAssertEqual(
            SummaryStore.summaryURL(base: base, timeframe: .week).absoluteString,
            "http://127.0.0.1:4317/api/summary?since=7d"
        )
        XCTAssertEqual(
            SummaryStore.summaryURL(base: base, timeframe: .all).absoluteString,
            "http://127.0.0.1:4317/api/summary"
        )
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path apps/desktop --filter TimeframeTests`
Expected: FAIL to compile — `Timeframe` and `SummaryStore.summaryURL` are undefined.

- [ ] **Step 3: Create the enum** — create `apps/desktop/Sources/ObolusKit/Timeframe.swift`:

```swift
import Foundation

/// The dashboard's selectable history window. `rawValue` is the relative span the server's
/// `/api/summary?since=` understands (via `parseSince`); `all` means no filter (all-time).
public enum Timeframe: String, CaseIterable, Sendable, Identifiable {
    case day = "1d"
    case week = "7d"
    case month = "30d"
    case all = "all"

    public var id: String { rawValue }

    /// The `since` query value, or nil for all-time (no query param).
    public var sinceParam: String? { self == .all ? nil : rawValue }

    /// Short label for the segmented picker.
    public var label: String {
        switch self {
        case .day: return "1d"
        case .week: return "7d"
        case .month: return "30d"
        case .all: return "All"
        }
    }
}
```

- [ ] **Step 4: Add the URL builder + fetch to `SummaryStore`** — in `apps/desktop/Sources/ObolusKit/SummaryStore.swift`, add these methods inside the class (e.g. right after `refresh()`):

```swift
    /// Build the `/api/summary` URL for a timeframe (testable; pure).
    public static func summaryURL(base: URL, timeframe: Timeframe) -> URL {
        let endpoint = base.appendingPathComponent("api/summary")
        guard let since = timeframe.sinceParam else { return endpoint }
        var comps = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        comps?.queryItems = [URLQueryItem(name: "since", value: since)]
        return comps?.url ?? endpoint
    }

    /// One-shot windowed history fetch for the dashboard window. Independent of the popup's
    /// all-time `summary`/poll, so changing the dashboard range never starves the popup.
    public func fetchSummary(timeframe: Timeframe) async -> ScanSummary? {
        guard let base = baseURL else { return nil }
        do {
            let (data, response) = try await session.data(from: Self.summaryURL(base: base, timeframe: timeframe))
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            return try JSONDecoder().decode(ScanSummary.self, from: data)
        } catch {
            return nil
        }
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `swift test --package-path apps/desktop --filter TimeframeTests`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/Sources/ObolusKit/Timeframe.swift apps/desktop/Sources/ObolusKit/SummaryStore.swift apps/desktop/Tests/ObolusKitTests/TimeframeTests.swift
git commit -m "feat: Timeframe enum + windowed summary fetch in SummaryStore"
```

---

## Task 5: Popup redesign — Today-first `MenuBarView`

**Files:**
- Modify: `apps/desktop/Sources/Obolus/Views/MenuBarView.swift`

This view is not unit-tested (it's pure SwiftUI layout reading the Task 3 helpers); verify by building.

- [ ] **Step 1: Switch the default branch to one content view** — in `body`, replace:

```swift
            default:
                if store.isLive {
                    liveContent
                } else {
                    historyContent
                }
```

with:

```swift
            default:
                glanceContent
```

- [ ] **Step 2: Replace the live/history sections** — delete the entire `// MARK: - Live-first content` and `// MARK: - History fallback` regions (the `liveContent`, `sessionHero`, `activeContext`, `lastRunRow`, `volatility(for:)`, `todaySecondary`, and `historyContent` properties/methods — the replacement re-adds `activeContext`, so don't keep the old copy) and replace them with:

```swift
    // MARK: - Content (Today-first)

    /// Always lead with today's spend + trend. When live, add a "burning now" row;
    /// when idle, show where recent spend landed.
    private var glanceContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            todayHero
            if store.isLive {
                Divider()
                liveRow
            } else if !store.summary.byRepo.isEmpty {
                Divider()
                topRepos
            }
        }
    }

    /// Hero: today's spend (calendar day), a "vs daily average" chip, and a 7-day trend.
    private var todayHero: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Today").font(.caption).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(Fmt.usd(store.summary.costToday()))
                    .font(.system(size: 28, weight: .semibold)).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.6)
                if let chip = trendChip {
                    Text(chip.text).font(.caption2).fontWeight(.medium)
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(chip.tint.opacity(0.18), in: Capsule())
                        .foregroundStyle(chip.tint)
                }
                Spacer()
            }
            MiniSparkline(days: store.summary.recentDays(7))
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
    }

    /// The "is today normal?" cue, derived from today vs your trailing-7-day daily average.
    private var trendChip: (text: String, tint: Color)? {
        switch store.summary.todayTrend() {
        case .high(let r): return (String(format: "↑ %.1f× avg", r), Theme.estimated)
        case .low(let r): return (String(format: "↓ %.1f× avg", r), Theme.exact)
        case .normal: return ("≈ avg", .secondary)
        case .noBaseline: return nil
        }
    }

    /// "repo / branch" of the most recent live run — where spend is landing right now.
    private var activeContext: String? {
        guard let run = store.liveFeed.first else { return nil }
        if let branch = run.branch, !branch.isEmpty { return "\(run.repo) · \(branch)" }
        return run.repo
    }

    /// Live: where it's landing + the last-10-minute burn (a rate anchored to now).
    private var liveRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Circle().fill(Theme.exact).frame(width: 7, height: 7)
                Text("live").font(.caption).foregroundStyle(.secondary)
                if let active = activeContext {
                    Text("· \(active)").font(.caption).foregroundStyle(.secondary)
                        .lineLimit(1).truncationMode(.middle)
                }
                Spacer()
            }
            HStack {
                Text("last 10 min").font(.caption2).foregroundStyle(.tertiary)
                Spacer()
                Text(Fmt.usd(LiveBurn.recentUsd(store.liveFeed))).monospacedDigit().font(.callout)
            }
        }
    }

    /// Idle: where recent spend landed (top repos from local history).
    private var topRepos: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Top repos").font(.caption).foregroundStyle(.secondary)
            ForEach(store.summary.byRepo.prefix(3)) { repo in
                HStack {
                    Text(repo.key).lineLimit(1).truncationMode(.middle)
                    Spacer()
                    Text(Fmt.usd(repo.costUsd)).monospacedDigit().foregroundStyle(.secondary)
                }
                .font(.callout)
            }
        }
    }
```

- [ ] **Step 3: Update the doc comment** — replace the type doc comment above `struct MenuBarView` so it matches the new behavior:

```swift
/// The compact popover shown when the menu bar icon is clicked. Today-first: it always leads with
/// today's spend and how it compares to your recent daily average, plus a 7-day trend. When a
/// session is live it adds a "burning now" row (last 10 minutes); when idle it shows top repos.
```

- [ ] **Step 4: Build to verify it compiles**

Run: `swift build --package-path apps/desktop`
Expected: Build succeeds with no errors (no remaining references to the deleted `liveContent`/`sessionHero`/`lastRunRow`/`volatility`/`todaySecondary`/`historyContent`).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/Sources/Obolus/Views/MenuBarView.swift
git commit -m "feat: redesign menu-bar popup around Today + trend"
```

---

## Task 6: Dashboard window timeframe `Picker`

**Files:**
- Modify: `apps/desktop/Sources/Obolus/Views/DashboardView.swift`

- [ ] **Step 1: Add timeframe state + a windowed summary** — add these stored properties to `struct DashboardView` (after the `@EnvironmentObject` lines):

```swift
    @State private var timeframe: Timeframe = .week
    @State private var windowed: ScanSummary?

    /// The summary the history sections render: the windowed fetch when available, else the
    /// store's all-time poll (shown until the first windowed fetch resolves).
    private var displayed: ScanSummary { windowed ?? store.summary }
```

- [ ] **Step 2: Render the history sections from `displayed`** — in `body`, change the History `Group` to use `displayed` instead of `store.summary`:

```swift
                    // History plane.
                    Group {
                        historyCaption
                        KPISection(summary: displayed)
                        SpendByCommitSection(summary: displayed)
                        CompositionBar(composition: displayed.composition)
                        BreakdownSection(summary: displayed)
                        DailyTrendChart(summary: displayed)
                        SessionsTable(sessions: displayed.sessions)
                    }
```

- [ ] **Step 3: Fetch on appear and on change** — attach these modifiers to the root `VStack(spacing: 0) { ... }` of `body` (immediately after its closing brace, before `}` of the computed `body`):

```swift
        .task { windowed = await store.fetchSummary(timeframe: timeframe) }
        .onChange(of: timeframe) { _, newValue in
            Task { windowed = await store.fetchSummary(timeframe: newValue) }
        }
```

- [ ] **Step 4: Add the Picker to the header** — in the `header` computed property, insert the picker between the `Label` and the `Spacer()`:

```swift
    private var header: some View {
        HStack(spacing: 12) {
            Label("Obolus", systemImage: "chart.bar.xaxis")
                .font(.title3).fontWeight(.semibold)
            Picker("Time range", selection: $timeframe) {
                ForEach(Timeframe.allCases) { tf in Text(tf.label).tag(tf) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 220)
            Spacer()
            statusPill
            Button { Task { await store.refresh(); windowed = await store.fetchSummary(timeframe: timeframe) } } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
            .disabled(store.isLoading)
            .help("Refresh")
        }
    }
```

- [ ] **Step 5: Build to verify it compiles**

Run: `swift build --package-path apps/desktop`
Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/Sources/Obolus/Views/DashboardView.swift
git commit -m "feat: time-range Picker on the app dashboard window (default 7d)"
```

---

## Task 7: Full verification

- [ ] **Step 1: TS — build + full test suite**

Run: `pnpm build && pnpm test`
Expected: clean build; all vitest suites pass (including the new `serve.test.ts` case).

- [ ] **Step 2: Swift — full test suite + build**

Run: `swift test --package-path apps/desktop && swift build --package-path apps/desktop`
Expected: all XCTest pass (incl. `PopupMetricsTests`, `TimeframeTests`); app target builds.

- [ ] **Step 3: Manual app smoke (optional but recommended)** — build/run the menu bar app (see `apps/desktop/build-app.sh`). Confirm:
  - Popup leads with **Today $X** + a `≈ avg` / `↑ N× avg` chip + the 7-day sparkline; no "This session" / "Latest run".
  - While Claude Code runs in another terminal, a `● live · repo · branch` row appears with a `last 10 min $X` figure.
  - Open the dashboard window; the segmented `1d/7d/30d/All` control re-scopes every section; default is 7d.

- [ ] **Step 4: Final review** — confirm no stray references to removed symbols and the working tree contains only this feature's changes plus the pre-existing unrelated edits you started with:

```bash
git log --oneline feat/dashboard-timeframe-popup ^main
git status
```

---

## Self-review notes (already checked against the spec)

- **Spec A (server `?since=`)** → Task 1. **Spec B (web selector)** → Task 2; **(app selector)** → Tasks 4+6. **Spec C (popup)** → Tasks 3+5. **Spec D (testing)** → Task 1 (TS), Tasks 3-4 (Swift pure fns); views verified by build (spec says no View tests).
- Type/name consistency verified: `Timeframe.sinceParam` / `SummaryStore.summaryURL` / `fetchSummary(timeframe:)` / `SpendTrend` / `recentDailyAverage` / `todayTrend` / `LiveBurn.recentUsd` are defined once (Tasks 3-4) and consumed with the same signatures (Tasks 5-6).
- `1d/7d/30d` are rolling windows (`parseSince`), distinct by design from the popup's calendar-day `costToday()` — see spec.
```
