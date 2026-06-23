# Design tokens (shared)

Single source of truth for the design language shared by the two local UI surfaces:

- **Web dashboard** — `src/dashboard/dashboard.html` (HTML/CSS).
- **Native app** — `apps/desktop` (SwiftUI) via `Theme` / `ThemeController` in
  `apps/desktop/Sources/Obolus/Views/`.

Both target a **neutral, native-macOS** look (not a bespoke brand palette): neutral surfaces,
system font, restrained system-blue accent, and semantic provenance colours. The two surfaces should
read as the same product (decision: same design language; pixel-identical is not required since
SwiftUI and HTML render differently).

## Theme

Both surfaces **follow the system appearance by default, with a manual light/dark toggle** (the `◐`
button). Web persists the choice in `localStorage` (`obolusTheme`) and applies it via
`prefers-color-scheme` + `[data-theme]`; the app persists in `UserDefaults` and applies it via
`NSApp.appearance` (`ThemeController`).

## Palette (neutral macOS)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `bg` | `#f5f5f7` | `#1c1c1e` | page background |
| `surface` | `#ffffff` | `#2c2c2e` | cards |
| `bg-deep` | `#ececef` | `#141416` | recessed (segmented-control track) |
| `ink` | `#1d1d1f` | `#f5f5f7` | primary text + **cost figures** |
| `muted` | `#6e6e73` | `#98989d` | secondary text |
| `faint` | `#98989d` | `#6e6e73` | tertiary / labels |
| `hair` | `#d9d9de` | `#3a3a3c` | borders |
| `accent` | `#0071e3` | `#0a84ff` | system blue — sparingly (wedge highlight, links) |

App equivalents are native: surfaces/text use system semantic colours, `accent` = the system accent
(`Color.accentColor`). Cost figures are neutral (`ink`/primary), **not** accent-coloured.

## Provenance tokens (attribution confidence)

A run's cost is `exact` (live-stamped by `watch`), `estimated` (reconstructed from git), or
`unattributed`. See `src/report/commit-resolution.ts`.

| Token | Meaning | Dot | Light | Dark | App (`Theme`) |
| --- | --- | --- | --- | --- | --- |
| `exact` | captured live | filled | `#30a46c` | `#30d158` | `.green` |
| `estimated` | reconstructed from git | hollow ring | `#c2820a` | `#ff9f0a` | `.orange` |
| `unattributed` | uncommitted / no git | filled, muted | `faint` | `faint` | `.secondary` |

## Typography

System font everywhere — `-apple-system`/SF (`--sans`, `--display` on web; native on the app). No
serif. Numbers (cost, tokens, SHAs) use a monospaced font.

## Component anatomy (commit / release)

Both surfaces render the section identically in structure:

- **Wedge** — two cards: `claude code /usage` → one number (muted) vs `obolus adds` → "every commit ·
  branch · release", the second card outlined in `accent`.
- **Commit row** — provenance dot · short SHA (mono) · subject (+ release pill) · cost (mono, `ink`).
- **Release row** — tag (mono) · `N commits · date range` · cost.
- **Toggle** — `Commit | Release` segmented control; the active segment is a raised neutral pill.
- **Legend** — exact / estimated / unattributed.

## Keeping in sync

When a shared token changes, update the web CSS variable in `dashboard.html` `:root` (+ the dark
blocks), the corresponding `Theme`/usage in the app, and this table. No codegen — the surfaces are
small; this short spec is the contract.
