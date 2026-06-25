import SwiftUI
import Charts
import ObolusKit

/// A small native live/idle indicator dot.
struct ConnectionDot: View {
    let isLive: Bool
    var body: some View {
        Circle()
            .fill(isLive ? Theme.exact : Color.secondary.opacity(0.5))
            .frame(width: 8, height: 8)
            .accessibilityLabel(isLive ? "Live" : "Not capturing")
    }
}

/// Header for the live plane. Communicates coverage clearly (per the History-vs-Live design):
/// connected → "Live · tracking since <time>"; otherwise a clear "tracking off" message.
struct LiveStatusHeader: View {
    let isLive: Bool
    let trackingSince: Date?

    private var sinceText: String {
        guard let trackingSince else { return "" }
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: trackingSince)
    }

    var body: some View {
        HStack(spacing: 6) {
            ConnectionDot(isLive: isLive)
            if isLive {
                Text("Live · tracking since \(sinceText)")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Text("Real-time tracking off — open the app to capture live runs")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
    }
}

/// A KPI tile: small caption label over a large monospaced-digit value.
struct KPICard: View {
    let label: String
    let value: String
    var systemImage: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                if let systemImage { Image(systemName: systemImage).font(.caption2).foregroundStyle(.secondary) }
                Text(label).font(.caption).foregroundStyle(.secondary)
            }
            Text(value)
                .font(.title3).fontWeight(.semibold)
                .monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    }
}

/// "estimate" caption shown when a group includes unpriced/estimated models (parity with web).
struct EstimateBadge: View {
    let hasUnpriced: Bool
    let hasEstimated: Bool
    var body: some View {
        if hasUnpriced || hasEstimated {
            Text(hasUnpriced ? "unpriced" : "est.")
                .font(.system(size: 9, weight: .medium))
                .padding(.horizontal, 4).padding(.vertical, 1)
                .background(Theme.estimated.opacity(0.18), in: Capsule())
                .foregroundStyle(Theme.estimated)
        }
    }
}

/// A compact 7-day daily-cost chart for the popover. Each day's bar is *stacked by vendor*
/// (Claude Code = clay-orange, Codex = blue) so the proportion reads at a glance instead of a
/// flat sum. Resting state shows the 7-day total; hover reads back that day's per-vendor split.
struct MiniSparkline: View {
    let days: [DailyVendorTotals]
    @State private var hoverKey: String?

    private var hovered: DailyVendorTotals? { hoverKey.flatMap { k in days.first { $0.key == k } } }
    private var total: Double { days.reduce(0) { $0 + $1.totalUsd } }

    /// The signature accent for a vendor (Claude Code → orange, Codex/others → blue).
    private func color(for vendor: String) -> Color { Theme.palette(for: vendor).accent }

    private static func label(for vendor: String) -> String {
        vendor == "claude-code" ? "Claude Code" : vendor == "codex" ? "Codex" : vendor
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            readout
            chart
        }
    }

    @ViewBuilder private var readout: some View {
        Group {
            if let h = hovered, !h.slices.isEmpty {
                HStack(spacing: 7) {
                    Text(String(h.key.suffix(5))).foregroundStyle(.secondary) // MM-DD
                    ForEach(h.slices) { slice in
                        HStack(spacing: 3) {
                            Circle().fill(color(for: slice.vendor)).frame(width: 6, height: 6)
                            Text(Fmt.usd(slice.costUsd)).foregroundStyle(.secondary)
                        }
                        .help(MiniSparkline.label(for: slice.vendor))
                    }
                }
            } else {
                Text("7-day total \(Fmt.usd(total)) · hover a bar for a day")
                    .foregroundStyle(.tertiary)
            }
        }
        .font(.caption2).monospacedDigit()
        .frame(height: 13, alignment: .leading)
    }

    private var chart: some View {
        Chart {
            ForEach(days) { day in
                // Marks sharing an x-category stack; Claude Code is added first → bottom segment.
                ForEach(day.slices) { slice in
                    BarMark(x: .value("Day", day.key), y: .value("Cost", slice.costUsd))
                        .foregroundStyle(barColor(day: day.key, vendor: slice.vendor))
                        .cornerRadius(1.5)
                }
            }
        }
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks(values: .automatic) { value in
                AxisValueLabel {
                    if let key = value.as(String.self) { Text(String(key.suffix(5))).font(.system(size: 8)) } // MM-DD
                }
            }
        }
        .frame(height: 50)
        .chartOverlay { proxy in
            GeometryReader { geo in
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .onContinuousHover { phase in
                        switch phase {
                        case .active(let point):
                            let originX = geo[proxy.plotAreaFrame].origin.x
                            hoverKey = proxy.value(atX: point.x - originX, as: String.self)
                        case .ended:
                            hoverKey = nil
                        }
                    }
            }
        }
    }

    /// Keep each segment in its vendor's hue; dim the non-focused days while one is hovered.
    private func barColor(day key: String, vendor: String) -> Color {
        let base = color(for: vendor)
        guard let hovered = hoverKey else { return base }
        return hovered == key ? base : base.opacity(0.3)
    }
}
