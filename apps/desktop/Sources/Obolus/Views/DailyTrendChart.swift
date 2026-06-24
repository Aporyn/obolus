import SwiftUI
import Charts
import ObolusKit

/// Daily spend trend (last ~21 days), drawn as native bars. History plane.
struct DailyTrendChart: View {
    let summary: ScanSummary
    @Environment(\.vendorPalette) private var palette
    private let windowDays = 21

    private var days: [GroupTotals] { summary.recentDays(windowDays) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Daily trend", systemImage: "calendar")
            Chart(days) { day in
                BarMark(
                    x: .value("Day", day.key),
                    y: .value("Cost", day.costUsd)
                )
                .foregroundStyle(palette.accent2)
                .cornerRadius(2)
            }
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 6)) { value in
                    AxisGridLine()
                    AxisValueLabel {
                        if let key = value.as(String.self) { Text(String(key.suffix(5))) } // MM-DD
                    }
                }
            }
            .chartYAxis {
                AxisMarks { value in
                    AxisGridLine()
                    AxisValueLabel {
                        if let cost = value.as(Double.self) { Text(Fmt.usd(cost)) }
                    }
                }
            }
            .frame(height: 180)
        }
    }
}
