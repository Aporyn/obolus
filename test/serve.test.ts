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

describe('dashboard server', () => {
  it('serves the summary JSON and the dashboard HTML, 404s elsewhere', async () => {
    const root = await fixtureRoot();
    const server = createDashboardServer(root);
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
    const server = createDashboardServer(root);
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
    const server = await runServe({ port: 0, root });
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
