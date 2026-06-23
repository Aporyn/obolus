import Foundation

// Swift mirrors of the JSON returned by `obolus serve`.
// Source of truth for these shapes: src/report/aggregate.ts (ScanSummary, GroupTotals,
// SessionTotals, RunRef, CostComposition) and src/dashboard/serve.ts (the SSE payload).
// Keep field names in sync with the TS interfaces — the app must not diverge from the
// collector's aggregation.

/// Where the money went, split by token class. Mirrors `CostComposition`.
public struct CostComposition: Codable, Equatable, Sendable {
    public let inputUsd: Double
    public let outputUsd: Double
    public let cacheReadUsd: Double
    public let cacheWriteUsd: Double

    public var totalUsd: Double { inputUsd + outputUsd + cacheReadUsd + cacheWriteUsd }
}

/// Rolled-up totals for one grouping key (a repo, model, branch, day, ...). Mirrors `GroupTotals`.
public struct GroupTotals: Codable, Equatable, Identifiable, Sendable {
    public let key: String
    public let runs: Int
    public let inputTokens: Int
    public let outputTokens: Int
    public let cacheTokens: Int
    public let totalTokens: Int
    public let costUsd: Double
    public let hasUnpriced: Bool
    public let hasEstimated: Bool

    public var id: String { key }
}

/// A session roll-up, enriched with repo/branch and its time span. Mirrors `SessionTotals`.
public struct SessionTotals: Codable, Equatable, Identifiable, Sendable {
    public let key: String
    public let runs: Int
    public let inputTokens: Int
    public let outputTokens: Int
    public let cacheTokens: Int
    public let totalTokens: Int
    public let costUsd: Double
    public let hasUnpriced: Bool
    public let hasEstimated: Bool
    public let repo: String
    public let branch: String?
    public let firstSeen: String
    public let lastSeen: String

    public var id: String { key }
}

/// A single high-cost run, surfaced to expose outliers. Mirrors `RunRef`.
public struct RunRef: Codable, Equatable, Identifiable, Sendable {
    public let repo: String
    public let branch: String?
    public let model: String
    public let sessionId: String
    public let timestamp: String
    public let costUsd: Double
    public let totalTokens: Int
    public let isSidechain: Bool

    public var id: String { "\(sessionId)|\(timestamp)|\(model)" }
}

/// Per-commit totals, with an exact/estimated attribution split. Mirrors `CommitTotals`.
public struct CommitTotals: Codable, Equatable, Identifiable, Sendable {
    public let key: String
    public let runs: Int
    public let inputTokens: Int
    public let outputTokens: Int
    public let cacheTokens: Int
    public let totalTokens: Int
    public let costUsd: Double
    public let hasUnpriced: Bool
    public let hasEstimated: Bool
    public let subject: String
    public let committedAt: String
    public let release: String?
    public let exactUsd: Double
    public let estimatedUsd: Double

    public var id: String { key }
    public var isUnattributed: Bool { key == "(unattributed)" }
}

/// Per-release totals (a git tag, `unreleased`, or `(unattributed)`). Mirrors `ReleaseTotals`.
public struct ReleaseTotals: Codable, Equatable, Identifiable, Sendable {
    public let key: String
    public let runs: Int
    public let inputTokens: Int
    public let outputTokens: Int
    public let cacheTokens: Int
    public let totalTokens: Int
    public let costUsd: Double
    public let hasUnpriced: Bool
    public let hasEstimated: Bool
    public let firstCommitAt: String
    public let lastCommitAt: String
    public let commitCount: Int
    public let exactUsd: Double
    public let estimatedUsd: Double

    public var id: String { key }
    public var isUnattributed: Bool { key == "(unattributed)" }
}

/// The full scan summary returned by `GET /api/summary`. Mirrors `ScanSummary`.
public struct ScanSummary: Codable, Equatable, Sendable {
    public let totalRuns: Int
    public let totalTokens: Int
    public let totalCostUsd: Double
    public let composition: CostComposition
    public let unpricedModels: [String]
    public let estimatedModels: [String]
    public let byRepo: [GroupTotals]
    public let byModel: [GroupTotals]
    public let byBranch: [GroupTotals]
    public let byDay: [GroupTotals]
    public let byWeek: [GroupTotals]
    public let byKind: [GroupTotals]
    public let sessions: [SessionTotals]
    public let topRuns: [RunRef]
    public let byCommit: [CommitTotals]
    public let byRelease: [ReleaseTotals]
}

/// One live run streamed over `GET /api/events` (SSE). Mirrors the payload built in serve.ts.
public struct LiveRunEvent: Codable, Equatable, Identifiable, Sendable {
    public let repo: String
    public let branch: String?
    public let commit: String?
    public let model: String
    public let costUsd: Double
    public let tokens: Int
    public let timestamp: String
    public let isSidechain: Bool
    public let runningUsd: Double
    public let runningRuns: Int

    // The stream has no stable id; the app assigns one on arrival.
    public var id: String { "\(timestamp)|\(repo)|\(model)|\(runningRuns)" }
}

public extension ScanSummary {
    /// `byDay`/`byWeek` keys are UTC dates (serve slices the UTC ISO timestamp), so day-key
    /// lookups must use UTC to match `/api/summary` exactly — not the user's local calendar.
    static var utcCalendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC") ?? c.timeZone
        return c
    }

    /// An empty summary used as the initial state before the first fetch.
    static let empty = ScanSummary(
        totalRuns: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        composition: CostComposition(inputUsd: 0, outputUsd: 0, cacheReadUsd: 0, cacheWriteUsd: 0),
        unpricedModels: [],
        estimatedModels: [],
        byRepo: [],
        byModel: [],
        byBranch: [],
        byDay: [],
        byWeek: [],
        byKind: [],
        sessions: [],
        topRuns: [],
        byCommit: [],
        byRelease: []
    )

    /// Cost for today (UTC day, matching the server's `byDay` keys), derived from `byDay`.
    func costToday(calendar: Calendar = ScanSummary.utcCalendar, now: Date = Date()) -> Double {
        let key = Self.dayKey(for: now, calendar: calendar)
        return byDay.first { $0.key == key }?.costUsd ?? 0
    }

    /// The last `count` daily buckets (ascending), padded so the sparkline always has a full window.
    func recentDays(_ count: Int, calendar: Calendar = ScanSummary.utcCalendar, now: Date = Date()) -> [GroupTotals] {
        var out: [GroupTotals] = []
        for offset in stride(from: count - 1, through: 0, by: -1) {
            guard let day = calendar.date(byAdding: .day, value: -offset, to: now) else { continue }
            let key = Self.dayKey(for: day, calendar: calendar)
            if let existing = byDay.first(where: { $0.key == key }) {
                out.append(existing)
            } else {
                out.append(GroupTotals(key: key, runs: 0, inputTokens: 0, outputTokens: 0,
                                       cacheTokens: 0, totalTokens: 0, costUsd: 0,
                                       hasUnpriced: false, hasEstimated: false))
            }
        }
        return out
    }

    static func dayKey(for date: Date, calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}
