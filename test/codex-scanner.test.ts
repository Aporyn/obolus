import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanCodexSessions } from '../src/collector/codex-scanner.js';

/** Build one rollout line (metadata only — counts/enums, no prompt/code content). */
function rolloutLine(type: string, payload: Record<string, unknown>, timestamp = '2026-06-24T10:00:00Z'): string {
  return JSON.stringify({ timestamp, type, payload });
}

function sessionMeta(o: {
  sessionId?: string;
  cwd?: string;
  branch?: string;
  cliVersion?: string;
  subagent?: boolean;
} = {}): string {
  const payload: Record<string, unknown> = {
    session_id: o.sessionId ?? 's1',
    cwd: o.cwd ?? '/Users/x/repoA',
    cli_version: o.cliVersion ?? '0.142.0',
  };
  if (o.branch !== undefined) payload.git = { branch: o.branch };
  if (o.subagent) payload.source = { subagent: { thread_spawn: { parent_thread_id: 'p1', depth: 1 } } };
  return rolloutLine('session_meta', payload);
}

function turnContext(model: string): string {
  return rolloutLine('turn_context', { model });
}

function tokenCount(
  usage: Record<string, number>,
  opts: { rateLimits?: Record<string, unknown>; timestamp?: string } = {},
): string {
  const payload: Record<string, unknown> = { type: 'token_count', info: { last_token_usage: usage } };
  if (opts.rateLimits) payload.rate_limits = opts.rateLimits;
  return rolloutLine('event_msg', payload, opts.timestamp ?? '2026-06-24T10:00:01Z');
}

const RL = {
  primary: { used_percent: 62, window_minutes: 300, resets_at: 1_780_000_000 },
  secondary: { used_percent: 40, window_minutes: 10080, resets_at: 1_780_500_000 },
  plan_type: 'team',
};

/** Write a rollout file under a YYYY/MM/DD tree; returns the session root dir. */
async function writeRollout(lines: string[], name = 'rollout-2026-06-24T10-00-00-aaaa.jsonl'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codex-'));
  const day = join(root, '2026', '06', '24');
  await mkdir(day, { recursive: true });
  await writeFile(join(day, name), `${lines.join('\n')}\n`, 'utf8');
  return root;
}

