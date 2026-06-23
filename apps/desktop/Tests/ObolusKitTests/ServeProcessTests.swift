import XCTest
@testable import ObolusKit

final class ServeProcessTests: XCTestCase {
    func testDevOverrideUsesNodeAndDist() {
        let env = ["OBOLUS_NODE": "/fake/node", "OBOLUS_DIST": "/fake/dist"]
        let exists: (String) -> Bool = { $0 == "/fake/node" || $0 == "/fake/dist/index.js" }
        let cmd = ServeProcess.resolveCommand(env: env, bundle: .main, fileExists: exists)
        XCTAssertEqual(cmd?.executable.path, "/fake/node")
        XCTAssertEqual(cmd?.arguments, ["/fake/dist/index.js", "serve", "--port", "0"])
    }

    func testDistMayPointDirectlyAtIndexJs() {
        let env = ["OBOLUS_NODE": "/fake/node", "OBOLUS_DIST": "/fake/dist/index.js"]
        let exists: (String) -> Bool = { $0 == "/fake/node" || $0 == "/fake/dist/index.js" }
        let cmd = ServeProcess.resolveCommand(env: env, bundle: .main, fileExists: exists)
        XCTAssertEqual(cmd?.arguments.first, "/fake/dist/index.js")
    }

    func testFallsBackToNpx() {
        let exists: (String) -> Bool = { $0 == "/opt/homebrew/bin/npx" }
        let cmd = ServeProcess.resolveCommand(env: [:], bundle: .main, fileExists: exists)
        XCTAssertEqual(cmd?.executable.path, "/opt/homebrew/bin/npx")
        XCTAssertEqual(cmd?.arguments, ["obolus", "serve", "--port", "0"])
    }

    func testReturnsNilWhenNothingResolvable() {
        let cmd = ServeProcess.resolveCommand(env: [:], bundle: .main, fileExists: { _ in false })
        XCTAssertNil(cmd)
    }
}
