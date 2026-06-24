import XCTest
@testable import ObolusKit

/// Cross-language contract test. Decodes the SAME golden the TS suite pins
/// (`test/fixtures/summary-contract.golden.json`, produced from a typed `ScanSummary`
/// fixture in `test/contract-summary.test.ts`) to prove the Swift Codable mirrors stay
/// in lockstep with `obolus serve`'s /api/summary shape.
///
/// - A renamed/removed/retyped field makes `JSONDecoder` throw here.
/// - A field `obolus serve` adds but the Swift model omits would be *silently dropped* by
///   the default decoder; `testTopLevelKeysMatchModel` closes that gap by asserting the
///   wire key-set equals exactly what `ScanSummary` models.
final class SummaryContractTests: XCTestCase {
    /// Resolve the repo-root golden from this test file's own path so it works under
    /// `swift test` from source without SwiftPM resource plumbing.
    /// <repo>/apps/desktop/Tests/ObolusKitTests/SummaryContractTests.swift → up 5 → <repo>.
    private func goldenURL() throws -> URL {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0 ..< 5 { url.deleteLastPathComponent() }
        let golden = url.appendingPathComponent("test/fixtures/summary-contract.golden.json")
        try XCTSkipUnless(
            FileManager.default.fileExists(atPath: golden.path),
            "golden missing at \(golden.path) — run `UPDATE_GOLDEN=1 pnpm test` to generate it"
        )
        return golden
    }

    func testGoldenDecodesIntoScanSummary() throws {
        let data = try Data(contentsOf: try goldenURL())
        let summary = try JSONDecoder().decode(ScanSummary.self, from: data)

        // Representative values + a structural check that every dimension survived decoding.
        XCTAssertEqual(summary.totalRuns, 3)
        XCTAssertEqual(summary.totalCostUsd, 12.5, accuracy: 1e-9)
        XCTAssertEqual(summary.composition.totalUsd, summary.totalCostUsd, accuracy: 1e-9)
        XCTAssertEqual(summary.estimatedModels, ["claude-fable-5"])
        XCTAssertFalse(summary.byRepo.isEmpty)
        XCTAssertFalse(summary.byModel.isEmpty)
        XCTAssertFalse(summary.byBranch.isEmpty)
        XCTAssertFalse(summary.byDay.isEmpty)
        XCTAssertFalse(summary.byWeek.isEmpty)
        XCTAssertFalse(summary.byKind.isEmpty)
        XCTAssertFalse(summary.sessions.isEmpty)
        XCTAssertFalse(summary.topRuns.isEmpty)
        XCTAssertEqual(summary.byCommit.count, 2)
        XCTAssertNil(summary.sessions.first?.branch)
        XCTAssertEqual(summary.topRuns.first?.branch, "main")
        XCTAssertFalse(summary.byRelease.isEmpty)

        // Per-vendor breakdown: Codex carries a 5h + weekly rate-limit snapshot;
        // Claude Code reports none. The nested per-vendor summary is one level deep.
        XCTAssertFalse(summary.vendors.isEmpty)
        let codex = summary.vendors.first { $0.vendor == "codex" }
        XCTAssertNotNil(codex)
        XCTAssertGreaterThan(codex?.summary.totalRuns ?? 0, 0)
        XCTAssertEqual(codex?.rateLimit?.primary?.windowMinutes, 300)
        XCTAssertEqual(codex?.rateLimit?.secondary?.windowMinutes, 10080)
        XCTAssertEqual(codex?.rateLimit?.planType, "team")
        XCTAssertEqual(codex?.summary.vendors.count, 0)
        XCTAssertNil(summary.vendors.first { $0.vendor == "claude-code" }?.rateLimit)
    }

    func testTopLevelKeysMatchModel() throws {
        let data = try Data(contentsOf: try goldenURL())
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return XCTFail("golden is not a JSON object")
        }
        let expected: Set<String> = [
            "totalRuns", "totalTokens", "totalCostUsd", "composition",
            "unpricedModels", "estimatedModels", "byRepo", "byModel", "byBranch",
            "byDay", "byWeek", "byKind", "sessions", "topRuns", "byCommit", "byRelease",
            "vendors",
        ]
        XCTAssertEqual(
            Set(obj.keys), expected,
            "serve /api/summary top-level keys drifted from the Swift ScanSummary model"
        )
    }
}
