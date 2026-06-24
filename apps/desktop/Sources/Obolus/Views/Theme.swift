import SwiftUI
import AppKit

/// A per-vendor accent ramp (saturated → muted). Only the accent changes per
/// vendor; neutrals and provenance tokens (Theme.exact/estimated) stay shared.
struct VendorPalette: Sendable {
    let accent: Color
    let accent2: Color
    let accent3: Color
    let accent4: Color
}

/// Shared semantic design tokens. The values here mirror the web dashboard's CSS variables
/// 1:1 (light + dark), so the native UI and `obolus serve` in a browser read identically.
/// Single source of truth: docs/design-tokens.md.
enum Theme {
    /// The blue accent ramp, saturated → muted. Web: `--accent` … `--accent-4`.
    static let accent = dyn(light: 0x0071e3, dark: 0x0a84ff)
    static let accent2 = dyn(light: 0x4a90d9, dark: 0x4a9eff)
    static let accent3 = dyn(light: 0x86a9c8, dark: 0x6e8aa8)
    static let accent4 = dyn(light: 0xc2cad0, dark: 0x515862)

    /// Attribution provenance (Spend by commit / release). Web: `--exact`, `--estimated`.
    static let exact = dyn(light: 0x30a46c, dark: 0x30d158)
    static let estimated = dyn(light: 0xc2820a, dark: 0xff9f0a)
    static let unattributed = Color.secondary

    // MARK: Per-vendor accent ramps — only the accent changes per vendor tab.

    /// Codex + the combined "All" view keep the tuned blue ramp.
    static let codexPalette = VendorPalette(accent: accent, accent2: accent2, accent3: accent3, accent4: accent4)
    /// Claude Code's iconic clay-orange ramp (web: `[data-vendor="claude-code"]`).
    static let claudePalette = VendorPalette(
        accent: dyn(light: 0xD97757, dark: 0xE8956D),
        accent2: dyn(light: 0xE0926E, dark: 0xE0926E),
        accent3: dyn(light: 0xD2A893, dark: 0xB5897A),
        accent4: dyn(light: 0xE3D2C8, dark: 0x5C4F47)
    )
    /// Resolve the accent ramp for a vendor key ("claude-code" → orange; else blue).
    static func palette(for vendor: String?) -> VendorPalette {
        vendor == "claude-code" ? claudePalette : codexPalette
    }

    /// A token that resolves to its light or dark hex against the effective appearance —
    /// so both follow-system and the manual toggle (`ThemeController`) recolor correctly.
    private static func dyn(light: Int, dark: Int) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return NSColor(rgb: isDark ? dark : light)
        })
    }
}

private extension NSColor {
    /// Build an opaque sRGB color from a `0xRRGGBB` literal.
    convenience init(rgb: Int) {
        self.init(
            srgbRed: Double((rgb >> 16) & 0xff) / 255,
            green: Double((rgb >> 8) & 0xff) / 255,
            blue: Double(rgb & 0xff) / 255,
            alpha: 1
        )
    }
}

/// The active vendor's accent ramp, injected per dashboard tab. Defaults to the
/// blue ramp (used by the combined "All" view and Codex).
private struct VendorPaletteKey: EnvironmentKey {
    static let defaultValue = Theme.codexPalette
}

extension EnvironmentValues {
    var vendorPalette: VendorPalette {
        get { self[VendorPaletteKey.self] }
        set { self[VendorPaletteKey.self] = newValue }
    }
}
