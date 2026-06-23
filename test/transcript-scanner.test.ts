import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanTranscripts } from '../src/collector/transcript-scanner.js';

describe('scanTranscripts', () => {
  it('extracts assistant usage lines, derives repo/branch, and de-dups by requestId', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obolus-'));
    const project = join(root, '-Users-x-repoA');
    await mkdir(project, { recursive: true });

    const lines = [
      JSON.stringify({ type: 'user', message: {} }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'u1',
        cwd: '/Users/x/repoA',
        gitBranch: 'main',
        sessionId: 's1',
        requestId: 'r1',
        timestamp: '2026-01-01T00:00:00Z',
        version: '2.1.170',
        isSidechain: true,
        message: {
          model: 'claude-opus-4-8',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 10,
            cache_creation_input_tokens: 20,
            cache_creation: { ephemeral_5m_input_tokens: 20, ephemeral_1h_input_tokens: 0 },
          },
        },
      }),
      // Same request re-recorded (resumed transcript) — preserves requestId,
      // so it must be skipped; the first occurrence wins.
      JSON.stringify({
        type: 'assistant',
        uuid: 'u1',
        requestId: 'r1',
        cwd: '/Users/x/repoA',
        message: { model: 'claude-opus-4-8', usage: { input_tokens: 1 } },
      }),
    ];
    await writeFile(join(project, 'a.jsonl'), lines.join('\n'), 'utf8');

    const events = await scanTranscripts(root);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e?.repo).toBe('repoA');
    expect(e?.repoPath).toBe('/Users/x/repoA');
    expect(e?.branch).toBe('main');
    expect(e?.model).toBe('claude-opus-4-8');
    expect(e?.usage.inputTokens).toBe(100);
    expect(e?.usage.outputTokens).toBe(50);
    expect(e?.usage.cacheReadTokens).toBe(10);
    expect(e?.usage.cacheWrite5mTokens).toBe(20);
    expect(e?.isSidechain).toBe(true);
  });

  it('collapses content-block lines sharing a requestId into one billable run', async () => {
    // Claude Code writes one transcript line per content block of an assistant
    // turn (each text / tool_use block), and every line repeats the SAME
    // message-level usage. They share one requestId but get distinct uuids.
    // The billable unit is the request, so these must count once — not N times.
    const root = await mkdtemp(join(tmpdir(), 'obolus-'));
    const project = join(root, 'proj');
    await mkdir(project, { recursive: true });

    const usage = {
      input_tokens: 200,
      output_tokens: 80,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 300,
    };
    const blockLine = (uuid: string, timestamp: string): string =>
      JSON.stringify({
        type: 'assistant',
        uuid,
        cwd: '/Users/x/repoA',
        gitBranch: 'main',
        sessionId: 's1',
        requestId: 'req_SHARED',
        timestamp,
        message: { model: 'claude-opus-4-8', usage },
      });
    const lines = [
      blockLine('block-a', '2026-02-01T00:00:01Z'),
      blockLine('block-b', '2026-02-01T00:00:02Z'),
      blockLine('block-c', '2026-02-01T00:00:05Z'),
    ];
    await writeFile(join(project, 'turn.jsonl'), lines.join('\n'), 'utf8');

    const events = await scanTranscripts(root);
    expect(events).toHaveLength(1);
    expect(events[0]?.requestId).toBe('req_SHARED');
    // The single counted run carries the full (un-multiplied) usage.
    expect(events[0]?.usage.outputTokens).toBe(80);
  });

  it('treats detached HEAD as no branch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obolus-'));
    const project = join(root, 'proj');
    await mkdir(project, { recursive: true });
    await writeFile(
      join(project, 'b.jsonl'),
      JSON.stringify({
        type: 'assistant',
        uuid: 'x',
        cwd: '/r/y',
        gitBranch: 'HEAD',
        message: { model: 'm', usage: { input_tokens: 1 } },
      }),
      'utf8',
    );
    const events = await scanTranscripts(root);
    expect(events[0]?.branch).toBeNull();
  });

  it('returns empty for a missing root', async () => {
    const events = await scanTranscripts('/no/such/dir/obolus-test');
    expect(events).toEqual([]);
  });
});
