import SwiftUI
import ObolusKit

/// The compact popover shown when the menu bar icon is clicked. Today-first: it always leads with
/// today's spend and how it compares to your recent daily average, plus a 7-day trend. When a
/// session is live it adds a "burning now" row (last 10 minutes); when idle it shows top repos.
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
                glanceContent
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

    // MARK: - Content (Today-first)

    /// Always lead with today's spend + trend. When live, add a "burning now" row;
    /// when idle, show where recent spend landed.
    private var glanceContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            todayHero
            if store.isLive {
                Divider()
                liveRow
            } else if !store.summary.byRepo.isEmpty {
                Divider()
                topRepos
            }
        }
    }

    /// Hero: today's spend (calendar day), a "vs daily average" chip, and a 7-day trend.
    private var todayHero: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Today").font(.caption).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(Fmt.usd(store.summary.costToday()))
                    .font(.system(size: 28, weight: .semibold)).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.6)
                if let chip = trendChip {
                    Text(chip.text).font(.caption2).fontWeight(.medium)
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(chip.tint.opacity(0.18), in: Capsule())
                        .foregroundStyle(chip.tint)
                }
                Spacer()
            }
            MiniSparkline(days: store.summary.recentDays(7))
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
    }

    /// The "is today normal?" cue, derived from today vs your trailing-7-day daily average.
    private var trendChip: (text: String, tint: Color)? {
        switch store.summary.todayTrend() {
        case .high(let r): return (String(format: "↑ %.1f× avg", r), Theme.estimated)
        case .low(let r): return (String(format: "↓ %.1f× avg", r), Theme.exact)
        case .normal: return ("≈ avg", .secondary)
        case .noBaseline: return nil
        }
    }

    /// "repo / branch" of the most recent live run — where spend is landing right now.
    private var activeContext: String? {
        guard let run = store.liveFeed.first else { return nil }
        if let branch = run.branch, !branch.isEmpty { return "\(run.repo) · \(branch)" }
        return run.repo
    }

    /// Live: where it's landing + the last-10-minute burn (a rate anchored to now).
    private var liveRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Circle().fill(Theme.exact).frame(width: 7, height: 7)
                Text("live").font(.caption).foregroundStyle(.secondary)
                if let active = activeContext {
                    Text("· \(active)").font(.caption).foregroundStyle(.secondary)
                        .lineLimit(1).truncationMode(.middle)
                }
                Spacer()
            }
            HStack {
                Text("last 10 min").font(.caption2).foregroundStyle(.tertiary)
                Spacer()
                Text(Fmt.usd(LiveBurn.recentUsd(store.liveFeed))).monospacedDigit().font(.callout)
            }
        }
    }

    /// Idle: where recent spend landed (top repos from local history).
    private var topRepos: some View {
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
