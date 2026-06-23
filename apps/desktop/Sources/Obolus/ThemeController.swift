import AppKit

/// Manual light/dark override that follows the system by default (per the shared design:
/// "follow system + manual toggle"). Drives the whole app — popover and dashboard window —
/// by setting `NSApp.appearance`. Persisted across launches.
@MainActor
final class ThemeController: ObservableObject {
    static let shared = ThemeController()

    enum Override: String { case system, light, dark }

    private let key = "obolusTheme"
    @Published private(set) var override: Override

    private init() {
        override = Override(rawValue: UserDefaults.standard.string(forKey: key) ?? "") ?? .system
        apply()
    }

    /// Toggle between light and dark relative to what is currently showing.
    func toggle() {
        let isDark = NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        set(isDark ? .light : .dark)
    }

    func set(_ value: Override) {
        override = value
        UserDefaults.standard.set(value.rawValue, forKey: key)
        apply()
    }

    private func apply() {
        switch override {
        case .system: NSApp.appearance = nil
        case .light: NSApp.appearance = NSAppearance(named: .aqua)
        case .dark: NSApp.appearance = NSAppearance(named: .darkAqua)
        }
    }
}
