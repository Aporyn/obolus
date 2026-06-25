import Foundation

/// Glance metrics derived for the menu-bar popup. Pure and View-free so they can be
/// unit-tested in ObolusKit without a display.

/// How today's spend compares to your recent daily norm — the popup's "is this normal?" cue.
/// Thresholds match the per-run volatility cue the popup used before (>=1.5x high, <=0.66x low).
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
        guard count > 0 else { return 0 }
        var sum = 0.0
        for offset in 1...count {
            guard let day = calendar.date(byAdding: .day, value: -offset, to: now) else { continue }
            let key = Self.dayKey(for: day, calendar: calendar)
            sum += byDay.first { $0.key == key }?.costUsd ?? 0
        }
        return sum / Double(count)
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

/// One vendor's spend on a single day — a segment of the popup's stacked daily chart.
public struct DailyVendorSlice: Equatable, Sendable, Identifiable {
    public let vendor: String   // "claude-code" | "codex"
    public let costUsd: Double
    public let runs: Int
    public var id: String { vendor }
}

/// A single day split by vendor: the unit the stacked sparkline draws and the hover readout
/// reports. `slices` is ordered (Claude Code first → bottom of the stack, then Codex) and holds
/// only vendors that actually spent that day; an empty `slices` is a quiet (padded) day.
public struct DailyVendorTotals: Equatable, Sendable, Identifiable {
    public let key: String      // local day, "YYYY-MM-DD"
    public let slices: [DailyVendorSlice]
    public var totalUsd: Double { slices.reduce(0) { $0 + $1.costUsd } }
    public var totalRuns: Int { slices.reduce(0) { $0 + $1.runs } }
    public var id: String { key }
}

public extension ScanSummary {
    /// The last `count` days, each split into per-vendor slices for the popup's stacked daily
    /// chart. Vendors are taken from `vendors[]` in `order`; a vendor with no spend on a given
    /// day is omitted. When `vendors` is empty (e.g. an older `obolus serve` predating the
    /// per-vendor breakdown), each day collapses to one combined slice tagged `combinedVendor`
    /// so the chart still renders. Days reuse `recentDays(_:)` so the window matches the rest of
    /// the popup exactly (same padding, same local-day keys).
    func recentDaysByVendor(_ count: Int,
                            order: [String] = ["claude-code", "codex"],
                            combinedVendor: String = "claude-code",
                            calendar: Calendar = ScanSummary.localCalendar,
                            now: Date = Date()) -> [DailyVendorTotals] {
        let keys = recentDays(count, calendar: calendar, now: now).map(\.key)

        // Index each present vendor's byDay once, preserving the requested order.
        let perVendor: [(vendor: String, byKey: [String: GroupTotals])] = order.compactMap { vendor in
            guard let vb = vendors.first(where: { $0.vendor == vendor }) else { return nil }
            let byKey = Dictionary(vb.summary.byDay.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })
            return (vendor, byKey)
        }

        return keys.map { key in
            // Fallback: no per-vendor breakdown — emit a single combined slice from `byDay`.
            guard !perVendor.isEmpty else {
                let g = byDay.first { $0.key == key }
                let slices = (g.map { $0.costUsd > 0 || $0.runs > 0 } ?? false)
                    ? [DailyVendorSlice(vendor: combinedVendor, costUsd: g!.costUsd, runs: g!.runs)]
                    : []
                return DailyVendorTotals(key: key, slices: slices)
            }
            let slices = perVendor.compactMap { pv -> DailyVendorSlice? in
                guard let g = pv.byKey[key], g.costUsd > 0 || g.runs > 0 else { return nil }
                return DailyVendorSlice(vendor: pv.vendor, costUsd: g.costUsd, runs: g.runs)
            }
            return DailyVendorTotals(key: key, slices: slices)
        }
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
