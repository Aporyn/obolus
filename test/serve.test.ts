import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createDashboardServer } from '../src/dashboard/serve.js';

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
});
