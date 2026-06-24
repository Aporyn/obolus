import XCTest
@testable import ObolusKit

final class ModelsTests: XCTestCase {
    // A trimmed but structurally complete /api/summary payload.
    private let summaryJSON = """
    {
      "totalRuns": 3,
      "totalTokens": 1500,
      "totalCostUsd": 12.5,
      "composition": {"inputUsd": 1.0, "outputUsd": 2.0, "cacheReadUsd": 4.0, "cacheWriteUsd": 5.0, "serverToolUsd": 0.5},
      "unpricedModels": [],
      "estimatedModels": ["claude-fable-5"],
      "byRepo": [{"key":"obolus","runs":3,"inputTokens":100,"outputTokens":200,"cacheTokens":300,"totalTokens":1500,"costUsd":12.5,"hasUnpriced":false,"hasEstimated":true}],
      "byModel": [],
      "byBranch": [],
      "byDay": [{"key":"2026-06-23","runs":2,"inputTokens":10,"outputTokens":20,"cacheTokens":30,"totalTokens":900,"costUsd":9.0,"hasUnpriced":false,"hasEstimated":false}],
      "byWeek": [],
      "byKind": [],
      "sessions": [{"key":"s1","runs":3,"inputTokens":100,"outputTokens":200,"cacheTokens":300,"totalTokens":1500,"costUsd":12.5,"hasUnpriced":false,"hasEstimated":true,"repo":"obolus","branch":null,"firstSeen":"2026-06-23T10:00:00Z","lastSeen":"2026-06-23T12:00:00Z"}],
      "topRuns": [{"repo":"obolus","branch":"main","model":"claude-opus-4-8","sessionId":"s1","timestamp":"2026-06-23T11:00:00Z","costUsd":5.0,"totalTokens":700,"isSidechain":false}],
      "byCommit": [
        {"key":"aaaaaaaa","runs":2,"inputTokens":50,"outputTokens":100,"cacheTokens":150,"totalTokens":900,"costUsd":9.0,"hasUnpriced":false,"hasEstimated":false,"subject":"first","committedAt":"2026-06-23T10:00:00Z","release":"v1","exactUsd":4.0,"estimatedUsd":5.0},
        {"key":"(unattributed)","runs":1,"inputTokens":50,"outputTokens":100,"cacheTokens":150,"totalTokens":600,"costUsd":3.5,"hasUnpriced":false,"hasEstimated":true,"subject":"","committedAt":"","release":null,"exactUsd":0.0,"estimatedUsd":0.0}
      ],
      "byRelease": [
        {"key":"v1","runs":2,"inputTokens":50,"outputTokens":100,"cacheTokens":150,"totalTokens":900,"costUsd":9.0,"hasUnpriced":false,"hasEstimated":false,"firstCommitAt":"2026-06-23T10:00:00Z","lastCommitAt":"2026-06-23T10:00:00Z","commitCount":1,"exactUsd":4.0,"estimatedUsd":5.0}
      ],
      "vendors": []
    }
    """

    func testDecodeScanSummary() throws {
        let summary = try JSONDecoder().decode(ScanSummary.self, from: Data(summaryJSON.utf8))
        XCTAssertEqual(summary.totalRuns, 3)
        XCTAssertEqual(summary.totalCostUsd, 12.5, accuracy: 1e-9)
        XCTAssertEqual(summary.composition.totalUsd, 12.5, accuracy: 1e-9)
        // Separately-billed server tools decode and fold into the composition total.
        XCTAssertEqual(summary.composition.serverToolUsd, 0.5, accuracy: 1e-9)
        XCTAssertEqual(summary.byRepo.first?.key, "obolus")
        XCTAssertTrue(summary.byRepo.first?.hasEstimated == true)
        XCTAssertNil(summary.sessions.first?.branch)
        XCTAssertEqual(summary.topRuns.first?.branch, "main")
        XCTAssertEqual(summary.estimatedModels, ["claude-fable-5"])
    }

    func testDecodeByCommitAndRelease() throws {
        let summary = try JSONDecoder().decode(ScanSummary.self, from: Data(summaryJSON.utf8))

        XCTAssertEqual(summary.byCommit.count, 2)
        let first = try XCTUnwrap(summary.byCommit.first)
        XCTAssertEqual(first.key, "aaaaaaaa")
        XCTAssertEqual(first.subject, "first")
        XCTAssertEqual(first.release, "v1")
        XCTAssertEqual(first.exactUsd, 4.0, accuracy: 1e-9)
        XCTAssertEqual(first.estimatedUsd, 5.0, accuracy: 1e-9)
        XCTAssertFalse(first.isUnattributed)
        XCTAssertTrue(summary.byCommit.last?.isUnattributed ?? false)

        // Conservation: per-commit costs sum to the total.
        let sumCommit = summary.byCommit.reduce(0.0) { $0 + $1.costUsd }
        XCTAssertEqual(sumCommit, summary.totalCostUsd, accuracy: 1e-9)

        XCTAssertEqual(summary.byRelease.first?.key, "v1")
        XCTAssertEqual(summary.byRelease.first?.commitCount, 1)
    }

    func testCostTodayUsesUTCDay() throws {
        let summary = try JSONDecoder().decode(ScanSummary.self, from: Data(summaryJSON.utf8))
        // Build a UTC "now" on the same day as the byDay key.
        let cal = ScanSummary.utcCalendar
        let now = cal.date(from: DateComponents(timeZone: TimeZone(identifier: "UTC"),
                                                year: 2026, month: 6, day: 23, hour: 23, minute: 30))!
        XCTAssertEqual(summary.costToday(calendar: cal, now: now), 9.0, accuracy: 1e-9)
    }

    func testRecentDaysPadsMissingDays() throws {
        let summary = try JSONDecoder().decode(ScanSummary.self, from: Data(summaryJSON.utf8))
        let cal = ScanSummary.utcCalendar
        let now = cal.date(from: DateComponents(timeZone: TimeZone(identifier: "UTC"),
                                                year: 2026, month: 6, day: 23, hour: 12))!
        let days = summary.recentDays(7, calendar: cal, now: now)
        XCTAssertEqual(days.count, 7)
        XCTAssertEqual(days.last?.key, "2026-06-23")          // today present
        XCTAssertEqual(try XCTUnwrap(days.last).costUsd, 9.0, accuracy: 1e-9)
        XCTAssertEqual(days.first?.key, "2026-06-17")          // padded zero day
        XCTAssertEqual(days.first?.costUsd, 0)
    }

    func testEmptySummaryIsSafe() {
        XCTAssertEqual(ScanSummary.empty.totalRuns, 0)
        XCTAssertEqual(ScanSummary.empty.recentDays(7).count, 7)
        XCTAssertEqual(ScanSummary.empty.costToday(), 0)
    }
}
