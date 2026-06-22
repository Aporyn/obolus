import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunEvent, TokenUsage } from '../domain/types.js';
import { ANTHROPIC_PRICING } from '../pricing/pricing-table.js';
import { priceRun } from '../pricing/cost.js';
import { appendLiveRecord } from '../ledger/live-ledger.js';
import { claudeProjectsDir } from './paths.js';
import { currentCommit } from './git.js';
import { parseRunLine } from './transcript-scanner.js';

const POLL_MS = 2000;

interface WatchState {
  offsets: Map<string, number>;
  seen: Set<string>;
  totalUsd: number;
  totalRuns: number;
}

function tokensOf(u: TokenUsage): number {
  return (
    u.inputTokens +
    u.outputTokens +
    u.cacheReadTokens +
    u.cacheWrite5mTokens +
    u.cacheWrite1hTokens
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Split a freshly read chunk into complete lines, holding back any partial
 * trailing line. Returns the lines and the number of bytes consumed (so the
 * caller can advance its file offset to the next line boundary). Pure.
 */
export function takeCompleteLines(chunk: string): { lines: string[]; consumed: number } {
  const lastNewline = chunk.lastIndexOf('\n');
  if (lastNewline < 0) return { lines: [], consumed: 0 };
  const complete = chunk.slice(0, lastNewline);
  const consumed = Buffer.byteLength(complete, 'utf8') + 1;
  return { lines: complete.length > 0 ? complete.split('\n') : [], consumed };
}

async function listTranscripts(root: string): Promise<string[]> {
  let dirs: string[];
  try {
    dirs = await readdir(root);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const dir of dirs) {
    try {
      const inner = await readdir(join(root, dir));
      for (const file of inner) if (file.endsWith('.jsonl')) files.push(join(root, dir, file));
    } catch {
      /* skip unreadable dir */
    }
  }
  return files;
}

async function readNewLines(path: string, from: number): Promise<{ lines: string[]; next: number }> {
  const info = await stat(path);
  if (info.size <= from) return { lines: [], next: from };
  const length = info.size - from;
  const buf = Buffer.alloc(length);
  const fh = await open(path, 'r');
  try {
    await fh.read(buf, 0, length, from);
  } finally {
    await fh.close();
  }
  const { lines, consumed } = takeCompleteLines(buf.toString('utf8'));
  return { lines, next: from + consumed };
}

function formatRun(event: RunEvent, commit: string | null, costUsd: number, runningUsd: number): string {
  const time = (event.timestamp ? new Date(event.timestamp) : new Date()).toISOString().slice(11, 19);
  const where = event.branch ? `${event.repo}/${event.branch}` : event.repo;
  const at = commit ? `@${commit}` : '';
  const sub = event.isSidechain ? ' [sub]' : '';
  return `${time}  ${where}${at}  +$${costUsd.toFixed(2)}  (Σ $${runningUsd.toFixed(2)})  ${fmtTokens(tokensOf(event.usage))}  ${event.model}${sub}`;
}

async function tick(root: string, state: WatchState): Promise<void> {
  for (const path of await listTranscripts(root)) {
    const from = state.offsets.get(path) ?? 0;
    let result: { lines: string[]; next: number };
    try {
      result = await readNewLines(path, from);
    } catch {
      continue;
    }
    state.offsets.set(path, result.next);
    for (const line of result.lines) {
      const event = parseRunLine(line);
      if (!event || state.seen.has(event.id)) continue;
      state.seen.add(event.id);
      const cost = priceRun(event.model, event.usage, ANTHROPIC_PRICING);
      const commit = currentCommit(event.repoPath);
      state.totalUsd += cost.totalUsd;
      state.totalRuns += 1;
      console.log(formatRun(event, commit, cost.totalUsd, state.totalUsd));
      await appendLiveRecord({
        ts: event.timestamp,
        repo: event.repo,
        repoPath: event.repoPath,
        branch: event.branch,
        commit,
        model: event.model,
        sessionId: event.sessionId,
        costUsd: cost.totalUsd,
        tokens: tokensOf(event.usage),
        isSidechain: event.isSidechain,
      });
    }
  }
}

/**
 * Live-monitor Claude Code spend: tails active transcripts, prices each new run
 * as it appears, stamps the commit checked out at that moment, prints it, and
 * appends it to the local live ledger. Runs until Ctrl+C.
 *
 * Set OBOLUS_WATCH_EXIT_MS to auto-stop after N ms (used for testing/scripting).
 */
export async function runWatch(root: string = claudeProjectsDir()): Promise<void> {
  const state: WatchState = { offsets: new Map(), seen: new Set(), totalUsd: 0, totalRuns: 0 };
  // Start at end-of-file for existing transcripts so we only report new runs.
  for (const path of await listTranscripts(root)) {
    try {
      state.offsets.set(path, (await stat(path)).size);
    } catch {
      /* skip */
    }
  }

  console.log('Obolus watch — live agent spend (metadata only · Ctrl+C to stop)');
  console.log('Waiting for runs…\n');

  const printSummary = (): void => {
    console.log(`\nSession: ${state.totalRuns} runs · est. $${state.totalUsd.toFixed(2)}`);
  };
  process.on('SIGINT', () => {
    printSummary();
    process.exit(0);
  });

  const exitMs = Number(process.env.OBOLUS_WATCH_EXIT_MS);
  const deadline = Number.isFinite(exitMs) && exitMs > 0 ? Date.now() + exitMs : null;

  for (;;) {
    await tick(root, state);
    if (deadline !== null && Date.now() >= deadline) {
      printSummary();
      return;
    }
    await sleep(POLL_MS);
  }
}
