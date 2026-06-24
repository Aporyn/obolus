import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { CostBreakdown, RunEvent, TokenUsage } from '../domain/types.js';
import { ANTHROPIC_PRICING } from '../pricing/pricing-table.js';
import { priceRun } from '../pricing/cost.js';
import { claudeProjectsDir } from './paths.js';
import { currentCommit } from './git.js';
import { listJsonlFiles, parseRunLine } from './transcript-scanner.js';

/** A run observed live: the event plus its computed cost and commit. */
export interface LiveRun {
  readonly event: RunEvent;
  readonly cost: CostBreakdown;
  readonly commit: string | null;
  readonly tokens: number;
}

export interface TailOptions {
  readonly pollMs?: number;
}

export function tokensOf(u: TokenUsage): number {
  return (
    u.inputTokens +
    u.outputTokens +
    u.cacheReadTokens +
    u.cacheWrite5mTokens +
    u.cacheWrite1hTokens
  );
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Split a freshly read chunk into complete lines, holding back any partial
 * trailing line. Returns the lines and bytes consumed (so the caller can advance
 * its file offset to the next line boundary). Pure.
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
  // Each project dir may nest subagent transcripts under <sessionId>/subagents/**,
  // so descend recursively rather than listing one level (see listJsonlFiles).
  const files: string[] = [];
  for (const dir of dirs) {
    files.push(...(await listJsonlFiles(join(root, dir))));
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

/**
 * Tail active Claude Code transcripts. Starts at end-of-file for existing
 * transcripts so only NEW runs are reported, then polls for appended runs,
 * pricing each and stamping the commit checked out at observation time. Calls
 * `onRun` per new run; stops when `isStopped()` returns true. Metadata only.
 */
export async function tailRuns(
  root: string,
  onRun: (run: LiveRun) => void | Promise<void>,
  isStopped: () => boolean,
  opts: TailOptions = {},
): Promise<void> {
  const pollMs = opts.pollMs ?? 2000;
  const offsets = new Map<string, number>();
  const seen = new Set<string>();
  for (const path of await listTranscripts(root)) {
    try {
      offsets.set(path, (await stat(path)).size);
    } catch {
      /* skip */
    }
  }

  while (!isStopped()) {
    for (const path of await listTranscripts(root)) {
      const from = offsets.get(path) ?? 0;
      let result: { lines: string[]; next: number };
      try {
        result = await readNewLines(path, from);
      } catch {
        continue;
      }
      offsets.set(path, result.next);
      for (const line of result.lines) {
        const event = parseRunLine(line);
        if (!event || seen.has(event.id)) continue;
        seen.add(event.id);
        const cost = priceRun(event.model, event.usage, ANTHROPIC_PRICING);
        const commit = currentCommit(event.repoPath);
        await onRun({ event, cost, commit, tokens: tokensOf(event.usage) });
      }
    }
    if (isStopped()) break;
    await sleep(pollMs);
  }
}

export { claudeProjectsDir };
