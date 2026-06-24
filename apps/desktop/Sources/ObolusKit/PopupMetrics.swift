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
