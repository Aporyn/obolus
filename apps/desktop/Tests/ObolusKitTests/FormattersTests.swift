import XCTest
@testable import ObolusKit

final class FormattersTests: XCTestCase {
    func testUsd() {
        XCTAssertEqual(Fmt.usd(0), "$0.00")
        XCTAssertEqual(Fmt.usd(1234.5), "$1,234.50")
        XCTAssertEqual(Fmt.usd(1154.6910499), "$1,154.69")
    }

    func testTokens() {
        XCTAssertEqual(Fmt.tokens(999), "999")
        XCTAssertEqual(Fmt.tokens(1_200), "1.2k")
        XCTAssertEqual(Fmt.tokens(3_400_000), "3.4M")
        XCTAssertEqual(Fmt.tokens(1_000_000), "1M")
        XCTAssertEqual(Fmt.tokens(1_286_518_072), "1.3B")
    }

    func testInt() {
        XCTAssertEqual(Fmt.int(4233), "4,233")
        XCTAssertEqual(Fmt.int(0), "0")
    }

    func testDay() {
        XCTAssertEqual(Fmt.day("2026-06-23T14:25:09.123Z"), "2026-06-23")
    }
}
