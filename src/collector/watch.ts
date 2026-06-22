import type { RunEvent } from '../domain/types.js';
import { appendLiveRecord } from '../ledger/live-ledger.js';
import { claudeProjectsDir } from './paths.js';
import { tailRuns, tokensOf } from './tailer.js';

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatRun(event: RunEvent, commit: string | null, costUsd: number, runningUsd: number): string {
  const time = (event.timestamp ? new Date(event.timestamp) : new Date()).toISOString().slice(11, 19);
  const where = event.branch ? `${event.repo}/${event.branch}` : event.repo;
  const at = commit ? `@${commit}` : '';
  const sub = event.isSidechain ? ' [sub]' : '';
  return `${time}  ${where}${at}  +$${costUsd.toFixed(2)}  (Σ $${runningUsd.toFixed(2)})  ${fmtTokens(tokensOf(event.usage))}  ${event.model}${sub}`;
}

/**
 * Live-monitor Claude Code spend in the terminal: tails active transcripts,
 * prices each new run as it appears, stamps the commit checked out at that
 * moment, prints it, and appends it to the local live ledger. Runs until Ctrl+C.
 *
 * Set OBOLUS_WATCH_EXIT_MS to auto-stop after N ms (used for testing/scripting).
 */
export async function runWatch(root: string = claudeProjectsDir()): Promise<void> {
  let totalUsd = 0;
  let totalRuns = 0;

  console.log('Obolus watch — live agent spend (metadata only · Ctrl+C to stop)');
  console.log('Waiting for runs…\n');

  const printSummary = (): void => {
    console.log(`\nSession: ${totalRuns} runs · est. $${totalUsd.toFixed(2)}`);
  };
  process.on('SIGINT', () => {
    printSummary();
    process.exit(0);
  });

  const exitMs = Number(process.env.OBOLUS_WATCH_EXIT_MS);
  const deadline = Number.isFinite(exitMs) && exitMs > 0 ? Date.now() + exitMs : null;

  await tailRuns(
    root,
    async (run) => {
      totalUsd += run.cost.totalUsd;
      totalRuns += 1;
      console.log(formatRun(run.event, run.commit, run.cost.totalUsd, totalUsd));
      await appendLiveRecord({
        ts: run.event.timestamp,
        repo: run.event.repo,
        repoPath: run.event.repoPath,
        branch: run.event.branch,
        commit: run.commit,
        model: run.event.model,
        sessionId: run.event.sessionId,
        costUsd: run.cost.totalUsd,
        tokens: run.tokens,
        isSidechain: run.event.isSidechain,
      });
    },
    () => deadline !== null && Date.now() >= deadline,
  );

  printSummary();
}
