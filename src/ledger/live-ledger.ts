import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { obolusHome } from '../collector/paths.js';

/** One run captured live, enriched with the commit checked out at run time. */
export interface LiveRecord {
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
