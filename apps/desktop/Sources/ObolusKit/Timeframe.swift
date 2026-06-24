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
