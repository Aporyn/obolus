# Obolus — macOS menu bar app

A native macOS menu bar app for Obolus. It lives in the status bar; the full **native** dashboard
mirrors everything `obolus serve` shows in a browser — rendered with SwiftUI + Swift Charts (no web
view).

It does **not** reimplement the collector. It spawns `obolus serve` as a **headless data engine**
(bound to `127.0.0.1`, metadata-only, observe-only) and reads its JSON API:

- `GET /api/summary` → **History** plane (full local history, all dimensions) — KPIs, composition,
  per-dimension breakdown, daily trend, sessions.
- `GET /api/events` (SSE) → **Live (this session)** plane — the live feed, covering only the window
  since the app connected. Gaps while the app was closed are clearly labeled, never backfilled.

## Behavior

- **Menu bar icon** (monochrome template, no inline number):
  - **Left-click** → popover with recent spend (today $ / runs / tokens, 7-day sparkline, top repos,
    live feed).
  - **Right-click** → native menu: **Open Dashboard** / **Quit Obolus**.
- **First launch only** → the full dashboard window opens automatically (so a new user sees it
  immediately). Subsequent launches stay quietly in the menu bar.
  - Reset that one-time behavior (e.g. to re-demo first run):
    `defaults delete dev.obolus.desktop didAutoOpenDashboardOnce`
- **Dock icon** appears only while the dashboard window is open (`.regular`); closing the window
  returns to a pure menu-bar agent (`.accessory`, no Dock icon).

## Architecture

| Target | Role |
| --- | --- |
| `ObolusKit` (library) | Models (mirror `src/report/aggregate.ts`), formatters, SSE parser, `SummaryStore`, `ServeProcess`. GUI-free and unit-tested. |
| `Obolus` (executable) | AppKit shell (`NSStatusItem` + AppKit-managed window) hosting SwiftUI: the popover and the native dashboard. |
| `ObolusKitTests` | XCTest suite for the data layer (runs under Xcode / CI). |

## Requirements

- macOS 13+ (Swift Charts, status-bar APIs).
- For development: Node ≥18 and a built obolus CLI (`pnpm build` at the repo root produces `dist/`).
- Full Xcode is needed to run `swift test` (XCTest ships with Xcode). `swift build` works with the
  Command Line Tools alone.

## Install (for users)

The app is distributed as a signed, notarized **`.dmg` via GitHub Releases** — download, open, drag
**Obolus** into Applications. The release build is self-contained (bundles Node + the obolus CLI), so
**nothing else needs to be installed**.

> Obolus is also available as a terminal CLI (`npx obolus …`). The app and the npm CLI **do not
> conflict** — both only read your local Claude Code history; the app always uses an ephemeral port.
> Pick whichever you prefer, or use both.

## Build & run (for developers)

Dev (uses the workspace CLI build via env override):

```bash
# from the repo root
pnpm build                       # produce dist/ (the obolus CLI the app spawns)

# from apps/desktop
swift build
OBOLUS_NODE="$(which node)" OBOLUS_DIST="$(cd ../.. && pwd)/dist" .build/debug/Obolus
```

Package a `.app` bundle (no Xcode required):

```bash
./build-app.sh                   # backend resolved at runtime (env or `npx obolus`)
./build-app.sh --bundle-runtime  # self-contained: embeds node + obolus/dist into the .app
open Obolus.app
```

## Distribution & signing

- **Source lives in this repo** (`apps/desktop/`, MIT) — it is local, observe-only, metadata-only.
- **Built artifacts do not** — `.build/`, `*.app`, and the bundled Node binary are git-ignored.
  Ship the `.dmg` as a **GitHub Release asset**, not in git.
- Distributing to other machines requires **code signing + notarization** with an Apple Developer ID
  (otherwise Gatekeeper blocks an unsigned download). `codesign` and `notarytool` are available in the
  Command Line Tools; only the Developer ID certificate is additionally required. A locally built
  `.app` runs on the build machine without signing.

## How the backend is resolved (`ServeProcess`)

First match wins:

1. `OBOLUS_NODE` + `OBOLUS_DIST` env (dev override).
2. Bundled `node` + `obolus/dist/index.js` in the app's `Resources` (`--bundle-runtime`).
3. A `node` at a common path + a bundled/env dist.
4. `npx obolus` fallback.

The spawned child is started with `--port 0` (ephemeral) and `OBOLUS_SERVE_READY_JSON=1`, so the app
discovers the bound URL from the serve readiness line. The child is terminated when the app quits.

## Not in v1

User-rearrangeable dashboard widgets; the `.dmg` signing/notarization pipeline itself. The dashboard
is fully native but fixed-layout for now.
