import SwiftUI
import ObolusKit

/// The full, fully-native dashboard window. Renders every value/section of the web dashboard
/// (req 3) from the History plane, plus a clearly-separated Live plane.
struct DashboardView: View {
    @EnvironmentObject private var serve: ServeProcess
    @EnvironmentObject private var store: SummaryStore

    var body: some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    backendBanner

                    // History plane.
                    Group {
                        historyCaption
                        KPISection(summary: store.summary)
                        SpendByCommitSection(summary: store.summary)
                        CompositionBar(composition: store.summary.composition)
                        BreakdownSection(summary: store.summary)
                        DailyTrendChart(summary: store.summary)
                        SessionsTable(sessions: store.summary.sessions)
                    }

                    Divider()

                    // Live plane.
                    LiveFeedList(
                        isLive: store.isLive,
                        trackingSince: store.trackingSince,
                        runningUsd: store.runningUsd,
                        runningRuns: store.runningRuns,
                        feed: store.liveFeed
                    )
                }
                .padding(20)
            }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Label("Obolus", systemImage: "chart.bar.xaxis")
                .font(.title3).fontWeight(.semibold)
            Spacer()
            statusPill
            Button { Task { await store.refresh() } } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
            .disabled(store.isLoading)
            .help("Refresh")
        }
    }

    private var statusPill: some View {
        HStack(spacing: 7) {
            ConnectionDot(isLive: store.isLive)
            Text(updatedLabel)
                .font(.caption)
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.quaternary.opacity(0.6), in: Capsule())
        .overlay(Capsule().strokeBorder(.separator, lineWidth: 0.5))
    }

    private var updatedLabel: String {
        guard let updated = store.lastUpdated else { return "Loading…" }
        return "Updated \(updated.formatted(date: .omitted, time: .shortened))"
    }

    private var historyCaption: some View {
        HStack(spacing: 6) {
            Image(systemName: "clock.arrow.circlepath").foregroundStyle(.secondary)
            Text("Local history — includes time the app was closed")
                .font(.caption).foregroundStyle(.secondary)
            Spacer()
        }
    }

    @ViewBuilder private var backendBanner: some View {
        switch serve.state {
        case .failed(let message):
            banner(icon: "exclamationmark.triangle.fill", tint: .orange, text: message,
                   action: ("Retry", { serve.restart() }))
        case .starting where store.lastUpdated == nil:
            banner(icon: "hourglass", tint: .secondary, text: "Starting obolus serve…", action: nil)
        default:
            if let error = store.loadError {
                banner(icon: "wifi.exclamationmark", tint: .orange, text: error,
                       action: ("Retry", { Task { await store.refresh() } }))
            }
        }
    }

    private func banner(icon: String, tint: Color, text: String, action: (String, () -> Void)?) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).foregroundStyle(tint)
            Text(text).font(.callout)
            Spacer()
            if let action {
                Button(action.0, action: action.1).controlSize(.small)
            }
        }
        .padding(10)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
    }
}
