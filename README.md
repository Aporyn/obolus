# Obolus

**Observability for AI coding-agent spend.** See what each PR, repo, and developer actually costs in
AI coding agents — Claude Code, Codex, Cursor — without sending your code or prompts anywhere.

> *Obolus* was the small coin the ancient Greeks placed under the tongue to pay Charon, the ferryman.
> Obolus watches the small coins your agents spend — before they add up to a fare you never meant to pay.

## Status

🚧 **Early — v0 in progress.** The first release is a **local, metadata-only** collector for Claude
Code. See the **Roadmap** below for the plan.

## What it does (v0)

- Reads your **local Claude Code session history** — zero config, nothing to enable, no API key
- Attributes spend across **all your repos**, broken down by **repo / model / branch / session**
- Time window (`--since 7d`) and a **top-sessions** ranking — cross-run history `/usage` can't give you
- **Metadata only** — token counts and cost, never your code or prompts. Runs fully offline.

## Install

```sh
npx obolus scan
```

That's it — one command, no setup. (For development: clone, then `pnpm install && pnpm build`.)

## Usage

```sh
obolus scan                            # all history, grouped by repo
obolus scan --since 7d                 # only the last 7 days
obolus scan --repo myapp --by branch   # one repo, broken down by branch
obolus scan --top 20                   # show more rows per section
obolus scan --json                     # machine-readable output
```

Cost is an estimate computed from token counts × current public rates — not your actual bill.

## Why

Coding-agent spend is volatile and invisible: roughly **1000×** a chat turn, up to **30×** variance
between runs on the same task, and models underestimate their own cost. Obolus makes it legible —
starting with what you can't get from `/usage`: cross-run, per-repo/branch/commit history.

## Roadmap

Local collector (v0) → server + GitHub App PR cost comments (v1-beta) → team dashboard (v1-paid) →
Cursor/Codex + alerts (post-v1). **Open-core:** the collector is free and local; team aggregation is paid.

## License

MIT (collector / CLI).
