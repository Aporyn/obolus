import SwiftUI
import ObolusKit

/// The wedge view: spend attributed per commit / release — what `/usage` can't show.
/// History plane. `exact` (live-stamped) vs `estimated` (git-reconstructed) is labeled per row.
struct SpendByCommitSection: View {
    let summary: ScanSummary

    enum Mode: String, CaseIterable, Identifiable {
        case commit = "Commit"
        case release = "Release"
        var id: String { rawValue }
    }

    @State private var mode: Mode = .commit
    private let topN = 20

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                SectionHeader(title: "Spend by commit / release", systemImage: "chart.dots3")
                Picker("", selection: $mode) {
                    ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .fixedSize()
            }

            wedgeStrip

            if mode == .commit {
                commitList
            } else {
                releaseList
            }

            legend
        }
    }

    // The /usage-vs-obolus framing, made compact.
    private var wedgeStrip: some View {
        HStack(spacing: 8) {
            Image(systemName: "info.circle").font(.caption).foregroundStyle(.secondary)
            Text("`/usage` shows one machine total — obolus prices every commit and release, with history.")
                .font(.caption).foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.vertical, 6).padding(.horizontal, 10)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder private var commitList: some View {
        if summary.byCommit.isEmpty {
            Text("No commit attribution yet.").font(.callout).foregroundStyle(.secondary)
        } else {
            VStack(spacing: 0) {
                ForEach(summary.byCommit.prefix(topN)) { c in
                    HStack(spacing: 10) {
                        ConfidenceDot(commit: c)
                        if c.isUnattributed {
                            Text("uncommitted / no git")
                                .font(.callout).foregroundStyle(.secondary).italic()
                        } else {
                            Text(c.key).font(.caption).monospaced().foregroundStyle(.secondary)
                                .frame(width: 66, alignment: .leading)
                            Text(c.subject.isEmpty ? "—" : c.subject)
                                .font(.callout).lineLimit(1).truncationMode(.tail)
                            if let release = c.release {
                                Text(release).font(.system(size: 9)).monospaced()
                                    .padding(.horizontal, 4).padding(.vertical, 1)
                                    .background(.quaternary, in: Capsule())
                            }
                        }
                        Spacer()
                        Text(Fmt.usd(c.costUsd)).monospacedDigit()
                            .frame(width: 78, alignment: .trailing)
                    }
                    .padding(.vertical, 5)
                    Divider()
                }
            }
        }
    }

    @ViewBuilder private var releaseList: some View {
        if summary.byRelease.isEmpty {
            Text("No release attribution yet.").font(.callout).foregroundStyle(.secondary)
        } else {
            VStack(spacing: 0) {
                ForEach(summary.byRelease.prefix(topN)) { r in
                    HStack(spacing: 10) {
                        Image(systemName: r.isUnattributed ? "questionmark.circle" : "tag")
                            .font(.caption).foregroundStyle(.secondary)
                        Text(r.key).font(.callout).monospaced().fontWeight(.medium)
                        if !r.isUnattributed {
                            Text("\(r.commitCount) commits · \(dateRange(r))")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(Fmt.usd(r.costUsd)).monospacedDigit().fontWeight(.medium)
                    }
                    .padding(.vertical, 7)
                    Divider()
                }
            }
        }
    }

    private func dateRange(_ r: ReleaseTotals) -> String {
        guard !r.firstCommitAt.isEmpty else { return "—" }
        let from = Fmt.day(r.firstCommitAt)
        let to = Fmt.day(r.lastCommitAt)
        return from == to ? from : "\(from)→\(to)"
    }

    private var legend: some View {
        HStack(spacing: 16) {
            label(color: .green, filled: true, text: "exact · live (watch)")
            label(color: .orange, filled: false, text: "estimated · from git")
            label(color: .secondary, filled: true, text: "unattributed")
            Spacer()
        }
        .font(.caption2).foregroundStyle(.secondary)
    }

    private func label(color: Color, filled: Bool, text: String) -> some View {
        HStack(spacing: 5) {
            Circle().fill(filled ? color.opacity(0.85) : .clear)
                .overlay(Circle().strokeBorder(color, lineWidth: filled ? 0 : 1.5))
                .frame(width: 8, height: 8)
            Text(text)
        }
    }
}

/// A per-commit provenance dot: green = exact, hollow amber = estimated, grey = unattributed.
private struct ConfidenceDot: View {
    let commit: CommitTotals
    var body: some View {
        let isExact = commit.exactUsd > 0 && commit.estimatedUsd == 0
        let isEstimated = commit.estimatedUsd > 0 && commit.exactUsd == 0
        Group {
            if commit.isUnattributed {
                Circle().fill(Color.secondary.opacity(0.5))
            } else if isExact {
                Circle().fill(Color.green)
            } else if isEstimated {
                Circle().strokeBorder(Color.orange, lineWidth: 1.5)
            } else {
                // mixed exact + estimated
                Circle().fill(Color.orange.opacity(0.6))
            }
        }
        .frame(width: 9, height: 9)
    }
}
