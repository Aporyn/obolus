import { scanTranscripts } from './collector/transcript-scanner.js';
import { writeLedger } from './ledger/ledger.js';
import { ANTHROPIC_PRICING } from './pricing/pricing-table.js';
import { summarize } from './report/aggregate.js';
import { renderSummary } from './report/terminal.js';

function printHelp(): void {
  console.log(`obolus — observability for AI coding-agent spend

Usage:
  obolus scan     Scan local Claude Code history; show per-repo / per-model spend
  obolus help     Show this help

Notes:
  Reads metadata only (tokens, model, repo, branch, time). Never reads your code
  or prompts. Cost is an estimate computed from a local rate table.`);
}

async function runScan(): Promise<void> {
  const events = await scanTranscripts();
  const summary = summarize(events, ANTHROPIC_PRICING);
  console.log(renderSummary(summary, ANTHROPIC_PRICING));
  const path = await writeLedger(events, summary);
  console.log(`\nLedger written: ${path}`);
}

/** Parse argv and dispatch to a command. */
export async function runCli(argv: readonly string[]): Promise<void> {
  const command = argv[0] ?? 'scan';
  switch (command) {
    case 'scan':
      await runScan();
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
