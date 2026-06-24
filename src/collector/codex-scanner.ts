import { createReadStream } from 'node:fs';
import type { Dirent } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import type {
  RateLimitSnapshot,
  RateLimitWindow,
  RunEvent,
  TokenUsage,
} from '../domain/types.js';
import { priceRun } from '../pricing/cost.js';
import { defaultPricingFor, type PricingResolver } from '../pricing/registry.js';
import { codexSessionsDir, repoLabelFromCwd } from './paths.js';
import { currentCommit } from './git.js';
import type { LiveRun, TailOptions } from './tailer.js';
import { takeCompleteLines, tokensOf } from './tailer.js';

// Reads OpenAI Codex CLI rollout sessions. Metadata only — this reader
// allowlists a fixed set of numeric/enum fields (token counts, rate-limit %,
// session_meta git/cwd, turn_context.model) and NEVER reads prompt, code,
// message, reasoning, or auth secret content (invariant #2). See
// prospect/discoveries/obolus-data-sources-codex.md for the verified schema.

/** One line of a rollout-*.jsonl file. `payload` shape depends on `type`. */
interface RolloutLine {
  timestamp?: string;
  type?: string;
  payload?: RolloutPayload;
}

interface RolloutPayload {
  // session_meta
  cwd?: string;
  session_id?: string;
  id?: string;
  cli_version?: string;
  git?: { branch?: string };
  source?: { subagent?: unknown };
  // turn_context
  model?: string;
  // event_msg (token_count)
  type?: string;
  info?: { last_token_usage?: RawLastUsage };
  rate_limits?: RawRateLimits;
}

interface RawLastUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface RawWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number | string | null;
}

interface RawRateLimits {
  primary?: RawWindow | null;
  secondary?: RawWindow | null;
  plan_type?: string | null;
}

/** Mutable per-file fold state. Codex spreads billing facts across line types. */
interface CodexState {
  sessionId: string;
  cwd: string;
  branch: string | null;
  isSidechain: boolean;
  toolVersion: string | null;
  /** Latest turn_context.model seen — token_count lines carry no model. */
  currentModel: string;
  /** Latest rate_limits seen (account-level snapshot; last wins). */
  latestRateLimit: RateLimitSnapshot | null;
}

function freshState(): CodexState {
  return {
    sessionId: 'unknown',
    cwd: '',
    branch: null,
    isSidechain: false,
    toolVersion: null,
    currentModel: 'unknown',
    latestRateLimit: null,
  };
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Convert an epoch (seconds or ms) or ISO string to ISO 8601, or null. */
function toIso(v: number | string | null | undefined): string | null {
  if (typeof v === 'string') return v || null;
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const ms = v < 1e12 ? v * 1000 : v;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toWindow(w: RawWindow | null | undefined): RateLimitWindow | null {
  if (!w || typeof w !== 'object') return null;
  const usedPercent = num(w.used_percent);
  const windowMinutes = num(w.window_minutes);
  if (usedPercent === undefined && windowMinutes === undefined) return null;
  return {
    usedPercent: usedPercent ?? 0,
    windowMinutes: windowMinutes ?? 0,
    resetsAt: toIso(w.resets_at),
  };
}

function toSnapshot(rl: RawRateLimits | undefined, capturedAt: string): RateLimitSnapshot | null {
  if (!rl || typeof rl !== 'object') return null;
  const primary = toWindow(rl.primary);
  const secondary = toWindow(rl.secondary);
  const planType = typeof rl.plan_type === 'string' ? rl.plan_type : null;
  if (!primary && !secondary && planType === null) return null;
  return { vendor: 'codex', capturedAt, primary, secondary, planType };
}

/**
 * Map Codex token counts to the vendor-neutral TokenUsage. OpenAI's `input_tokens`
 * INCLUDES `cached_input_tokens` (cached ⊆ input; total = input + output), so the
 * cached portion is subtracted out of input to avoid double-counting once the
 * cache-read line is priced separately. Reasoning is inside output — never added.
 * OpenAI has no cache-write tiers, so both write fields are 0.
 */
function toUsage(u: RawLastUsage): TokenUsage {
  const cached = num(u.cached_input_tokens) ?? 0;
  const rawInput = num(u.input_tokens) ?? 0;
  return {
    inputTokens: Math.max(rawInput - cached, 0),
    outputTokens: num(u.output_tokens) ?? 0,
    cacheReadTokens: cached,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
  };
}

/**
 * Fold one rollout line into the running state, returning a RunEvent when the
 * line is a billable token_count, else null. Parses metadata only.
 */
export function foldRolloutLine(state: CodexState, line: string): RunEvent | null {
  // Cheap pre-filter: only the three structural line types matter; content
  // lines (reasoning/message/function_call) are skipped without a JSON.parse,
  // which is both faster and avoids touching prompt/code content.
  if (
    !line ||
    !(
      line.includes('token_count') ||
      line.includes('turn_context') ||
      line.includes('session_meta')
    )
  ) {
    return null;
  }
  let raw: RolloutLine;
  try {
    raw = JSON.parse(line) as RolloutLine;
  } catch {
    return null;
  }
  const p = raw.payload;
  if (!p) return null;

  if (raw.type === 'session_meta') {
    if (p.cwd) state.cwd = p.cwd;
    state.sessionId = p.session_id ?? p.id ?? state.sessionId;
    state.toolVersion = p.cli_version ?? state.toolVersion;
    const branch = p.git?.branch;
    state.branch = branch && branch !== 'HEAD' ? branch : null;
    if (p.source?.subagent != null) state.isSidechain = true;
    return null;
  }

  if (raw.type === 'turn_context') {
    if (typeof p.model === 'string' && p.model) state.currentModel = p.model;
    if (!state.cwd && p.cwd) state.cwd = p.cwd;
    return null;
  }

  if (raw.type === 'event_msg' && p.type === 'token_count') {
    const timestamp = raw.timestamp ?? '';
    const snapshot = toSnapshot(p.rate_limits, timestamp);
    if (snapshot) state.latestRateLimit = snapshot;

    const last = p.info?.last_token_usage;
    if (!last) return null;
    const usage = toUsage(last);
    if (tokensOf(usage) === 0) return null;

    return {
      // No requestId in Codex; namespace by vendor so ids never collide with
      // Claude Code's, and dedup a resumed/re-read rollout.
      id: `codex:${state.sessionId}:${timestamp}`,
      vendor: 'codex',
      model: state.currentModel,
      usage,
      repoPath: state.cwd,
      repo: state.cwd ? repoLabelFromCwd(state.cwd) : 'unknown',
      branch: state.branch,
      sessionId: state.sessionId,
      requestId: null,
      timestamp,
      toolVersion: state.toolVersion,
      isSidechain: state.isSidechain,
      serverTools: { webSearchRequests: 0, webFetchRequests: 0 },
    };
  }

  return null;
}

/**
 * Recursively collect every `rollout-*.jsonl` file under `dir` (Codex nests them
 * as `YYYY/MM/DD/rollout-*.jsonl`). Returns [] when unreadable; names only.
 */
export async function listRolloutFiles(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listRolloutFiles(full)));
    } else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
  return out;
}

