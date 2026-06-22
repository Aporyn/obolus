import type { PricingTable } from '../domain/types.js';
import type { GroupTotals, ScanSummary, SessionTotals } from './aggregate.js';

export type GroupDimension = 'repo' | 'model' | 'branch';

export interface RenderOptions {
  readonly by: GroupDimension;
  readonly top: number;
  readonly since: string | null;
  readonly repo: string | null;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function pad(s: string, width: number): string {
  if (s.length > width) return `${s.slice(0, width - 1)}…`;
  return s.padEnd(width);
}

function day(iso: string): string {
  return iso ? iso.slice(0, 10) : '—';
}

function groupFor(summary: ScanSummary, by: GroupDimension): readonly GroupTotals[] {
  if (by === 'model') return summary.byModel;
  if (by === 'branch') return summary.byBranch;
  return summary.byRepo;
}

function row(g: GroupTotals): string {
  const flag = g.hasUnpriced ? '  ⚠ unpriced' : g.hasEstimated ? '  ~ est.' : '';
  return `  ${pad(g.key, 26)} ${fmtUsd(g.costUsd).padStart(10)}  ${fmtTokens(g.totalTokens).padStart(8)}  ${String(g.runs).padStart(5)} runs${flag}`;
}

function sessionRow(s: SessionTotals): string {
  const where = s.branch ? `${s.repo}/${s.branch}` : s.repo;
  const span = s.firstSeen ? `${day(s.firstSeen)}→${day(s.lastSeen)}` : '—';
  return `  ${pad(where, 24)} ${fmtUsd(s.costUsd).padStart(10)}  ${fmtTokens(s.totalTokens).padStart(8)}  ${String(s.runs).padStart(4)}r  ${span}  ${s.key.slice(0, 8)}`;
}

/** Render a scan summary as a plain-text terminal report (no color dependency). */
export function renderSummary(
  summary: ScanSummary,
  table: PricingTable,
  opts: RenderOptions,
): string {
  const lines: string[] = [];
  lines.push('Obolus — local AI coding-agent spend (Claude Code)');

  const scope: string[] = [];
  if (opts.since) scope.push(`since ${day(opts.since)}`);
  if (opts.repo) scope.push(`repo ${opts.repo}`);
  if (scope.length > 0) lines.push(`  scope: ${scope.join(', ')}`);
  lines.push('');

  if (summary.totalRuns === 0) {
    lines.push('  No runs match this scope.');
    return lines.join('\n');
  }

  lines.push(
    `  Runs ${summary.totalRuns.toLocaleString()}   Tokens ${fmtTokens(summary.totalTokens)}   Est. cost ${fmtUsd(summary.totalCostUsd)}`,
  );

  lines.push('');
  lines.push(`By ${opts.by}:`);
  for (const g of groupFor(summary, opts.by).slice(0, opts.top)) lines.push(row(g));

  lines.push('');
  lines.push('Top sessions by cost:');
  for (const s of summary.sessions.slice(0, opts.top)) lines.push(sessionRow(s));

  lines.push('');
  if (summary.unpricedModels.length > 0) {
    lines.push(
      `⚠ No pricing for: ${summary.unpricedModels.join(', ')} — add rates in pricing-table.ts (cost shown as $0 for these).`,
    );
  }
  if (summary.estimatedModels.length > 0) {
    lines.push(`~ Estimated (unverified) rates for: ${summary.estimatedModels.join(', ')}`);
  }
  lines.push(
    `Cost = tokens × local rate table (asOf ${table.asOf}). An estimate, not your actual bill.`,
  );
  return lines.join('\n');
}
