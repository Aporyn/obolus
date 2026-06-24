import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { takeCompleteLines, tailRuns } from '../src/collector/tailer.js';
import { currentCommit } from '../src/collector/git.js';

describe('takeCompleteLines', () => {
  it('returns complete lines and bytes consumed, holding back a partial tail', () => {
    const r = takeCompleteLines('a\nb\npartial');
    expect(r.lines).toEqual(['a', 'b']);
    expect(r.consumed).toBe(4); // 'a\nb\n'
  });

  it('returns nothing when there is no newline yet', () => {
    expect(takeCompleteLines('partial')).toEqual({ lines: [], consumed: 0 });
  });

  it('counts multibyte bytes correctly', () => {
    const r = takeCompleteLines('café\n');
    expect(r.lines).toEqual(['café']);
    expect(r.consumed).toBe(6); // 'café' = 5 bytes + '\n'
  });
});

describe('currentCommit', () => {
  it('returns a short sha for a git repo', () => {
    const sha = currentCommit(process.cwd());
    expect(sha === null || /^[0-9a-f]{7,}$/.test(sha)).toBe(true);
  });

  it('returns null for a path that is not a git repo', () => {
    expect(currentCommit('/')).toBeNull();
  });
});

describe('tailRuns — live subagent discovery', () => {
  it('captures a subagent run created in a nested subdir after start', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obolus-tail-'));
    const project = join(root, '-Users-x-repoA');
    await mkdir(project, { recursive: true });
    // an existing (empty) main transcript so startup seeds offsets, not the subagent file
    await writeFile(join(project, 'sess.jsonl'), '', 'utf8');

    const seen: string[] = [];
    let stop = false;
    const running = tailRuns(
      root,
      (run) => {
        seen.push(run.event.id);
      },
      () => stop,
      { pollMs: 5 },
    );

    // let the tailer seed offsets on the existing file before the subagent appears
    await new Promise((r) => setTimeout(r, 40));

    const wf = join(project, 'sess', 'subagents', 'workflows', 'wf1');
    await mkdir(wf, { recursive: true });
    await writeFile(
      join(wf, 'agent-1.jsonl'),
      `${JSON.stringify({
        type: 'assistant',
        uuid: 'sa1',
        requestId: 'req-sa1',
        cwd: '/Users/x/repoA',
        gitBranch: 'main',
        sessionId: 'sess',
        timestamp: '2026-06-23T20:00:00Z',
        isSidechain: true,
        message: { model: 'claude-opus-4-8', usage: { input_tokens: 100, output_tokens: 50 } },
      })}\n`,
      'utf8',
    );

    const deadline = Date.now() + 2000;
    while (seen.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    stop = true;
    await running;

    expect(seen).toContain('req-sa1');
  });
});
