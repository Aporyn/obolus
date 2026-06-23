import SwiftUI
import Charts
import ObolusKit

/// Per-dimension spend breakdown: a segmented control (repo / model / branch / kind) driving a
/// horizontal bar chart of the top rows. Mirrors the web dashboard's segmented breakdown.
struct BreakdownSection: View {
    let summary: ScanSummary

    enum Dimension: String, CaseIterable, Identifiable {
        case repo = "Repo"
        case model = "Model"
        case branch = "Branch"
        case kind = "Kind"
        var id: String { rawValue }
    }

    @State private var dimension: Dimension = .repo
    private let topN = 10

    private var rows: [GroupTotals] {
        let source: [GroupTotals]
        switch dimension {
        case .repo: source = summary.byRepo
        case .model: source = summary.byModel
        case .branch: source = summary.byBranch
        case .kind: source = summary.byKind
        }
        return Array(source.prefix(topN))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionHeader(title: "Spend breakdown", systemImage: "chart.bar")
                Picker("", selection: $dimension) {
                    ForEach(Dimension.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .fixedSize()
            }

            if rows.isEmpty {
                Text("No data yet.").font(.callout).foregroundStyle(.secondary)
            } else {
                Chart(rows) { row in
                    BarMark(
                        x: .value("Cost", row.costUsd),
                        y: .value(dimension.rawValue, row.key)
                    )
                    .foregroundStyle(Color.accentColor.gradient)
                    .annotation(position: .trailing, alignment: .leading) {
                        Text(Fmt.usd(row.costUsd)).font(.caption2).monospacedDigit().foregroundStyle(.secondary)
                    }
                }
                .chartYAxis {
                    AxisMarks(preset: .extended, position: .leading) { _ in
                        AxisValueLabel()
                    }
                }
                .frame(height: CGFloat(rows.count) * 26 + 20)
            }
        }
    }
}
