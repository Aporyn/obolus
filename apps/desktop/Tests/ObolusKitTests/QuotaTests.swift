import XCTest
@testable import ObolusKit

final class QuotaTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-06-24T12:00:00Z")!

    func testUntilStringMinutes() {
        XCTAssertEqual(Quota.untilString("2026-06-24T12:45:00Z", now: now), "45m")
    }

    func testUntilStringHoursAndMinutes() {
        XCTAssertEqual(Quota.untilString("2026-06-24T14:14:00Z", now: now), "2h 14m")
    }

    func testUntilStringDaysAndHours() {
        XCTAssertEqual(Quota.untilString("2026-06-29T20:00:00Z", now: now), "5d 8h")
    }

    func testUntilStringPastIsNow() {
        XCTAssertEqual(Quota.untilString("2026-06-24T11:00:00Z", now: now), "now")
    }

    func testUntilStringNilOrUnparseableIsEmpty() {
        XCTAssertEqual(Quota.untilString(nil, now: now), "")
        XCTAssertEqual(Quota.untilString("not-a-date", now: now), "")
    }

    func testPercentRounds() {
        XCTAssertEqual(Quota.percentString(61.6), "62%")
        XCTAssertEqual(Quota.percentString(40), "40%")
    }

    func testRateLimitLookupFromVendors() {
        let snap = RateLimitSnapshot(
            vendor: "codex", capturedAt: "2026-06-24T11:30:00Z",
            primary: RateLimitWindow(usedPercent: 62, windowMinutes: 300, resetsAt: nil),
            secondary: nil, planType: "team"
        )
        let vendors = [
            VendorBreakdown(vendor: "claude-code", rateLimit: nil, summary: .empty),
            VendorBreakdown(vendor: "codex", rateLimit: snap, summary: .empty),
        ]
        XCTAssertEqual(RateLimitSnapshot.from(vendors, vendor: "codex")?.primary?.usedPercent, 62)
        XCTAssertNil(RateLimitSnapshot.from(vendors, vendor: "claude-code"))
    }
}
