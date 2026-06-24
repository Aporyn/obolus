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
