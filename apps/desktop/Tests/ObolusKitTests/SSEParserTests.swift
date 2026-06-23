import XCTest
@testable import ObolusKit

final class SSEParserTests: XCTestCase {
    func testSingleEvent() {
        var parser = SSEParser()
        let out = parser.feed("data: {\"a\":1}\n\n")
        XCTAssertEqual(out, ["{\"a\":1}"])
    }

    func testIgnoresCommentsAndConnectedPreamble() {
        var parser = SSEParser()
        let out = parser.feed(": connected\n\ndata: {\"x\":2}\n\n")
        XCTAssertEqual(out, ["{\"x\":2}"])
    }

    func testPartialEventBufferedAcrossChunks() {
        var parser = SSEParser()
        XCTAssertEqual(parser.feed("data: {\"part\":"), [])
        XCTAssertEqual(parser.feed("true}\n\n"), ["{\"part\":true}"])
    }

    func testMultipleEventsInOneChunk() {
        var parser = SSEParser()
        let out = parser.feed("data: one\n\ndata: two\n\n")
        XCTAssertEqual(out, ["one", "two"])
    }

    func testCRLFNormalized() {
        var parser = SSEParser()
        let out = parser.feed("data: hi\r\n\r\n")
        XCTAssertEqual(out, ["hi"])
    }

    func testDecodesLiveRunEvent() {
        var parser = SSEParser()
        let json = """
        data: {"repo":"obolus","branch":null,"commit":null,"model":"claude-opus-4-8","costUsd":0.12,"tokens":1500,"timestamp":"2026-06-23T14:00:00Z","isSidechain":false,"runningUsd":0.12,"runningRuns":1}

        """
        let payloads = parser.feed(json)
        XCTAssertEqual(payloads.count, 1)
        let event = try! JSONDecoder().decode(LiveRunEvent.self, from: payloads[0].data(using: .utf8)!)
        XCTAssertEqual(event.repo, "obolus")
        XCTAssertNil(event.branch)
        XCTAssertEqual(event.runningRuns, 1)
        XCTAssertEqual(event.costUsd, 0.12, accuracy: 1e-9)
    }
}
