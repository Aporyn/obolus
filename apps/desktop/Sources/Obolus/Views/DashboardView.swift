import SwiftUI
import ObolusKit

/// The dashboard's vendor tab. `all` is the combined cross-vendor view; the others
/// scope every section to one vendor and recolor it with that vendor's accent.
enum VendorTab: String, CaseIterable, Identifiable {
    case all = "All"
    case claudeCode = "Claude Code"
    case codex = "Codex"
    var id: String { rawValue }
    /// Vendor key for scoping/palette; nil for the combined "All" view.
    var key: String? {
        switch self {
        case .all: return nil
        case .claudeCode: return "claude-code"
        case .codex: return "codex"
        }
    }
}

/// The full, fully-native dashboard window. Renders every value/section of the web dashboard
/// (req 3) from the History plane, plus a clearly-separated Live plane.
struct DashboardView: View {
    @EnvironmentObject private var serve: ServeProcess
    @EnvironmentObject private var store: SummaryStore

    @State private var timeframe: Timeframe = .week
    @State private var windowed: ScanSummary?
    @State private var vendorTab: VendorTab = .all
    @State private var codexMetric: CodexMetric = .dollars

    /// The summary the history sections render: the windowed fetch when available, else the
    /// store's all-time poll (shown until the first windowed fetch resolves, and as a graceful
    /// fallback when a windowed fetch fails — its backend errors surface via backendBanner).
    private var displayed: ScanSummary { windowed ?? store.summary }

    /// Scope a summary to the active vendor tab (combined for `.all`).
    private func scoped(_ base: ScanSummary) -> ScanSummary {
        guard let key = vendorTab.key else { return base }
        return base.vendors.first { $0.vendor == key }?.summary ?? .empty
    }

    private var scopedDisplayed: ScanSummary { scoped(displayed) }
    private var scopedTrend: ScanSummary { scoped(store.summary) }

    /// Account-level Codex rate-limit snapshot (timeframe-independent; from the all-time poll).
    private var codexRateLimit: RateLimitSnapshot? {
        RateLimitSnapshot.from(store.summary.vendors, vendor: "codex")
    }

    var body: some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    backendBanner

                    // History plane (scoped to the active vendor tab, recolored per vendor).
                    Group {
                        historyCaption
                        KPISection(summary: scopedDisplayed)
                        if vendorTab == .codex {
                            CodexQuotaSection(totalUsd: scopedDisplayed.totalCostUsd,
                                              rateLimit: codexRateLimit,
                                              metric: $codexMetric)
                        }
                        SpendByCommitSection(summary: scopedDisplayed)
                        CompositionBar(composition: scopedDisplayed.composition)
                        BreakdownSection(summary: scopedDisplayed)
                        // Trend stays on the all-time summary: a ~21-day daily trend is inherently
                        // multi-day, so a narrow window (1d/7d) shouldn't collapse it to empty bars.
                        DailyTrendChart(summary: scopedTrend)
                        SessionsTable(sessions: scopedDisplayed.sessions)
                    }
                    .environment(\.vendorPalette, Theme.palette(for: vendorTab.key))

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
        .task { windowed = await store.fetchSummary(timeframe: timeframe) }
        .onChange(of: timeframe) { newValue in
            Task { windowed = await store.fetchSummary(timeframe: newValue) }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Label("Obolus", systemImage: "chart.bar.xaxis")
                .font(.title3).fontWeight(.semibold)
            Picker("Vendor", selection: $vendorTab) {
                ForEach(VendorTab.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            Picker("Time range", selection: $timeframe) {
                ForEach(Timeframe.allCases) { tf in Text(tf.label).tag(tf) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 200)
            Spacer()
            statusPill
            Button { Task { await store.refresh(); windowed = await store.fetchSummary(timeframe: timeframe) } } label: {
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
