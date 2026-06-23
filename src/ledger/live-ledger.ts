import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { obolusHome } from '../collector/paths.js';

/** One run captured live, enriched with the commit checked out at run time. */
export interface LiveRecord {
  /** Stable run id (matches RunEvent.id) for an exact join onto scanned runs. Optional on legacy lines. */
  readonly id?: string;
  readonly ts: string;
  readonly repo: string;
  readonly repoPath: string;
  readonly branch: string | null;
  readonly commit: string | null;
  readonly model: string;
  readonly sessionId: string;
  readonly costUsd: number;
  readonly tokens: number;
  readonly isSidechain: boolean;
}

const LIVE_LEDGER_FILE = 'live-ledger.jsonl';

/** Append a live run record (metadata only) to the local append-only ledger. */
export async function appendLiveRecord(record: LiveRecord): Promise<string> {
  const dir = obolusHome();
  await mkdir(dir, { recursive: true });
  const path = join(dir, LIVE_LEDGER_FILE);
  await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');
  return path;
}

/**
 * Read all live records from the local ledger (metadata only). Returns an empty
 * array when the ledger does not exist yet. Malformed lines are skipped.
 */
export async function readLiveRecords(): Promise<LiveRecord[]> {
  const path = join(obolusHome(), LIVE_LEDGER_FILE);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  const records: LiveRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      records.push(JSON.parse(line) as LiveRecord);
    } catch {
      /* skip malformed line */
    }
  }
  return records;
}
