import Foundation

/// Formatting helpers for the Codex rate-limit gauge. Pure and View-free so they
/// can be unit-tested in ObolusKit without a display. Mirrors the web dashboard's
/// `untilStr` / percent rendering so both surfaces read identically.
public enum Quota {
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

    /// Human "time until" the reset instant: "2h 14m" / "5d 3h" / "now"; "" when unknown.
    public static func untilString(_ resetsAt: String?, now: Date = Date()) -> String {
        guard let resetsAt, let target = parse(resetsAt) else { return "" }
        let secs = target.timeIntervalSince(now)
        if secs <= 0 { return "now" }
        let mins = Int((secs / 60).rounded())
        if mins < 60 { return "\(mins)m" }
        let hours = mins / 60
        if hours < 24 { return "\(hours)h \(mins % 60)m" }
        return "\(hours / 24)d \(hours % 24)h"
    }

    /// A rounded whole-percent label, e.g. "62%".
    public static func percentString(_ usedPercent: Double) -> String {
        "\(Int(usedPercent.rounded()))%"
    }
}

public extension RateLimitSnapshot {
    /// The vendor's latest snapshot in `vendors`, or nil. Convenience for the UI.
    static func from(_ vendors: [VendorBreakdown], vendor: String) -> RateLimitSnapshot? {
        vendors.first { $0.vendor == vendor }?.rateLimit
    }
}
