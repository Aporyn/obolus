import XCTest
@testable import ObolusKit

final class TimeframeTests: XCTestCase {
    func testSinceParamOmittedOnlyForAll() {
        XCTAssertEqual(Timeframe.day.sinceParam, "1d")
        XCTAssertEqual(Timeframe.week.sinceParam, "7d")
        XCTAssertEqual(Timeframe.month.sinceParam, "30d")
        XCTAssertNil(Timeframe.all.sinceParam)
    }

    func testSummaryURLAddsSinceExceptForAll() {
        let base = URL(string: "http://127.0.0.1:4317")!
        XCTAssertEqual(
            SummaryStore.summaryURL(base: base, timeframe: .week).absoluteString,
            "http://127.0.0.1:4317/api/summary?since=7d"
        )
        XCTAssertEqual(
            SummaryStore.summaryURL(base: base, timeframe: .all).absoluteString,
            "http://127.0.0.1:4317/api/summary"
        )
    }
}
