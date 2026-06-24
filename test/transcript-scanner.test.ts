import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanTranscripts } from '../src/collector/transcript-scanner.js';
import { summarize } from '../src/report/aggregate.js';
import { ANTHROPIC_PRICING } from '../src/pricing/pricing-table.js';

/** Build one assistant transcript line (metadata only — token counts, no content). */
function assistantLine(o: {
  uuid?: string;
  requestId?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  isSidechain?: boolean;
  model?: string;
  timestamp?: string;
  usage: Record<string, unknown>;
}): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: o.uuid ?? 'u',
    requestId: o.requestId,
    cwd: o.cwd ?? '/Users/x/repoA',
    gitBranch: o.gitBranch ?? 'main',
    sessionId: o.sessionId ?? 's1',
    timestamp: o.timestamp ?? '2026-06-23T20:00:00Z',
    isSidechain: o.isSidechain ?? false,
    message: { model: o.model ?? 'claude-opus-4-8', usage: o.usage },
  });
}

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

  it('reads server_tool_use request counts (web search / fetch) onto the event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obolus-'));
    const project = join(root, 'proj');
    await mkdir(project, { recursive: true });
    await writeFile(
      join(project, 'srv.jsonl'),
      `${assistantLine({
        requestId: 'r-srv',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          server_tool_use: { web_search_requests: 3, web_fetch_requests: 2 },
        },
      })}\n`,
      'utf8',
    );
    const events = await scanTranscripts(root);
    expect(events[0]?.serverTools.webSearchRequests).toBe(3);
    expect(events[0]?.serverTools.webFetchRequests).toBe(2);
  });

  it('defaults server-tool counts to zero when the field is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obolus-'));
    const project = join(root, 'proj');
    await mkdir(project, { recursive: true });
    await writeFile(
      join(project, 'plain.jsonl'),
      `${assistantLine({ requestId: 'r-plain', usage: { input_tokens: 10 } })}\n`,
      'utf8',
    );
    const events = await scanTranscripts(root);
    expect(events[0]?.serverTools).toEqual({ webSearchRequests: 0, webFetchRequests: 0 });
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

describe('scanTranscripts — nested subagent transcripts', () => {
  // Claude Code nests subagent transcripts under
  // <projectDir>/<sessionId>/subagents/**/agent-*.jsonl. The scanner must recurse
  // into that tree, otherwise all subagent spend is silently dropped.
  it('recurses into <project>/<sessionId>/subagents/** and de-dups across files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obolus-sub-'));
    const project = join(root, '-Users-x-repoA');
    await mkdir(project, { recursive: true });

    // main-thread transcript at the top level
    await writeFile(
      join(project, 's1.jsonl'),
      `${assistantLine({ uuid: 'm1', requestId: 'req-main', isSidechain: false, usage: { input_tokens: 1000, output_tokens: 200 } })}\n`,
      'utf8',
    );

    // two subagent transcripts nested several dirs deep
    const wfA = join(project, 's1', 'subagents', 'workflows', 'wf_a');
    const wfB = join(project, 's1', 'subagents', 'workflows', 'wf_b');
    await mkdir(wfA, { recursive: true });
    await mkdir(wfB, { recursive: true });
    await writeFile(
      join(wfA, 'agent-1.jsonl'),
      `${assistantLine({ uuid: 'a1', requestId: 'req-a1', isSidechain: true, usage: { input_tokens: 500 } })}\n`,
      'utf8',
    );
    await writeFile(
      join(wfB, 'agent-2.jsonl'),
      // second run + a line that repeats req-a1 (must be counted once, not twice)
      `${[
        assistantLine({ uuid: 'a2', requestId: 'req-a2', isSidechain: true, usage: { input_tokens: 700 } }),
        assistantLine({ uuid: 'a2b', requestId: 'req-a1', isSidechain: true, usage: { input_tokens: 999 } }),
      ].join('\n')}\n`,
      'utf8',
    );

    const events = await scanTranscripts(root);
    // main + req-a1 + req-a2 = 3 (duplicate req-a1 dropped)
    expect(events).toHaveLength(3);
    const subs = events.filter((e) => e.isSidechain);
    expect(subs).toHaveLength(2);
    expect(subs.every((e) => e.repo === 'repoA' && e.branch === 'main')).toBe(true);
    expect(events.some((e) => !e.isSidechain && e.requestId === 'req-main')).toBe(true);
  });

  it("counts the previously-missed subagent spend in totals and byKind (2026-06-23 incident)", async () => {
    // Real aggregate from the deep-research incident (session ef1f55b7…), metadata
    // only — token counts, no prompt/code. Before the recursion fix this entire
    // subagent workload was invisible; Obolus reported only the main thread.
    const root = await mkdtemp(join(tmpdir(), 'obolus-sub-'));
    const project = join(root, '-Users-x-obolus');
    await mkdir(project, { recursive: true });

    await writeFile(
      join(project, 's.jsonl'),
      `${assistantLine({
        uuid: 'main',
        requestId: 'rm',
        cwd: '/Users/x/obolus',
        isSidechain: false,
        usage: {
          input_tokens: 42064,
          output_tokens: 74039,
          cache_read_input_tokens: 500000,
          cache_creation: { ephemeral_5m_input_tokens: 100000, ephemeral_1h_input_tokens: 0 },
        },
      })}\n`,
      'utf8',
    );

    // The 107 subagents collapsed into one summed line carrying the real incident totals.
    const wf = join(project, 's', 'subagents', 'workflows', 'wf');
    await mkdir(wf, { recursive: true });
    await writeFile(
      join(wf, 'agent-1.jsonl'),
      `${assistantLine({
        uuid: 'sa',
        requestId: 'rsa',
        cwd: '/Users/x/obolus',
        isSidechain: true,
        usage: {
          input_tokens: 2241525,
          output_tokens: 32158,
          cache_read_input_tokens: 28289533,
          cache_creation: { ephemeral_5m_input_tokens: 5702972, ephemeral_1h_input_tokens: 0 },
        },
      })}\n`,
      'utf8',
    );

    const summary = summarize(await scanTranscripts(root), ANTHROPIC_PRICING);
    const sub = summary.byKind.find((k) => k.key === 'subagent');
    const main = summary.byKind.find((k) => k.key === 'main');
    expect(sub).toBeDefined();
    expect(main).toBeDefined();
    // the spend that used to vanish entirely (opus-4-8: 2.2415M*5 + .0322M*25 + 28.29M*0.5 + 5.703M*6.25)
    expect(sub?.totalTokens).toBe(36_266_188);
    expect(sub?.costUsd).toBeCloseTo(61.8, 2);
    // totals are internally consistent and dominated by the previously-missed subagent spend
    expect(summary.totalCostUsd).toBeCloseTo((main?.costUsd ?? 0) + (sub?.costUsd ?? 0), 6);
    expect((sub?.costUsd ?? 0) / summary.totalCostUsd).toBeGreaterThan(0.9);
  });
});
