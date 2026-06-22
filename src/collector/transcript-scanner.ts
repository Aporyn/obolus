import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import type { RunEvent, TokenUsage } from '../domain/types.js';
import { claudeProjectsDir, repoLabelFromCwd } from './paths.js';

/** Shape of the fields Obolus reads from a Claude Code transcript line. */
interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

interface RawLine {
  type?: string;
  uuid?: string;
  cwd?: string;
  gitBranch?: string;
  sessionId?: string;
  requestId?: string;
  timestamp?: string;
  version?: string;
  isSidechain?: boolean;
  message?: { model?: string; usage?: RawUsage };
}

function toUsage(u: RawUsage): TokenUsage {
  const split = u.cache_creation;
  const w5 = split?.ephemeral_5m_input_tokens ?? 0;
  const w1 = split?.ephemeral_1h_input_tokens ?? 0;
  const totalCreation = u.cache_creation_input_tokens ?? 0;
  // If the TTL split is absent, attribute all cache creation to the 5m tier.
  const hasSplit = w5 + w1 > 0;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWrite5mTokens: hasSplit ? w5 : totalCreation,
    cacheWrite1hTokens: hasSplit ? w1 : 0,
  };
}

/** Synthetic placeholder model Claude Code emits for non-billable injected turns. */
const SYNTHETIC_MODEL = '<synthetic>';

function totalTokens(u: TokenUsage): number {
  return (
    u.inputTokens +
    u.outputTokens +
    u.cacheReadTokens +
    u.cacheWrite5mTokens +
    u.cacheWrite1hTokens
  );
}

function lineToEvent(raw: RawLine): RunEvent | null {
  if (raw.type !== 'assistant') return null;
  const msg = raw.message;
  if (!msg?.usage || !msg.model) return null;
  // Skip synthetic/non-billable turns (e.g. injected messages with zero usage).
  if (msg.model === SYNTHETIC_MODEL) return null;
  const usage = toUsage(msg.usage);
  if (totalTokens(usage) === 0) return null;

  const cwd = raw.cwd ?? '';
  // 'HEAD' means detached HEAD — not a usable branch name.
  const branch = raw.gitBranch && raw.gitBranch !== 'HEAD' ? raw.gitBranch : null;
  const id = raw.uuid ?? raw.requestId ?? `${raw.sessionId ?? 'unknown'}:${raw.timestamp ?? ''}`;

  return {
    id,
    vendor: 'claude-code',
    model: msg.model,
    usage,
    repoPath: cwd,
    repo: cwd ? repoLabelFromCwd(cwd) : 'unknown',
    branch,
    sessionId: raw.sessionId ?? 'unknown',
    requestId: raw.requestId ?? null,
    timestamp: raw.timestamp ?? '',
    toolVersion: raw.version ?? null,
    isSidechain: raw.isSidechain ?? false,
  };
}

/**
 * Parse a single transcript line into a run event, or null if it is not a
 * billable assistant run. Reads metadata only. Shared by the scanner and the
 * live watcher.
 */
export function parseRunLine(line: string): RunEvent | null {
  // Cheap pre-filter: skip lines that cannot be assistant runs (e.g. large
  // attachment lines) without paying for a full JSON.parse.
  if (!line || !line.includes('"assistant"')) return null;
  let raw: RawLine;
  try {
    raw = JSON.parse(line) as RawLine;
  } catch {
    return null;
  }
  return lineToEvent(raw);
}

async function readFileEvents(path: string, out: RunEvent[], seen: Set<string>): Promise<void> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const event = parseRunLine(line);
    if (!event) continue;
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    out.push(event);
  }
}

/**
 * Scan all local Claude Code transcripts and return de-duplicated run events.
 * Reads only metadata; never returns prompt or code content.
 */
export async function scanTranscripts(rootDir: string = claudeProjectsDir()): Promise<RunEvent[]> {
  let projectDirs: string[];
  try {
    projectDirs = await readdir(rootDir);
  } catch {
    return [];
  }

  const events: RunEvent[] = [];
  const seen = new Set<string>();
  for (const dir of projectDirs) {
    const projectPath = join(rootDir, dir);
    let files: string[];
    try {
      files = (await readdir(projectPath)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of files) {
      await readFileEvents(join(projectPath, file), events, seen);
    }
  }
  return events;
}
