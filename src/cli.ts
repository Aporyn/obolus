import { scanAll } from './collector/scan-all.js';
import { runWatch } from './collector/watch.js';
import { defaultGitHistory } from './collector/git-history.js';
import { runServe } from './dashboard/serve.js';
import { writeLedger } from './ledger/ledger.js';
import { readLiveRecords } from './ledger/live-ledger.js';
import { ANTHROPIC_PRICING } from './pricing/pricing-table.js';
import { defaultPricingFor } from './pricing/registry.js';
import { summarize } from './report/aggregate.js';
import { resolveAttribution } from './report/commit-resolution.js';
import { filterEvents } from './report/filter.js';
import { parseSince } from './report/timeframe.js';
import { renderSummary, type GroupDimension } from './report/terminal.js';

interface ScanArgs {
  since: string | null;
  until: string | null;
  repo: string | null;
  branch: string | null;
  model: string | null;
  by: GroupDimension;
  top: number;
  json: boolean;
}

function isDimension(value: string): value is GroupDimension {
  return (
    value === 'repo' ||
    value === 'model' ||
    value === 'branch' ||
    value === 'day' ||
    value === 'week' ||
    value === 'kind' ||
    value === 'commit' ||
    value === 'release'
  );
}

function parseScanArgs(argv: readonly string[]): ScanArgs {
  const args: ScanArgs = {
    since: null,
    until: null,
    repo: null,
    branch: null,
    model: null,
    by: 'repo',
    top: 12,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token || !token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    const flag = eq >= 0 ? token.slice(0, eq) : token;
    let inline: string | null = eq >= 0 ? token.slice(eq + 1) : null;
    const takeValue = (): string => {
      if (inline !== null) return inline;
      const next = argv[i + 1] ?? '';
      i += 1;
      inline = next;
      return next;
    };
    switch (flag) {
      case '--since':
        args.since = takeValue();
        break;
      case '--until':
        args.until = takeValue();
        break;
      case '--repo':
        args.repo = takeValue();
        break;
      case '--branch':
        args.branch = takeValue();
        break;
      case '--model':
        args.model = takeValue();
        break;
      case '--by': {
        const value = takeValue();
        if (isDimension(value)) args.by = value;
        break;
      }
      case '--top': {
        const n = Number(takeValue());
        if (Number.isFinite(n) && n > 0) args.top = Math.floor(n);
        break;
      }
      case '--json':
        args.json = true;
        break;
      default:
        break;
    }
  }
  return args;
}

interface ServeArgs {
  port?: number;
  open: boolean;
}

function parseServeArgs(argv: readonly string[]): ServeArgs {
  const args: ServeArgs = { open: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token || !token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    const flag = eq >= 0 ? token.slice(0, eq) : token;
    const inline = eq >= 0 ? token.slice(eq + 1) : null;
    if (flag === '--port') {
      const n = Number(inline ?? argv[i + 1] ?? '');
      if (inline === null) i += 1;
      // Allow 0 to request an ephemeral port (the OS picks a free one).
      if (Number.isFinite(n) && n >= 0) args.port = Math.floor(n);
    } else if (flag === '--open') {
      args.open = true;
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`obolus — observability for AI coding-agent spend

Usage:
  obolus scan [options]   Scan local Claude Code + Codex history; show attributed spend
  obolus watch            Live-monitor spend as runs happen, stamped with commit (Ctrl+C to stop)
  obolus serve [options]  Local web dashboard at http://localhost:4317, updates live (Ctrl+C to stop)
  obolus help             Show this help

Scan options:
  --since <7d|30d|YYYY-MM-DD>   only runs since then
  --until <7d|YYYY-MM-DD>       only runs up to then
  --repo <name>                only this repo (basename)
  --branch <name>              only this branch
  --model <id>                 only this model
  --by <dimension>             group by: repo | model | branch | day | week | kind | commit | release (default: repo)
  --top <n>                    rows per section (default 12)
  --json                       machine-readable output

Serve options:
  --port <n>                   local dashboard port (default 4317)
  --open                       open the dashboard in your browser

Notes:
  "kind" = main thread vs subagent (sidechain) runs.
  Reads metadata only (tokens, model, repo, branch, time). Never reads your code
  or prompts. Cost is an estimate computed from a local rate table.`);
}

function resolveCutoff(label: string, raw: string | null): string | null {
  if (!raw) return null;
  const iso = parseSince(raw);
  if (!iso) {
    console.error(`obolus: could not parse ${label} "${raw}" (try 7d, 30d, or 2026-06-01); ignoring.`);
  }
  return iso;
}

async function runScan(rawArgs: readonly string[]): Promise<void> {
  const args = parseScanArgs(rawArgs);
  const events = await scanAll();

  // The ledger always records the full history; the report applies the view filters.
  const fullSummary = summarize(events, defaultPricingFor);

  const sinceIso = resolveCutoff('--since', args.since);
  const untilIso = resolveCutoff('--until', args.until);

  const view = filterEvents(events, {
    since: sinceIso,
    until: untilIso,
    repo: args.repo,
    branch: args.branch,
    model: args.model,
  });
  // Commit/release breakdowns need git attribution; resolve it only when asked
  // (it reads the local git history and the live ledger).
  const needAttribution = args.by === 'commit' || args.by === 'release';
  const attribution = needAttribution
    ? resolveAttribution(view, await readLiveRecords(), defaultGitHistory)
    : undefined;
  const summary = summarize(view, defaultPricingFor, attribution ? { attribution } : {});

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          since: sinceIso,
          until: untilIso,
          repo: args.repo,
          branch: args.branch,
          model: args.model,
          summary,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      renderSummary(summary, ANTHROPIC_PRICING, {
        by: args.by,
        top: args.top,
        since: sinceIso,
        until: untilIso,
        repo: args.repo,
        branch: args.branch,
        model: args.model,
        noHistory: events.length === 0,
      }),
    );
  }

  // Nothing to persist when there is no history — avoid writing an empty ledger
  // and claiming success on a brand-new user's first run.
  if (events.length === 0) return;

  const path = await writeLedger(events, fullSummary);
  if (!args.json) console.log(`\nLedger written: ${path}`);
}

/** Parse argv and dispatch to a command. */
export async function runCli(argv: readonly string[]): Promise<void> {
  const command = argv[0] ?? 'scan';
  switch (command) {
    case 'scan':
      await runScan(argv.slice(1));
      return;
    case 'watch':
      await runWatch();
      return;
    case 'serve':
      await runServe(parseServeArgs(argv.slice(1)));
      return;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    default:
      console.error(`obolus: unknown command "${command}"\n`);
      printHelp();
      process.exitCode = 1;
  }
}
