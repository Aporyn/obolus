import SwiftUI
import ObolusKit

/// Top-of-dashboard KPI cards: total cost, runs, tokens, and today's cost. History plane.
struct KPISection: View {
    let summary: ScanSummary

    private var today: GroupTotals? {
        let key = ScanSummary.dayKey(for: Date(), calendar: ScanSummary.utcCalendar)
        return summary.byDay.first { $0.key == key }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Grid(horizontalSpacing: 10, verticalSpacing: 10) {
                GridRow {
                    KPICard(label: "Total spend", value: Fmt.usd(summary.totalCostUsd), systemImage: "dollarsign.circle")
                    KPICard(label: "Total runs", value: Fmt.int(summary.totalRuns), systemImage: "bolt")
                    KPICard(label: "Total tokens", value: Fmt.tokens(summary.totalTokens), systemImage: "number")
                    KPICard(label: "Today", value: Fmt.usd(today?.costUsd ?? 0), systemImage: "calendar")
                }
            }
            if !summary.estimatedModels.isEmpty || !summary.unpricedModels.isEmpty {
                Text(estimateNote)
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    private var estimateNote: String {
        var parts: [String] = []
        if !summary.unpricedModels.isEmpty {
            parts.append("unpriced: \(summary.unpricedModels.joined(separator: ", "))")
        }
        if !summary.estimatedModels.isEmpty {
            parts.append("estimated rates: \(summary.estimatedModels.joined(separator: ", "))")
        }
        return "Cost is an estimate · " + parts.joined(separator: " · ")
    }
}