async function readFileEvents(
  path: string,
  out: RunEvent[],
  seen: Set<string>,
  snapshots: RateLimitSnapshot[],
): Promise<void> {
  const state = freshState();
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const event = foldRolloutLine(state, line);
    if (!event) continue;
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    out.push(event);
  }
  if (state.latestRateLimit) snapshots.push(state.latestRateLimit);
}

/**
 * Scan all local Codex rollout sessions. Returns de-duplicated run events plus
 * the latest rate-limit snapshot from each session (account-level; one per file
 * that reported quota). Reads metadata only.
 */
export async function scanCodexSessions(
  root: string = codexSessionsDir(),
): Promise<{ events: RunEvent[]; rateLimits: RateLimitSnapshot[] }> {
  const events: RunEvent[] = [];
  const rateLimits: RateLimitSnapshot[] = [];
  const seen = new Set<string>();
  for (const file of await listRolloutFiles(root)) {
    await readFileEvents(file, events, seen, rateLimits);
  }
  return { events, rateLimits };
}

async function seedStateFromFile(path: string): Promise<CodexState> {
  // Pre-scan session_meta + turn_context so a tail starting at EOF still knows
  // the session's cwd/branch/model (those lines precede the live token_counts).
  const state = freshState();
  try {
    const rl = createInterface({
      input: createReadStream(path, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (line.includes('session_meta') || line.includes('turn_context')) {
        foldRolloutLine(state, line);
      }
    }
  } catch {
    /* unreadable — leave state fresh */
  }
  return state;
}

/**
 * Tail active Codex rollout sessions: seeds per-file session state, starts at
 * end-of-file so only NEW runs are reported, then polls for appended runs,
 * pricing each by its (per-turn) model. Calls `onRun` per new run; stops when
 * `isStopped()` returns true. Metadata only.
 */
export async function tailCodexSessions(
  root: string,
  onRun: (run: LiveRun) => void | Promise<void>,
  isStopped: () => boolean,
  opts: TailOptions = {},
): Promise<void> {
  const pollMs = opts.pollMs ?? 2000;
  const pricingFor: PricingResolver = opts.pricingFor ?? defaultPricingFor;
  const offsets = new Map<string, number>();
  const states = new Map<string, CodexState>();
  const seen = new Set<string>();
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const ensureState = async (path: string): Promise<CodexState> => {
    let state = states.get(path);
    if (!state) {
      state = await seedStateFromFile(path);
      states.set(path, state);
    }
    return state;
  };

  for (const path of await listRolloutFiles(root)) {
    try {
      offsets.set(path, (await stat(path)).size);
      await ensureState(path);
    } catch {
      /* skip */
    }
  }

  while (!isStopped()) {
    for (const path of await listRolloutFiles(root)) {
      const from = offsets.get(path) ?? 0;
      const state = await ensureState(path);
      let info;
      try {
        info = await stat(path);
      } catch {
        continue;
      }
      if (info.size <= from) continue;
      const length = info.size - from;
      const buf = Buffer.alloc(length);
      try {
        const fh = await open(path, 'r');
        try {
          await fh.read(buf, 0, length, from);
        } finally {
          await fh.close();
        }
      } catch {
        continue;
      }
      const { lines, consumed } = takeCompleteLines(buf.toString('utf8'));
      offsets.set(path, from + consumed);
      for (const line of lines) {
        const event = foldRolloutLine(state, line);
        if (!event || seen.has(event.id)) continue;
        seen.add(event.id);
        const cost = priceRun(event.model, event.usage, pricingFor(event.vendor), event.serverTools);
        const commit = currentCommit(event.repoPath);
        await onRun({ event, cost, commit, tokens: tokensOf(event.usage) });
      }
    }
    if (isStopped()) break;
    await sleep(pollMs);
  }
}

export { codexSessionsDir };
export type { CodexState };
export { freshState as freshCodexState };
