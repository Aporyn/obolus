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
- Breaks spend down by **repo / model / branch / day / week / session / commit / release**, plus **main vs subagent** and a **cost composition** (input / output / cache)
- Time window (`--since` / `--until`), **top sessions** and **most-expensive runs** — cross-run history `/usage` can't give you
- **Live `watch` mode** — stream each run's cost as it happens, tagged with the **commit** checked out at run time
- **Local dashboard** — `obolus serve` opens a private `localhost` web view (charts, breakdowns, live feed); nothing leaves your machine
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
obolus scan --by day                   # daily spend trend
obolus scan --by kind                  # main thread vs subagent (sidechain)
obolus scan --repo myapp --by branch   # one repo, broken down by branch
obolus scan --model claude-opus-4-8    # only one model
obolus scan --since 30d --until 7d     # a specific window
obolus scan --by commit                # spend per commit — the view /usage can't give you
obolus scan --by release               # spend per release (git tag)
obolus scan --top 20                   # show more rows per section
obolus scan --json                     # machine-readable output
```

Dimensions for `--by`: `repo` · `model` · `branch` · `day` · `week` · `kind` · `commit` · `release`.

## Live monitor

```sh
obolus watch
```

Tails active Claude Code sessions and prints each run's cost the moment it happens — stamped with
the **commit** checked out at run time, which the history scan can't see. Records append to
`~/.obolus/live-ledger.jsonl` (metadata only). Ctrl+C to stop.

## Dashboard (web UI)

```sh
obolus serve              # serve at http://localhost:4317
obolus serve --open       # …and open it in your browser
obolus serve --port 8080  # use a different port
```

A local web dashboard bound to `127.0.0.1` — **nothing leaves your machine**. It reads your local
history and, while it runs, tails your active Claude Code sessions itself, so the view stays current
as you work (no separate command needed). `Ctrl+C` to stop.

### The interface

**Header** — the **Obolus** wordmark, a connection dot (grey *connecting* → green *live* once the
stream is up), and a **light/dark toggle** (`◐`). It follows your system theme by default; click to
override, and your choice is remembered across visits.

**Top to bottom:**

- **KPI cards** — Estimated cost · Runs · Tokens · **Today** (today follows your machine's own clock).
- **Spend by commit / release** — the wedge over native `/usage`. Where `/usage` shows *one number for
  this machine*, Obolus attributes spend to **every commit, branch, and release**. Toggle
  **Commit / Release**; each row carries a provenance dot:
  - 🟢 **exact** — stamped live at run time by `watch`
  - 🟠 **estimated** — reconstructed from git history
  - ⚪ **unattributed** — work not yet committed, or no git repo
- **Cost composition** — a proportional bar splitting spend into **input / output / cache read / cache
  write**, so you can see where the money actually goes (cache reads usually dominate).
- **Spend breakdown** — a bar chart you can regroup by **Repo · Model · Branch · Kind** (main vs
  subagent) with the segmented control.
- **Daily trend** — the last 21 days of spend; hover a bar for its date and amount.
- **Top sessions** — your most expensive sessions, with runs, tokens, and time span.
- **Live** — runs streaming in for the current session, with a running session total. Start Claude Code
  in another terminal and spend shows up here in real time.

Opened as a plain file with no server running, the dashboard renders **sample data** and tells you so —
run `obolus serve` to see your real numbers.

Cost is an estimate — token counts × current public rates, not your actual bill.

## Why

Coding-agent spend is volatile and invisible: roughly **1000×** a chat turn, up to **30×** variance
between runs on the same task, and models underestimate their own cost. Obolus makes it legible —
starting with what you can't get from `/usage`: cross-run, per-repo/branch/commit history.

## Roadmap

Local collector (v0) → server + GitHub App PR cost comments (v1-beta) → team dashboard (v1-paid) →
Cursor/Codex + alerts (post-v1). **Open-core:** the collector is free and local; team aggregation is paid.

## License

MIT (collector / CLI).
