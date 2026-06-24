import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ScanSummary } from '../src/report/aggregate.js';

// Single source of truth for the `obolus serve` /api/summary wire shape. The Swift app
// decodes this exact file in apps/desktop/Tests/ObolusKitTests/SummaryContractTests.swift,
// so a rename/removal/retype on EITHER side's ScanSummary breaks a test until both the
// TS interface, the Swift Codable mirrors, and this golden agree again.
//
// Caveat (documented honestly): this pins the contract WITHIN a repo version. It does not
// guard the runtime case where the app talks to a *different* installed CLI version (npx
// fallback) — that needs a version stamp in the serve handshake, tracked separately.
const GOLDEN_PATH = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'summary-contract.golden.json');

// One nested per-vendor summary (Codex). Its own `vendors` is always [] — the
// per-vendor breakdown is exactly one level deep.
const CODEX_SUMMARY: ScanSummary = {
  totalRuns: 1,
  totalTokens: 600,
  totalCostUsd: 3.5,
  composition: { inputUsd: 0.5, outputUsd: 2.0, cacheReadUsd: 1.0, cacheWriteUsd: 0.0, serverToolUsd: 0.0 },
  unpricedModels: [],
  estimatedModels: ['gpt-5.5'],
  byRepo: [
    { key: 'obolus', runs: 1, inputTokens: 40, outputTokens: 80, cacheTokens: 480, totalTokens: 600, costUsd: 3.5, hasUnpriced: false, hasEstimated: true },
  ],
  byModel: [
    { key: 'gpt-5.5', runs: 1, inputTokens: 40, outputTokens: 80, cacheTokens: 480, totalTokens: 600, costUsd: 3.5, hasUnpriced: false, hasEstimated: true },
  ],
  byBranch: [
    { key: 'main', runs: 1, inputTokens: 40, outputTokens: 80, cacheTokens: 480, totalTokens: 600, costUsd: 3.5, hasUnpriced: false, hasEstimated: true },
  ],
  byDay: [
    { key: '2026-06-23', runs: 1, inputTokens: 40, outputTokens: 80, cacheTokens: 480, totalTokens: 600, costUsd: 3.5, hasUnpriced: false, hasEstimated: true },
  ],
  byWeek: [
    { key: '2026-W26', runs: 1, inputTokens: 40, outputTokens: 80, cacheTokens: 480, totalTokens: 600, costUsd: 3.5, hasUnpriced: false, hasEstimated: true },
  ],
  byKind: [
    { key: 'main', runs: 1, inputTokens: 40, outputTokens: 80, cacheTokens: 480, totalTokens: 600, costUsd: 3.5, hasUnpriced: false, hasEstimated: true },
  ],
  sessions: [
    { key: 'cx1', runs: 1, inputTokens: 40, outputTokens: 80, cacheTokens: 480, totalTokens: 600, costUsd: 3.5, hasUnpriced: false, hasEstimated: true, repo: 'obolus', branch: 'main', firstSeen: '2026-06-23T11:00:00Z', lastSeen: '2026-06-23T11:30:00Z' },
  ],
  topRuns: [
    { repo: 'obolus', branch: 'main', model: 'gpt-5.5', sessionId: 'cx1', timestamp: '2026-06-23T11:00:00Z', costUsd: 3.5, totalTokens: 600, isSidechain: false },
  ],
  byCommit: [],
  byRelease: [],
  vendors: [],
};

