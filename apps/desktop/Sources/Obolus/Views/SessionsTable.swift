import SwiftUI
import ObolusKit

/// Top sessions ranked by cost, in a native macOS `Table`. History plane.
struct SessionsTable: View {
    let sessions: [SessionTotals]
    private let topN = 15

    private var rows: [SessionTotals] { Array(sessions.prefix(topN)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Top sessions", systemImage: "list.bullet.rectangle")
            if rows.isEmpty {
                Text("No sessions yet.").font(.callout).foregroundStyle(.secondary)
            } else {
                Table(rows) {
                    TableColumn("Repo") { Text($0.repo).lineLimit(1).truncationMode(.middle) }
                    TableColumn("Branch") { Text($0.branch ?? "—").foregroundStyle(.secondary).lineLimit(1) }
                    TableColumn("Runs") { Text(Fmt.int($0.runs)).monospacedDigit() }
                    TableColumn("Tokens") { Text(Fmt.tokens($0.totalTokens)).monospacedDigit() }
                    TableColumn("Cost") { row in
                        HStack(spacing: 4) {
                            Text(Fmt.usd(row.costUsd)).monospacedDigit()
                            EstimateBadge(hasUnpriced: row.hasUnpriced, hasEstimated: row.hasEstimated)
                        }
                    }
                    TableColumn("Last seen") { Text(Fmt.day($0.lastSeen)).foregroundStyle(.secondary).monospacedDigit() }
                }
                .frame(height: CGFloat(rows.count) * 24 + 40)
            }
        }
    }
}
