import SwiftUI
import ObolusKit

/// Where the money went, split by token class — a proportional stacked bar + legend.
/// Mirrors the web dashboard's composition bar.
struct CompositionBar: View {
    let composition: CostComposition

    private struct Segment: Identifiable {
        let id = UUID()
        let label: String
        let value: Double
        let color: Color
    }

    private var segments: [Segment] {
        // Monochrome blue ramp, saturated → muted — mirrors the web composition bar.
        [
            Segment(label: "Input", value: composition.inputUsd, color: Theme.accent),
            Segment(label: "Output", value: composition.outputUsd, color: Theme.accent2),
            Segment(label: "Cache read", value: composition.cacheReadUsd, color: Theme.accent3),
            Segment(label: "Cache write", value: composition.cacheWriteUsd, color: Theme.accent4),
        ]
    }

    private var total: Double { max(composition.totalUsd, 0.0000001) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Cost composition", systemImage: "chart.pie")

            GeometryReader { geo in
                HStack(spacing: 1) {
                    ForEach(segments) { seg in
                        seg.color
                            .frame(width: max(0, geo.size.width * CGFloat(seg.value / total)))
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            .frame(height: 16)

            // Legend
            HStack(spacing: 14) {
                ForEach(segments) { seg in
                    HStack(spacing: 5) {
                        RoundedRectangle(cornerRadius: 2).fill(seg.color).frame(width: 9, height: 9)
                        Text(seg.label).font(.caption).foregroundStyle(.secondary)
                        Text(Fmt.usd(seg.value)).font(.caption).monospacedDigit()
                    }
                }
                Spacer()
            }
        }
    }
}

/// Shared section header style used across the dashboard.
struct SectionHeader: View {
    let title: String
    var systemImage: String? = nil
    var body: some View {
        HStack(spacing: 6) {
            if let systemImage { Image(systemName: systemImage).foregroundStyle(.secondary) }
            Text(title).font(.headline)
            Spacer()
        }
    }
}
