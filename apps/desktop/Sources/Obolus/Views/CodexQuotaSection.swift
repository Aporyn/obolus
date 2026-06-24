import SwiftUI
import ObolusKit

/// The Codex-only headline metric. `$` mirrors what Claude Code shows (dollar
/// spend); `5h` shows the rolling rate-limit window Codex uniquely persists.
enum CodexMetric: String, CaseIterable, Identifiable {
    case dollars = "$"
    case fiveH = "5h"
    var id: String { rawValue }
}

/// Codex quota panel for the dashboard window: a `$ ↔ 5h` toggle over either the
/// total Codex spend or the 5h rate-limit gauge (with a weekly secondary line).
struct CodexQuotaSection: View {
    let totalUsd: Double
    let rateLimit: RateLimitSnapshot?
    @Binding var metric: CodexMetric
    @Environment(\.vendorPalette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionHeader(title: "Codex quota", systemImage: "speedometer")
                Picker("", selection: $metric) {
                    ForEach(CodexMetric.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .fixedSize()
            }
            content
        }
    }

    @ViewBuilder private var content: some View {
        switch metric {
        case .dollars:
            VStack(alignment: .leading, spacing: 4) {
                Text(Fmt.usd(totalUsd))
                    .font(.system(size: 30, weight: .semibold)).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.6)
                Text("total Codex spend · the same lens Claude Code shows")
                    .font(.caption).foregroundStyle(.secondary)
            }
        case .fiveH:
            if let primary = rateLimit?.primary {
                QuotaGauge(window: primary, fill: palette.accent)
                if let weekly = rateLimit?.secondary {
                    Text(weeklyLine(weekly, plan: rateLimit?.planType))
                        .font(.caption).foregroundStyle(.secondary)
                }
            } else {
                Text("No rate-limit data yet — run Codex to populate the 5h quota.")
                    .font(.callout).foregroundStyle(.secondary)
            }
        }
    }

    private func weeklyLine(_ window: RateLimitWindow, plan: String?) -> String {
        var parts = ["weekly: \(Quota.percentString(window.usedPercent)) used"]
        let reset = Quota.untilString(window.resetsAt)
        if !reset.isEmpty { parts.append("resets in \(reset)") }
        if let plan, !plan.isEmpty { parts.append("\(plan) plan") }
        return parts.joined(separator: " · ")
    }
}

/// A horizontal quota meter: filled to `window.usedPercent`, with a labelled readout.
struct QuotaGauge: View {
    let window: RateLimitWindow
    let fill: Color

    private var fraction: CGFloat { CGFloat(min(max(window.usedPercent / 100, 0), 1)) }

    private var metaLine: String {
        var line = "\(Quota.percentString(window.usedPercent)) of 5h window used"
        let reset = Quota.untilString(window.resetsAt)
        if !reset.isEmpty { line += " · resets in \(reset)" }
        return line
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(.quaternary)
                    Capsule().fill(fill).frame(width: geo.size.width * fraction)
                }
            }
            .frame(height: 14)
            Text(metaLine).font(.callout).monospacedDigit()
        }
    }
}
