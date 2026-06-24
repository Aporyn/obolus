import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanAll, scanAllWithMeta } from '../src/collector/scan-all.js';

async function claudeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cc-'));
  const project = join(root, '-Users-x-repoA');
  await mkdir(project, { recursive: true });
  await writeFile(
    join(project, 'a.jsonl'),
    `${JSON.stringify({
      type: 'assistant',
      uuid: 'u1',
      requestId: 'r1',
      cwd: '/Users/x/repoA',
      gitBranch: 'main',
      sessionId: 's-cc',
      timestamp: '2026-06-24T09:00:00Z',
      message: { model: 'claude-opus-4-8', usage: { input_tokens: 100, output_tokens: 50 } },
    })}\n`,
    'utf8',
  );
  return root;
}

async function codexRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cx-'));
  const day = join(root, '2026', '06', '24');
  await mkdir(day, { recursive: true });
  const lines = [
    JSON.stringify({ timestamp: '2026-06-24T10:00:00Z', type: 'session_meta', payload: { session_id: 's-cx', cwd: '/Users/x/repoB', git: { branch: 'dev' }, cli_version: '0.142.0' } }),
    JSON.stringify({ timestamp: '2026-06-24T10:00:00Z', type: 'turn_context', payload: { model: 'gpt-5.5' } }),
    JSON.stringify({ timestamp: '2026-06-24T10:00:01Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 200, output_tokens: 30, total_tokens: 230 } }, rate_limits: { primary: { used_percent: 50, window_minutes: 300, resets_at: 1_780_000_000 }, secondary: { used_percent: 20, window_minutes: 10080 }, plan_type: 'plus' } } }),
  ];
  await writeFile(join(day, 'rollout-x.jsonl'), `${lines.join('\n')}\n`, 'utf8');
  return root;
}

describe('scanAll', () => {
  it('merges claude-code and codex events from separate roots', async () => {
    const events = await scanAll({ claude: await claudeRoot(), codex: await codexRoot() });
    expect(events).toHaveLength(2);
    expect(events.some((e) => e.vendor === 'claude-code')).toBe(true);
    expect(events.some((e) => e.vendor === 'codex')).toBe(true);
  });

  it('returns only claude events when the codex root is empty/missing', async () => {
    const events = await scanAll({ claude: await claudeRoot(), codex: '/no/such/codex' });
    expect(events).toHaveLength(1);
    expect(events[0]?.vendor).toBe('claude-code');
  });

  it('returns [] when both roots are missing', async () => {
    const events = await scanAll({ claude: '/no/cc', codex: '/no/cx' });
    expect(events).toEqual([]);
  });

  it('tags merged events with their correct vendor', async () => {
    const events = await scanAll({ claude: await claudeRoot(), codex: await codexRoot() });
    expect(events.find((e) => e.repo === 'repoA')?.vendor).toBe('claude-code');
    expect(events.find((e) => e.repo === 'repoB')?.vendor).toBe('codex');
  });
});

describe('scanAllWithMeta', () => {
  it('returns the latest codex rate-limit snapshot and no snapshot for claude', async () => {
    const { events, rateLimits } = await scanAllWithMeta({ claude: await claudeRoot(), codex: await codexRoot() });
    expect(events).toHaveLength(2);
    expect(rateLimits).toHaveLength(1);
    expect(rateLimits[0]?.vendor).toBe('codex');
    expect(rateLimits[0]?.primary?.windowMinutes).toBe(300);
    expect(rateLimits[0]?.planType).toBe('plus');
  });

  it('returns no rate limits when there is no codex history', async () => {
    const { rateLimits } = await scanAllWithMeta({ claude: await claudeRoot(), codex: '/no/cx' });
    expect(rateLimits).toEqual([]);
  });
});
