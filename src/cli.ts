import { scanTranscripts } from './collector/transcript-scanner.js';
import { writeLedger } from './ledger/ledger.js';
import { ANTHROPIC_PRICING } from './pricing/pricing-table.js';
import { summarize } from './report/aggregate.js';
import { filterEvents } from './report/filter.js';
import { parseSince } from './report/timeframe.js';
import { renderSummary, type GroupDimension } from './report/terminal.js';

interface ScanArgs {
  since: string | null;
  repo: string | null;
  by: GroupDimension;
  top: number;
  json: boolean;
}

function isDimension(value: string): value is GroupDimension {
  return value === 'repo' || value === 'model' || value === 'branch';
}

function parseScanArgs(argv: readonly string[]): ScanArgs {
  const args: ScanArgs = { since: null, repo: null, by: 'repo', top: 12, json: false };
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
      case '--repo':
        args.repo = takeValue();
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

function printHelp(): void {
  console.log(`obolus — observability for AI coding-agent spend

Usage:
  obolus scan [options]   Scan local Claude Code history; show attributed spend
  obolus help             Show this help

Scan options:
  --since <7d|30d|YYYY-MM-DD>   only runs since then
  --repo <name>                only this repo (basename)
  --by <repo|model|branch>     primary grouping (default: repo)
  --top <n>                    rows per section (default 12)
  --json                       machine-readable output

Notes:
  Reads metadata only (tokens, model, repo, branch, time). Never reads your code
  or prompts. Cost is an estimate computed from a local rate table.`);
}

async function runScan(rawArgs: readonly string[]): Promise<void> {
  const args = parseScanArgs(rawArgs);
  const events = await scanTranscripts();

  // The ledger always records the full history; the report applies the view filters.
  const fullSummary = summarize(events, ANTHROPIC_PRICING);

  let sinceIso: string | null = null;
  if (args.since) {
    sinceIso = parseSince(args.since);
    if (!sinceIso) {
      console.error(
        `obolus: could not parse --since "${args.since}" (try 7d, 30d, or 2026-06-01); ignoring.`,
      );
    }
  }

  const view = filterEvents(events, { since: sinceIso, repo: args.repo });
  const summary = summarize(view, ANTHROPIC_PRICING);

  if (args.json) {
    console.log(JSON.stringify({ since: sinceIso, repo: args.repo, summary }, null, 2));
  } else {
    console.log(
      renderSummary(summary, ANTHROPIC_PRICING, {
        by: args.by,
        top: args.top,
        since: sinceIso,
        repo: args.repo,
      }),
    );
  }

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
