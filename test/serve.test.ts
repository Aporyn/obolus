import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createDashboardServer, runServe, readyLine } from '../src/dashboard/serve.js';

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'obolus-serve-'));
  const project = join(root, 'proj');
  await mkdir(project, { recursive: true });
  await writeFile(
    join(project, 'a.jsonl'),
    `${JSON.stringify({
      type: 'assistant',
      uuid: 'u1',
      cwd: '/x/repoA',
      gitBranch: 'main',
      sessionId: 's1',
      timestamp: '2026-06-01T00:00:00Z',
      message: { model: 'claude-opus-4-8', usage: { input_tokens: 1000, output_tokens: 500 } },
    })}\n`,
    'utf8',
  );
  return root;
}

/** A fresh empty dir — used to isolate the Codex root so tests don't read ~/.codex. */
async function emptyDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'obolus-empty-'));
}

/** A Codex sessions root with one rollout (one token_count + a rate-limit snapshot). */
async function codexFixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'obolus-codex-'));
  const day = join(root, '2026', '06', '24');
  await mkdir(day, { recursive: true });
  const lines = [
    JSON.stringify({ timestamp: '2026-06-24T10:00:00Z', type: 'session_meta', payload: { session_id: 's-cx', cwd: '/x/repoB', git: { branch: 'dev' }, cli_version: '0.142.0' } }),
    JSON.stringify({ timestamp: '2026-06-24T10:00:00Z', type: 'turn_context', payload: { model: 'gpt-5.5' } }),
    JSON.stringify({ timestamp: '2026-06-24T10:00:01Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 2000, cached_input_tokens: 500, output_tokens: 300, total_tokens: 2300 } }, rate_limits: { primary: { used_percent: 62, window_minutes: 300, resets_at: 1_780_000_000 }, secondary: { used_percent: 40, window_minutes: 10080 }, plan_type: 'team' } } }),
  ];
  await writeFile(join(day, 'rollout-x.jsonl'), `${lines.join('\n')}\n`, 'utf8');
  return root;
}

describe('dashboard server', () => {
  it('serves the summary JSON and the dashboard HTML, 404s elsewhere', async () => {
    const root = await fixtureRoot();
    const server = createDashboardServer(root, await emptyDir());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    try {
      const summary = await fetch(`${base}/api/summary`).then((r) => r.json());
      expect(summary.totalRuns).toBe(1);
      expect(summary.byRepo[0]?.key).toBe('repoA');
      expect(summary.totalCostUsd).toBeGreaterThan(0);

      const htmlRes = await fetch(`${base}/`);
      expect(htmlRes.headers.get('content-type')).toContain('text/html');
      expect((await htmlRes.text()).toLowerCase()).toContain('<!doctype html');

      const missing = await fetch(`${base}/nope`);
      expect(missing.status).toBe(404);
    } finally {
      server.close();
    }
  });

  it('filters the summary by ?since= cutoff', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obolus-serve-since-'));
    const project = join(root, 'proj');
    await mkdir(project, { recursive: true });
    const rec = (ts: string, sid: string) =>
      JSON.stringify({
        type: 'assistant',
        uuid: sid,
        cwd: '/x/repoA',
        gitBranch: 'main',
        sessionId: sid,
        timestamp: ts,
        message: { model: 'claude-opus-4-8', usage: { input_tokens: 1000, output_tokens: 500 } },
      });
    await writeFile(
      join(project, 'a.jsonl'),
      `${rec('2026-06-01T00:00:00Z', 's-old')}\n${rec('2026-06-20T00:00:00Z', 's-new')}\n`,
      'utf8',
    );
    const server = createDashboardServer(root, await emptyDir());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    try {
      const all = await fetch(`${base}/api/summary`).then((r) => r.json());
      expect(all.totalRuns).toBe(2);

      const since = await fetch(`${base}/api/summary?since=2026-06-15`).then((r) => r.json());
      expect(since.totalRuns).toBe(1);
      expect(since.totalCostUsd).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });

  it('exposes a per-vendor breakdown with a Codex rate-limit snapshot', async () => {
    const server = createDashboardServer(await fixtureRoot(), await codexFixtureRoot());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const summary = await fetch(`http://127.0.0.1:${port}/api/summary`).then((r) => r.json());
      // Combined spans both vendors (1 Claude run + 1 Codex run).
      expect(summary.totalRuns).toBe(2);
      expect(Array.isArray(summary.vendors)).toBe(true);

      const cc = summary.vendors.find((v: { vendor: string }) => v.vendor === 'claude-code');
      const cx = summary.vendors.find((v: { vendor: string }) => v.vendor === 'codex');
      expect(cc?.summary.totalRuns).toBe(1);
      expect(cx?.summary.totalRuns).toBe(1);
      expect(cx?.summary.byRepo[0]?.key).toBe('repoB');

      // Claude Code has no rate-limit telemetry; Codex carries the 5h + weekly snapshot.
      expect(cc?.rateLimit).toBeNull();
      expect(cx?.rateLimit?.primary?.windowMinutes).toBe(300);
      expect(cx?.rateLimit?.secondary?.windowMinutes).toBe(10080);
      expect(cx?.rateLimit?.planType).toBe('team');
    } finally {
      server.close();
    }
  });

  it('readyLine emits a parseable JSON readiness record', () => {
    const parsed = JSON.parse(readyLine(54321));
    expect(parsed).toEqual({
      obolusServe: 'ready',
      url: 'http://127.0.0.1:54321',
      port: 54321,
    });
  });

  it('runServe binds an ephemeral port and prints the ready line when opted in', async () => {
    const root = await fixtureRoot();
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    const prev = process.env.OBOLUS_SERVE_READY_JSON;
    process.env.OBOLUS_SERVE_READY_JSON = '1';
    const server = await runServe({ port: 0, root, codexRoot: await emptyDir() });
    try {
      const { port } = server.address() as AddressInfo;
      expect(port).toBeGreaterThan(0);

      const ready = logs.map((l) => l.trim()).find((l) => l.includes('"obolusServe"'));
      expect(ready).toBeDefined();
      const parsed = JSON.parse(ready as string);
      expect(parsed.obolusServe).toBe('ready');
      expect(parsed.port).toBe(port);
      expect(parsed.url).toBe(`http://127.0.0.1:${port}`);

      const summary = await fetch(`${parsed.url}/api/summary`).then((r) => r.json());
      expect(summary.totalRuns).toBe(1);
    } finally {
      server.close();
      spy.mockRestore();
      if (prev === undefined) delete process.env.OBOLUS_SERVE_READY_JSON;
      else process.env.OBOLUS_SERVE_READY_JSON = prev;
    }
  });
});
