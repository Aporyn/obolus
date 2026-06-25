import XCTest
@testable import ObolusKit

final class PopupMetricsTests: XCTestCase {
    // Fixed UTC clock + calendar so day-key math is deterministic.
    private let now = ISO8601DateFormatter().date(from: "2026-06-24T12:00:00Z")!
    private let utc = ScanSummary.utcCalendar

    private func bucket(_ key: String, _ cost: Double) -> GroupTotals {
        GroupTotals(key: key, runs: 1, inputTokens: 0, outputTokens: 0, cacheTokens: 0,
                    totalTokens: 0, costUsd: cost, hasUnpriced: false, hasEstimated: false)
    }

    private func summary(_ days: [GroupTotals], vendors: [VendorBreakdown] = []) -> ScanSummary {
        ScanSummary(
            totalRuns: 0, totalTokens: 0, totalCostUsd: 0,
            composition: CostComposition(inputUsd: 0, outputUsd: 0, cacheReadUsd: 0, cacheWriteUsd: 0, serverToolUsd: 0),
            unpricedModels: [], estimatedModels: [],
            byRepo: [], byModel: [], byBranch: [], byDay: days, byWeek: [], byKind: [],
            sessions: [], topRuns: [], byCommit: [], byRelease: [], vendors: vendors
        )
    }

    /// A per-vendor breakdown carrying only a `byDay` series (enough for the stacked chart).
    private func breakdown(_ vendor: String, _ days: [GroupTotals]) -> VendorBreakdown {
        VendorBreakdown(vendor: vendor, rateLimit: nil, summary: summary(days))
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

    func testRecentDaysByVendorSplitsEachDayAndKeepsVendorOrder() {
        let cc = breakdown("claude-code", [bucket("2026-06-24", 40), bucket("2026-06-23", 10)])
        let cx = breakdown("codex", [bucket("2026-06-24", 29), bucket("2026-06-22", 5)])
        let s = summary([bucket("2026-06-24", 69), bucket("2026-06-23", 10), bucket("2026-06-22", 5)],
                        vendors: [cc, cx])
        let days = s.recentDaysByVendor(7, calendar: utc, now: now)

        XCTAssertEqual(days.count, 7)
        // 06-24: both agents, Claude Code first (bottom of the stack), then Codex.
        let today = try! XCTUnwrap(days.last)
        XCTAssertEqual(today.key, "2026-06-24")
        XCTAssertEqual(today.slices.map(\.vendor), ["claude-code", "codex"])
        XCTAssertEqual(today.slices[0].costUsd, 40, accuracy: 1e-9)
        XCTAssertEqual(today.slices[1].costUsd, 29, accuracy: 1e-9)
        XCTAssertEqual(today.totalUsd, 69, accuracy: 1e-9)
        // 06-23: only Claude Code spent; 06-22: only Codex.
        XCTAssertEqual(days.first { $0.key == "2026-06-23" }?.slices.map(\.vendor), ["claude-code"])
        XCTAssertEqual(days.first { $0.key == "2026-06-22" }?.slices.map(\.vendor), ["codex"])
    }

    func testRecentDaysByVendorOmitsVendorsWithNoSpendAndPadsQuietDays() {
        let cc = breakdown("claude-code", [bucket("2026-06-24", 40)])
        let cx = breakdown("codex", [bucket("2026-06-24", 29)])
        let s = summary([bucket("2026-06-24", 69)], vendors: [cc, cx])
        let days = s.recentDaysByVendor(7, calendar: utc, now: now)
        // A padded quiet day carries no slices (renders as a gap, not a zero-height stack).
        let quiet = try! XCTUnwrap(days.first { $0.key == "2026-06-20" })
        XCTAssertTrue(quiet.slices.isEmpty)
        XCTAssertEqual(quiet.totalUsd, 0)
    }

    func testRecentDaysByVendorFallsBackToCombinedWhenNoBreakdown() {
        // An older serve returns no per-vendor breakdown — collapse to a single combined slice.
        let s = summary([bucket("2026-06-24", 12)])
        let days = s.recentDaysByVendor(7, calendar: utc, now: now)
        let today = try! XCTUnwrap(days.last)
        XCTAssertEqual(today.slices.map(\.vendor), ["claude-code"])
        XCTAssertEqual(today.totalUsd, 12, accuracy: 1e-9)
    }

    func testRecentBurnSumsOnlyRunsWithinWindow() {
        func run(_ ts: String, _ cost: Double) -> LiveRunEvent {
            LiveRunEvent(vendor: nil, repo: "r", branch: nil, commit: nil, model: "m", costUsd: cost,
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