// Typed as ScanSummary on purpose: the compiler rejects this literal if the interface
// gains a required field, drops one, or renames one — forcing the fixture (and the golden,
// and the Swift mirror) to track every shape change instead of drifting silently.
const FIXTURE: ScanSummary = {
  totalRuns: 3,
  totalTokens: 1500,
  totalCostUsd: 12.5,
  composition: {
    inputUsd: 1.0,
    outputUsd: 2.0,
    cacheReadUsd: 4.0,
    cacheWriteUsd: 5.0,
    serverToolUsd: 0.5,
  },
  unpricedModels: [],
  estimatedModels: ['claude-fable-5'],
  byRepo: [
    { key: 'obolus', runs: 3, inputTokens: 100, outputTokens: 200, cacheTokens: 1200, totalTokens: 1500, costUsd: 12.5, hasUnpriced: false, hasEstimated: true },
  ],
  byModel: [
    { key: 'claude-opus-4-8', runs: 3, inputTokens: 100, outputTokens: 200, cacheTokens: 1200, totalTokens: 1500, costUsd: 12.5, hasUnpriced: false, hasEstimated: true },
  ],
  byBranch: [
    { key: 'main', runs: 3, inputTokens: 100, outputTokens: 200, cacheTokens: 1200, totalTokens: 1500, costUsd: 12.5, hasUnpriced: false, hasEstimated: true },
  ],
  byDay: [
    { key: '2026-06-23', runs: 2, inputTokens: 60, outputTokens: 120, cacheTokens: 720, totalTokens: 900, costUsd: 9.0, hasUnpriced: false, hasEstimated: false },
  ],
  byWeek: [
    { key: '2026-W26', runs: 3, inputTokens: 100, outputTokens: 200, cacheTokens: 1200, totalTokens: 1500, costUsd: 12.5, hasUnpriced: false, hasEstimated: true },
  ],
  byKind: [
    { key: 'main', runs: 2, inputTokens: 60, outputTokens: 120, cacheTokens: 720, totalTokens: 900, costUsd: 9.0, hasUnpriced: false, hasEstimated: false },
    { key: 'subagent', runs: 1, inputTokens: 40, outputTokens: 80, cacheTokens: 480, totalTokens: 600, costUsd: 3.5, hasUnpriced: false, hasEstimated: true },
  ],
  sessions: [
    { key: 's1', runs: 3, inputTokens: 100, outputTokens: 200, cacheTokens: 1200, totalTokens: 1500, costUsd: 12.5, hasUnpriced: false, hasEstimated: true, repo: 'obolus', branch: null, firstSeen: '2026-06-23T10:00:00Z', lastSeen: '2026-06-23T12:00:00Z' },
  ],
  topRuns: [
    { repo: 'obolus', branch: 'main', model: 'claude-opus-4-8', sessionId: 's1', timestamp: '2026-06-23T11:00:00Z', costUsd: 5.0, totalTokens: 700, isSidechain: false },
  ],
  byCommit: [
    { key: 'aaaaaaaa', runs: 2, inputTokens: 50, outputTokens: 100, cacheTokens: 750, totalTokens: 900, costUsd: 9.0, hasUnpriced: false, hasEstimated: false, subject: 'first commit', committedAt: '2026-06-23T10:00:00Z', release: 'v1', exactUsd: 4.0, estimatedUsd: 5.0 },
    { key: '(unattributed)', runs: 1, inputTokens: 40, outputTokens: 80, cacheTokens: 480, totalTokens: 600, costUsd: 3.5, hasUnpriced: false, hasEstimated: true, subject: '', committedAt: '', release: null, exactUsd: 0.0, estimatedUsd: 0.0 },
  ],
  byRelease: [
    { key: 'v1', runs: 2, inputTokens: 50, outputTokens: 100, cacheTokens: 750, totalTokens: 900, costUsd: 9.0, hasUnpriced: false, hasEstimated: false, firstCommitAt: '2026-06-23T10:00:00Z', lastCommitAt: '2026-06-23T10:00:00Z', commitCount: 1, exactUsd: 4.0, estimatedUsd: 5.0 },
  ],
  // Per-vendor breakdown. Claude Code has no rate-limit telemetry (null); Codex
  // carries a snapshot with both the 5h (primary) and weekly (secondary) windows.
  vendors: [
    {
      vendor: 'claude-code',
      rateLimit: null,
      summary: { ...CODEX_SUMMARY, estimatedModels: ['claude-fable-5'] },
    },
    {
      vendor: 'codex',
      rateLimit: {
        vendor: 'codex',
        capturedAt: '2026-06-23T11:30:00Z',
        primary: { usedPercent: 62.0, windowMinutes: 300, resetsAt: '2026-06-23T15:00:00Z' },
        secondary: { usedPercent: 40.0, windowMinutes: 10080, resetsAt: '2026-06-30T00:00:00Z' },
        planType: 'team',
      },
      summary: CODEX_SUMMARY,
    },
  ],
};

describe('serve /api/summary contract', () => {
  it('FIXTURE serializes to the committed golden (regenerate with UPDATE_GOLDEN=1)', () => {
    const serialized = `${JSON.stringify(FIXTURE, null, 2)}\n`;
    if (process.env.UPDATE_GOLDEN === '1') {
      writeFileSync(GOLDEN_PATH, serialized);
    }
    const golden = readFileSync(GOLDEN_PATH, 'utf8');
    expect(serialized).toEqual(golden);
  });

  it('exercises every ScanSummary dimension so the golden cannot silently drop one', () => {
    expect(FIXTURE.byRepo.length).toBeGreaterThan(0);
    expect(FIXTURE.byModel.length).toBeGreaterThan(0);
    expect(FIXTURE.byBranch.length).toBeGreaterThan(0);
    expect(FIXTURE.byDay.length).toBeGreaterThan(0);
    expect(FIXTURE.byWeek.length).toBeGreaterThan(0);
    expect(FIXTURE.byKind.length).toBeGreaterThan(0);
    expect(FIXTURE.sessions.length).toBeGreaterThan(0);
    expect(FIXTURE.topRuns.length).toBeGreaterThan(0);
    expect(FIXTURE.byCommit.length).toBeGreaterThan(0);
    expect(FIXTURE.byRelease.length).toBeGreaterThan(0);
    expect(FIXTURE.vendors.length).toBeGreaterThan(0);
  });

  it('carries a per-vendor breakdown with a Codex rate-limit snapshot', () => {
    const codex = FIXTURE.vendors.find((v) => v.vendor === 'codex');
    expect(codex?.summary.totalRuns).toBeGreaterThan(0);
    expect(codex?.rateLimit?.primary?.windowMinutes).toBe(300);
    expect(codex?.rateLimit?.secondary?.windowMinutes).toBe(10080);
    expect(codex?.rateLimit?.planType).toBe('team');
    // Claude Code reports no rate-limit telemetry.
    expect(FIXTURE.vendors.find((v) => v.vendor === 'claude-code')?.rateLimit).toBeNull();
    // The per-vendor summaries are one level deep.
    expect(codex?.summary.vendors).toEqual([]);
  });
});
