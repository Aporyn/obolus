import type { PricingTable } from '../domain/types.js';
import type { GroupTotals, ScanSummary } from './aggregate.js';

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

function row(g: GroupTotals): string {
  const flag = g.hasUnpriced ? '  ⚠ unpriced' : g.hasEstimated ? '  ~ est.' : '';
  return `  ${pad(g.key, 26)} ${fmtUsd(g.costUsd).padStart(10)}  ${fmtTokens(g.totalTokens).padStart(8)}  ${String(g.runs).padStart(5)} runs${flag}`;
}

/** Render a scan summary as a plain-text terminal report (no color dependency). */
export function renderSummary(s: ScanSummary, table: PricingTable): string {
  const lines: string[] = [];
  lines.push('Obolus — local AI coding-agent spend (Claude Code)');
  lines.push('');
  lines.push(
    `  Runs ${s.totalRuns.toLocaleString()}   Tokens ${fmtTokens(s.totalTokens)}   Est. cost ${fmtUsd(s.totalCostUsd)}`,
  );

  lines.push('');
  lines.push('By repo:');
  for (const g of s.byRepo) lines.push(row(g));

  lines.push('');
  lines.push('By model:');
  for (const g of s.byModel) lines.push(row(g));

  lines.push('');
  if (s.unpricedModels.length > 0) {
    lines.push(
      `⚠ No pricing for: ${s.unpricedModels.join(', ')} — add rates in pricing-table.ts (cost shown as $0 for these).`,
    );
  }
  if (s.estimatedModels.length > 0) {
    lines.push(`~ Estimated (unverified) rates for: ${s.estimatedModels.join(', ')}`);
  }
  lines.push(
    `Cost = tokens × local rate table (asOf ${table.asOf}). An estimate, not your actual bill.`,
  );
  return lines.join('\n');
}
