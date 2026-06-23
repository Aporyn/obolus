import SwiftUI
import ObolusKit

/// The compact popover shown when the menu bar icon is clicked. Live-first: when a session is
/// active, the current burn — running spend, the latest run, and how it compares to your norm —
/// leads; today's history is secondary. When nothing is live, it falls back to a history glance.
struct MenuBarView: View {
    @EnvironmentObject private var serve: ServeProcess
    @EnvironmentObject private var store: SummaryStore
    @EnvironmentObject private var actions: Actions

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header

            switch serve.state {
            case .failed(let message):
                backendNotice(icon: "exclamationmark.triangle", message: message, tint: Theme.estimated)
            case .starting where store.lastUpdated == nil:
                backendNotice(icon: "hourglass", message: "Starting obolus serve…", tint: .secondary)
            default:
                if store.isLive {
                    liveContent
                } else {
                    historyContent
                }
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

    // MARK: - Live-first content

    private var liveContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            sessionHero

            if let run = store.liveFeed.first {
                lastRunRow(run)
            }

            Divider()
            todaySecondary
        }
    }

    /// The hero: spend burned in this session (since the live stream connected).
    private var sessionHero: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text("This session").font(.caption).foregroundStyle(.secondary)
                if let since = store.trackingSince {
                    Text("· since \(Fmt.clockTime(since))").font(.caption2).foregroundStyle(.tertiary)
                }
                Spacer()
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(Fmt.usd(store.runningUsd))
                    .font(.system(size: 28, weight: .semibold)).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.6)
                Text("\(store.runningRuns) \(store.runningRuns == 1 ? "run" : "runs")")
                    .font(.callout).foregroundStyle(.secondary)
                Spacer()
            }
            if let active = activeContext {
                Label(active, systemImage: "point.3.connected.trianglepath.dotted")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
            } else {
                Text("Waiting for activity — keep coding to see it here.")
                    .font(.caption).foregroundStyle(.tertiary)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
    }

    /// "repo / branch" of the most recent live run, the place spend is landing right now.
    private var activeContext: String? {
        guard let run = store.liveFeed.first else { return nil }
        if let branch = run.branch, !branch.isEmpty { return "\(run.repo) · \(branch)" }
        return run.repo
    }

    /// The latest run, with a volatility cue — the "is this one unusually expensive?" signal.
    private func lastRunRow(_ run: LiveRunEvent) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Latest run").font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 8) {
                Text(run.repo).lineLimit(1).truncationMode(.middle).font(.callout)
                if run.isSidechain {
                    Text("sub").font(.system(size: 9, weight: .medium))
                        .padding(.horizontal, 4).padding(.vertical, 1)
                        .background(.quaternary, in: Capsule()).foregroundStyle(.secondary)
                }
                Spacer()
                if let v = volatility(for: run) {
                    Text(v.text).font(.caption2).fontWeight(.medium)
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(v.tint.opacity(0.18), in: Capsule())
                        .foregroundStyle(v.tint)
                }
                Text(Fmt.usd(run.costUsd)).monospacedDigit().font(.callout)
            }
        }
    }

    /// Compare a run to your average run cost. High multiples are the anomaly worth flagging.
    private func volatility(for run: LiveRunEvent) -> (text: String, tint: Color)? {
        let runs = store.summary.totalRuns
        guard runs > 0 else { return nil }
        let avg = store.summary.totalCostUsd / Double(runs)
        guard avg > 0 else { return nil }
        let ratio = run.costUsd / avg
        if ratio >= 1.5 { return (String(format: "↑ %.1f× avg", ratio), Theme.estimated) }
        if ratio <= 0.66 { return (String(format: "↓ %.1f× avg", ratio), Theme.exact) }
        return ("≈ avg", .secondary)
    }

    /// Today (UTC, matching the server's day buckets) + a 7-day sparkline — context under the hero.
    private var todaySecondary: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Today").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text(Fmt.usd(store.summary.costToday())).monospacedDigit().font(.callout)
            }
            MiniSparkline(days: store.summary.recentDays(7))
        }
    }

    // MARK: - History fallback (nothing live)

    private var historyContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "moon.zzz").foregroundStyle(.secondary)
                Text("No live session — showing local history. Start coding to capture live runs.")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
            }

            HStack {
                Text("Today").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text(Fmt.usd(store.summary.costToday())).monospacedDigit().font(.title3).fontWeight(.semibold)
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
