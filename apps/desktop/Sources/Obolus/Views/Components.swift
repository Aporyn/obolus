import SwiftUI
import Charts
import ObolusKit

/// A small native live/idle indicator dot.
struct ConnectionDot: View {
    let isLive: Bool
    var body: some View {
        Circle()
            .fill(isLive ? Color.green : Color.secondary.opacity(0.5))
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
                .background(.orange.opacity(0.18), in: Capsule())
                .foregroundStyle(.orange)
        }
    }
}

/// A compact daily-cost sparkline for the popover.
struct MiniSparkline: View {
    let days: [GroupTotals]
    var body: some View {
        Chart(days) { day in
            BarMark(
                x: .value("Day", day.key),
                y: .value("Cost", day.costUsd)
            )
            .foregroundStyle(Color.accentColor.gradient)
            .cornerRadius(1.5)
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .frame(height: 38)
    }
}
