import SwiftUI
import ObolusKit

/// The compact popover shown when the menu bar icon is clicked. Native materials/typography.
struct MenuBarView: View {
    @EnvironmentObject private var serve: ServeProcess
    @EnvironmentObject private var store: SummaryStore
    @EnvironmentObject private var actions: Actions

    private var todayKey: String {
        ScanSummary.dayKey(for: Date(), calendar: ScanSummary.utcCalendar)
    }
    private var today: GroupTotals? {
        store.summary.byDay.first { $0.key == todayKey }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header

            switch serve.state {
            case .failed(let message):
                backendNotice(icon: "exclamationmark.triangle", message: message, tint: .orange)
            case .starting where store.lastUpdated == nil:
                backendNotice(icon: "hourglass", message: "Starting obolus serve…", tint: .secondary)
            default:
                content
            }

            Divider()
            footer
        }
        .padding(14)
        .frame(width: 340)
    }

    private var header: some View {
        HStack {
            Label("Obolus", systemImage: "chart.bar.xaxis").font(.headline)
            Spacer()
            ConnectionDot(isLive: store.isLive)
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Today (UTC) KPIs — drawn from the History plane.
            HStack(spacing: 8) {
                KPICard(label: "Today", value: Fmt.usd(today?.costUsd ?? 0), systemImage: "dollarsign.circle")
                KPICard(label: "Runs", value: Fmt.int(today?.runs ?? 0), systemImage: "bolt")
                KPICard(label: "Tokens", value: Fmt.tokens(today?.totalTokens ?? 0), systemImage: "number")
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Last 7 days").font(.caption).foregroundStyle(.secondary)
                MiniSparkline(days: store.summary.recentDays(7))
            }

            if !store.summary.byRepo.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Top repos").font(.caption).foregroundStyle(.secondary)
                    ForEach(store.summary.byRepo.prefix(3)) { repo in
                        HStack {
                            Text(repo.key).lineLimit(1).truncationMode(.middle)
                            Spacer()
                            Text(Fmt.usd(repo.costUsd)).monospacedDigit().foregroundStyle(.secondary)
                        }
                        .font(.callout)
                    }
                }
            }

            liveSection
        }
    }

    private var liveSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Divider()
            LiveStatusHeader(isLive: store.isLive, trackingSince: store.trackingSince)
            if store.isLive {
                HStack {
                    Text("This session").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Text("\(Fmt.usd(store.runningUsd)) · \(store.runningRuns) runs")
                        .font(.caption).monospacedDigit()
                }
                ForEach(store.liveFeed.prefix(5)) { run in
                    HStack {
                        Text(run.repo).lineLimit(1).truncationMode(.middle)
                        Spacer()
                        Text(Fmt.usd(run.costUsd)).monospacedDigit().foregroundStyle(.secondary)
                    }
                    .font(.caption)
                }
            }
        }
    }

    private var footer: some View {
        HStack {
            Button {
                actions.openDashboard()
            } label: {
                Label("Open dashboard", systemImage: "macwindow")
            }
            Spacer()
            Button { ThemeController.shared.toggle() } label: {
                Image(systemName: "circle.lefthalf.filled")
            }
            .help("Toggle light / dark")
            Button { Task { await store.refresh() } } label: {
                Image(systemName: "arrow.clockwise")
            }
            .help("Refresh")
            Button { actions.quit() } label: {
                Image(systemName: "power")
            }
            .help("Quit Obolus")
        }
        .buttonStyle(.borderless)
        .controlSize(.small)
    }

    private func backendNotice(icon: String, message: String, tint: Color) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon).foregroundStyle(tint)
            Text(message).font(.callout).foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.vertical, 4)
    }
}
