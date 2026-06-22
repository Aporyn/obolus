import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { obolusHome } from '../collector/paths.js';
import type { RunEvent } from '../domain/types.js';
import type { ScanSummary } from '../report/aggregate.js';

const LEDGER_SCHEMA_VERSION = 1;

/**
 * Persist the scan result to the local Obolus ledger (metadata only).
 * Returns the absolute path written.
 */
export async function writeLedger(
  events: readonly RunEvent[],
  summary: ScanSummary,
  generatedAt: string = new Date().toISOString(),
): Promise<string> {
  const dir = obolusHome();
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'ledger.json');
  const payload = {
    schema: LEDGER_SCHEMA_VERSION,
    generatedAt,
    source: 'claude-code',
    summary,
    events,
  };
  await writeFile(path, JSON.stringify(payload, null, 2), 'utf8');
  return path;
}