describe('scanCodexSessions', () => {
  it('discovers rollout-*.jsonl under YYYY/MM/DD and ignores other files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-'));
    const day = join(root, '2026', '06', '24');
    await mkdir(day, { recursive: true });
    await writeFile(join(day, 'rollout-x.jsonl'), `${[sessionMeta(), turnContext('gpt-5.5'), tokenCount({ input_tokens: 100, output_tokens: 50, total_tokens: 150 })].join('\n')}\n`, 'utf8');
    await writeFile(join(day, 'notes.jsonl'), 'garbage\n', 'utf8');
    await writeFile(join(day, 'session_index.jsonl'), 'also-ignored\n', 'utf8');

    const { events } = await scanCodexSessions(root);
    expect(events).toHaveLength(1);
    expect(events[0]?.vendor).toBe('codex');
  });

  it('emits one RunEvent per token_count, tagged vendor codex', async () => {
    const root = await writeRollout([
      sessionMeta(),
      turnContext('gpt-5.5'),
      tokenCount({ input_tokens: 100, output_tokens: 50, total_tokens: 150 }),
      tokenCount({ input_tokens: 80, output_tokens: 20, total_tokens: 100 }, { timestamp: '2026-06-24T10:00:02Z' }),
    ]);
    const { events } = await scanCodexSessions(root);
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.vendor === 'codex')).toBe(true);
    expect(events.every((e) => e.requestId === null)).toBe(true);
  });

  it('prices each turn by the nearest preceding turn_context.model (mixed models)', async () => {
    const root = await writeRollout([
      sessionMeta(),
      turnContext('gpt-5.5'),
      tokenCount({ input_tokens: 100, output_tokens: 50, total_tokens: 150 }, { timestamp: '2026-06-24T10:00:01Z' }),
      turnContext('codex-auto-review'),
      tokenCount({ input_tokens: 10, output_tokens: 5, total_tokens: 15 }, { timestamp: '2026-06-24T10:00:03Z' }),
    ]);
    const { events } = await scanCodexSessions(root);
    expect(events.find((e) => e.timestamp === '2026-06-24T10:00:01Z')?.model).toBe('gpt-5.5');
    expect(events.find((e) => e.timestamp === '2026-06-24T10:00:03Z')?.model).toBe('codex-auto-review');
  });

  it('maps cached to cacheRead and subtracts it from input (input is cache-inclusive)', async () => {
    const root = await writeRollout([
      sessionMeta(),
      turnContext('gpt-5.5'),
      tokenCount({ input_tokens: 64040, cached_input_tokens: 60800, output_tokens: 2599, total_tokens: 66639 }),
    ]);
    const { events } = await scanCodexSessions(root);
    const u = events[0]!.usage;
    expect(u.cacheReadTokens).toBe(60800);
    expect(u.inputTokens).toBe(64040 - 60800);
    // input + cacheRead reconstructs the reported input_tokens (no double count).
    expect(u.inputTokens + u.cacheReadTokens).toBe(64040);
    expect(u.cacheWrite5mTokens).toBe(0);
    expect(u.cacheWrite1hTokens).toBe(0);
  });

  it('does not add reasoning_output_tokens on top of output_tokens', async () => {
    const root = await writeRollout([
      sessionMeta(),
      turnContext('gpt-5.5'),
      tokenCount({ input_tokens: 10, output_tokens: 100, reasoning_output_tokens: 70, total_tokens: 110 }),
    ]);
    const { events } = await scanCodexSessions(root);
    expect(events[0]?.usage.outputTokens).toBe(100);
  });

  it('derives repo/branch from session_meta git at session start', async () => {
    const root = await writeRollout([
      sessionMeta({ cwd: '/Users/x/myrepo', branch: 'feature/x' }),
      turnContext('gpt-5.5'),
      tokenCount({ input_tokens: 5, output_tokens: 5, total_tokens: 10 }),
    ]);
    const { events } = await scanCodexSessions(root);
    expect(events[0]?.repo).toBe('myrepo');
    expect(events[0]?.repoPath).toBe('/Users/x/myrepo');
    expect(events[0]?.branch).toBe('feature/x');
  });

  it('treats detached HEAD branch as null', async () => {
    const root = await writeRollout([
      sessionMeta({ branch: 'HEAD' }),
      turnContext('gpt-5.5'),
      tokenCount({ input_tokens: 5, output_tokens: 5, total_tokens: 10 }),
    ]);
    const { events } = await scanCodexSessions(root);
    expect(events[0]?.branch).toBeNull();
  });

  it('marks isSidechain when session_meta has a subagent thread_spawn', async () => {
    const root = await writeRollout([
      sessionMeta({ subagent: true }),
      turnContext('gpt-5.5'),
      tokenCount({ input_tokens: 5, output_tokens: 5, total_tokens: 10 }),
    ]);
    const { events } = await scanCodexSessions(root);
    expect(events[0]?.isSidechain).toBe(true);
  });

  it('dedups a re-read rollout by codex:session:timestamp id', async () => {
    const tc = tokenCount({ input_tokens: 5, output_tokens: 5, total_tokens: 10 }, { timestamp: '2026-06-24T10:00:01Z' });
    const root = await writeRollout([sessionMeta(), turnContext('gpt-5.5'), tc, tc]);
    const { events } = await scanCodexSessions(root);
    expect(events).toHaveLength(1);
  });

  it('skips token_count lines with zero usage', async () => {
    const root = await writeRollout([
      sessionMeta(),
      turnContext('gpt-5.5'),
      tokenCount({ input_tokens: 0, output_tokens: 0, total_tokens: 0 }),
      tokenCount({ input_tokens: 1, output_tokens: 0, total_tokens: 1 }, { timestamp: '2026-06-24T10:00:09Z' }),
    ]);
    const { events } = await scanCodexSessions(root);
    expect(events).toHaveLength(1);
  });

  it('captures the latest rate_limits snapshot per session (last wins), with 5h + weekly + planType', async () => {
    const root = await writeRollout([
      sessionMeta(),
      turnContext('gpt-5.5'),
      tokenCount({ input_tokens: 5, output_tokens: 5, total_tokens: 10 }, { rateLimits: { primary: { used_percent: 10, window_minutes: 300 } }, timestamp: '2026-06-24T10:00:01Z' }),
      tokenCount({ input_tokens: 5, output_tokens: 5, total_tokens: 10 }, { rateLimits: RL, timestamp: '2026-06-24T10:00:05Z' }),
    ]);
    const { rateLimits } = await scanCodexSessions(root);
    expect(rateLimits).toHaveLength(1);
    const snap = rateLimits[0]!;
    expect(snap.vendor).toBe('codex');
    expect(snap.primary?.usedPercent).toBe(62);
    expect(snap.primary?.windowMinutes).toBe(300);
    expect(snap.primary?.resetsAt).not.toBeNull();
    expect(snap.secondary?.windowMinutes).toBe(10080);
    expect(snap.planType).toBe('team');
    expect(snap.capturedAt).toBe('2026-06-24T10:00:05Z');
  });

  it('returns no events and no snapshots for a missing root', async () => {
    const { events, rateLimits } = await scanCodexSessions('/no/such/dir/codex-test');
    expect(events).toEqual([]);
    expect(rateLimits).toEqual([]);
  });

  it('never surfaces prompt/response text (allowlist only)', async () => {
    const SECRET = 'SUPER_SECRET_PROMPT_TEXT_xyz';
    const root = await writeRollout([
      sessionMeta(),
      turnContext('gpt-5.5'),
      // A content line that must be ignored entirely.
      rolloutLine('response_item', { type: 'message', text: SECRET, content: SECRET }),
      tokenCount({ input_tokens: 5, output_tokens: 5, total_tokens: 10 }),
    ]);
    const { events } = await scanCodexSessions(root);
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });
});
