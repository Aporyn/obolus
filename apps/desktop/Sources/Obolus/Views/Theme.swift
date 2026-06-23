import SwiftUI

/// Shared semantic design tokens. The values here mirror the web dashboard's CSS variables —
/// keep both in sync (single source of truth: docs/design-tokens.md).
enum Theme {
    /// Attribution provenance (Spend by commit / release).
    /// Web counterparts: `--exact`, `--estimated`, `--unattributed`.
    static let exact = Color.green
    static let estimated = Color.orange
    static let unattributed = Color.secondary
}
