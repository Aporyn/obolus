import Foundation

/// Number/date formatting that mirrors the web dashboard's `fmtUsd`, `fmtTokens`, `fmtInt`
/// so the native UI reads identically to `obolus serve` in a browser.
public enum Fmt {
    /// `$1,234.56` — two decimals, grouped thousands. Matches web `fmtUsd`.
    public static func usd(_ n: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        f.usesGroupingSeparator = true
        let body = f.string(from: NSNumber(value: n)) ?? String(format: "%.2f", n)
        return "$\(body)"
    }

    /// Compact token counts: `1.2B` / `3.4M` / `5.6k` / raw. Matches web `fmtTokens`.
    public static func tokens(_ n: Int) -> String {
        let d = Double(n)
        if d >= 1_000_000_000 { return trim(d / 1_000_000_000) + "B" }
        if d >= 1_000_000 { return trim(d / 1_000_000) + "M" }
        if d >= 1_000 { return trim(d / 1_000) + "k" }
        return "\(n)"
    }

    /// `1,234` — grouped integer. Matches web `fmtInt`.
    public static func int(_ n: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.usesGroupingSeparator = true
        return f.string(from: NSNumber(value: n)) ?? "\(n)"
    }

    /// One decimal place, dropping a trailing `.0` (so `1.0M` → `1M`, `1.2M` stays).
    private static func trim(_ value: Double) -> String {
        let s = String(format: "%.1f", value)
        return s.hasSuffix(".0") ? String(s.dropLast(2)) : s
    }

    /// `YYYY-MM-DD` slice of an ISO timestamp, matching the web `day(iso)` helper.
    public static func day(_ iso: String) -> String {
        String(iso.prefix(10))
    }

    /// A short local clock time (e.g. `14:32`) from an ISO timestamp, for the live feed.
    public static func clock(_ iso: String) -> String {
        guard let date = isoParser.date(from: iso) ?? isoParserNoFraction.date(from: iso) else {
            return Self.day(iso)
        }
        return clockTime(date)
    }

    /// A short local clock time (e.g. `14:32`) from a `Date`.
    public static func clockTime(_ date: Date) -> String {
        let out = DateFormatter()
        out.dateFormat = "HH:mm"
        return out.string(from: date)
    }

    private static let isoParser: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoParserNoFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}
