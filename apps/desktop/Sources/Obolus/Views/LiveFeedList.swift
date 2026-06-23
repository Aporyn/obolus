import SwiftUI
import ObolusKit

/// The Live (this-session) plane: streaming runs since the app connected. Deliberately does NOT
/// backfill periods the app was closed — that gap is communicated, not hidden.
struct LiveFeedList: View {
    let isLive: Bool
    let trackingSince: Date?
    let runningUsd: Double
    let runningRuns: Int
    let feed: [LiveRunEvent]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionHeader(title: "Live feed", systemImage: "dot.radiowaves.left.and.right")
                if isLive {
                    Text("\(Fmt.usd(runningUsd)) · \(runningRuns) runs this session")
                        .font(.caption).monospacedDigit().foregroundStyle(.secondary)
                }
            }
            LiveStatusHeader(isLive: isLive, trackingSince: trackingSince)

            if isLive && feed.isEmpty {
                Text("Waiting for the next agent run…")
                    .font(.callout).foregroundStyle(.secondary).padding(.vertical, 6)
            } else if !feed.isEmpty {
                VStack(spacing: 0) {
                    ForEach(feed) { run in
                        HStack(spacing: 10) {
                            Text(Fmt.clock(run.timestamp)).font(.caption).monospacedDigit()
                                .foregroundStyle(.secondary).frame(width: 42, alignment: .leading)
                            Text(run.repo).lineLimit(1).truncationMode(.middle)
                            if run.isSidechain {
                                Text("subagent").font(.system(size: 9)).foregroundStyle(.secondary)
                                    .padding(.horizontal, 4).padding(.vertical, 1)
                                    .background(.quaternary, in: Capsule())
                            }
                            Spacer()
                            Text(run.model).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            Text(Fmt.usd(run.costUsd)).monospacedDigit().frame(width: 72, alignment: .trailing)
                        }
                        .font(.callout)
                        .padding(.vertical, 5)
                        Divider()
                    }
                }
                .animation(.default, value: feed.count)
            }
        }
    }
}
