import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tailAll } from '../src/collector/tail-all.js';
import type { LiveRun } from '../src/collector/tailer.js';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('tailAll', () => {
  it('forwards new runs from both vendors to a single onRun, with per-turn model seeded', async () => {
    // Claude root with an existing empty transcript (offsets seed here).
    const claude = await mkdtemp(join(tmpdir(), 'cc-tail-'));
    const project = join(claude, '-Users-x-repoA');
    await mkdir(project, { recursive: true });
    const ccFile = join(project, 'sess.jsonl');
    await writeFile(ccFile, '', 'utf8');

    // Codex root with an existing rollout carrying meta + turn_context (so the
    // tail can seed model/cwd) but no token_count yet.
    const codex = await mkdtemp(join(tmpdir(), 'cx-tail-'));
    const day = join(codex, '2026', '06', '24');
    await mkdir(day, { recursive: true });
    const cxFile = join(day, 'rollout-x.jsonl');
    await writeFile(
      cxFile,
      `${[
        JSON.stringify({ timestamp: '2026-06-24T10:00:00Z', type: 'session_meta', payload: { session_id: 's-cx', cwd: '/Users/x/repoB', git: { branch: 'dev' } } }),
        JSON.stringify({ timestamp: '2026-06-24T10:00:00Z', type: 'turn_context', payload: { model: 'gpt-5.5' } }),
      ].join('\n')}\n`,
      'utf8',
    );

    const runs: LiveRun[] = [];
    let stop = false;
    const running = tailAll(
      { claude, codex },
      (run) => {
        runs.push(run);
      },
      () => stop,
      { pollMs: 5 },
    );

    await delay(40); // let both tailers seed offsets/state

    await appendFile(
      ccFile,
      `${JSON.stringify({
        type: 'assistant',
        uuid: 'u1',
        requestId: 'r1',
        cwd: '/Users/x/repoA',
        sessionId: 's-cc',
        timestamp: '2026-06-24T10:01:00Z',
        message: { model: 'claude-opus-4-8', usage: { input_tokens: 100, output_tokens: 50 } },
      })}\n`,
      'utf8',
    );
    await appendFile(
      cxFile,
      `${JSON.stringify({ timestamp: '2026-06-24T10:01:01Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 200, output_tokens: 30, total_tokens: 230 } } } })}\n`,
      'utf8',
    );

    const deadline = Date.now() + 2000;
    while (runs.length < 2 && Date.now() < deadline) await delay(10);
    stop = true;
    await running;

    const vendors = runs.map((r) => r.event.vendor);
    expect(vendors).toContain('claude-code');
    expect(vendors).toContain('codex');
    expect(runs.find((r) => r.event.vendor === 'codex')?.event.model).toBe('gpt-5.5');
  });

  it('stops when isStopped() returns true', async () => {
    const claude = await mkdtemp(join(tmpdir(), 'cc-tail-'));
    const codex = await mkdtemp(join(tmpdir(), 'cx-tail-'));
    let stop = true;
    await tailAll({ claude, codex }, () => {}, () => stop, { pollMs: 5 });
    expect(stop).toBe(true); // returns promptly without hanging
  });
});
