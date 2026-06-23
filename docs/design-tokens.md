# Design tokens (shared)

Single source of truth for the tokens shared between the two local UI surfaces:

- **Web dashboard** — `src/dashboard/dashboard.html` (HTML/CSS, branded sage + Marcellus serif).
- **Native app** — `apps/desktop` (SwiftUI, native macOS look) via `Theme` in
  `apps/desktop/Sources/Obolus/Views/Theme.swift`.

## What is shared vs not

The two surfaces have **intentionally different brand palettes** (the web is a branded, marketing-facing
demo; the app is native-macOS). We do **not** force them pixel-identical (decision: app primary, web
secondary, "style as similar as is convenient"). What IS shared and must stay consistent:

- **Semantic/provenance tokens** (below) — the meaning and visual language of attribution confidence.
- **Component anatomy** — the row/section structure, so the same data reads the same way.
- **Number treatment** — costs and counts use a monospaced font; cost is tinted with the surface accent.

## Provenance tokens (attribution confidence)

Used by "Spend by commit / release". A run's cost is `exact` (live-stamped by `watch`), `estimated`
(reconstructed from git), or `unattributed` (WIP / no git). See `src/report/commit-resolution.ts`.

| Token | Meaning | Dot style | Web (`dashboard.html`) | App (`Theme.swift`) |
| --- | --- | --- | --- | --- |
| `exact` | captured live by `watch` | filled | `--exact: #2f8a5b` | `Theme.exact` (`.green`) |
| `estimated` | reconstructed from git history | hollow ring | `--estimated: #b9831f` | `Theme.estimated` (`.orange`) |
| `unattributed` | uncommitted / no git | filled, muted | `--unattributed: var(--faint)` | `Theme.unattributed` (`.secondary`) |

## Component anatomy (commit / release)

Both surfaces render the section the same way:

- **Commit row** — provenance dot · short SHA (mono) · subject (+ release pill) · cost (mono, accent).
  The `(unattributed)` row replaces SHA/subject with "uncommitted / no git".
- **Release row** — tag (mono) · `N commits · date range` · cost (mono, accent).
- **Toggle** — a `Commit | Release` segmented control.
- **Legend** — exact / estimated / unattributed.
- **Wedge line** — "`/usage` shows one machine total — Obolus prices every commit and release, with
  history."

## How to keep them in sync

When a shared token changes, update **both** the web CSS variable in `dashboard.html` `:root` and the
corresponding `Theme` constant, and this table. There is deliberately no codegen — the surfaces are
small and the token set is tiny; a short shared spec (this file) is the lighter-weight contract.
