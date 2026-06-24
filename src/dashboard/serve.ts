import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { claudeProjectsDir, codexSessionsDir } from '../collector/paths.js';
import { scanAllWithMeta, type ScanRoots } from '../collector/scan-all.js';
import { tailAll } from '../collector/tail-all.js';
import { defaultGitHistory } from '../collector/git-history.js';
import { readLiveRecords } from '../ledger/live-ledger.js';
import { defaultPricingFor } from '../pricing/registry.js';
import { summarizeByVendor } from '../report/aggregate.js';
import { filterEvents } from '../report/filter.js';
import { parseSince } from '../report/timeframe.js';
import { resolveAttribution } from '../report/commit-resolution.js';
import { DASHBOARD_HTML } from './html.js';

const DEFAULT_PORT = 4317;

export interface ServeOptions {
  readonly port?: number;
  readonly open?: boolean;
  /** Claude Code projects root (defaults to ~/.claude/projects). */
  readonly root?: string;
  /** Codex sessions root (defaults to ~/.codex/sessions). */
  readonly codexRoot?: string;
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  try {
    execFile(command, [url], () => {
      /* best-effort; ignore failures */
    });
  } catch {
    /* ignore */
  }
}

async function sendSummary(res: ServerResponse, roots: ScanRoots, reqUrl: string): Promise<void> {
  try {
    const sinceRaw = new URL(reqUrl, 'http://localhost').searchParams.get('since');
    const since = sinceRaw ? parseSince(sinceRaw) : null;
    const { events: allEvents, rateLimits } = await scanAllWithMeta(roots);
    const events = since ? filterEvents(allEvents, { since }) : allEvents;
    const attribution = resolveAttribution(events, await readLiveRecords(), defaultGitHistory);
    const summary = summarizeByVendor(events, defaultPricingFor, { attribution, rateLimits });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(summary));
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}

function sendEvents(req: IncomingMessage, res: ServerResponse, roots: ScanRoots): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  let runningUsd = 0;
  let runningRuns = 0;
  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  void tailAll(
    roots,
    (run) => {
      runningUsd += run.cost.totalUsd;
      runningRuns += 1;
      const payload = {
        vendor: run.event.vendor,
        repo: run.event.repo,
        branch: run.event.branch,
        commit: run.commit,
        model: run.event.model,
        costUsd: run.cost.totalUsd,
        tokens: run.tokens,
        timestamp: run.event.timestamp,
        isSidechain: run.event.isSidechain,
        runningUsd,
        runningRuns,
      };
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    },
    () => closed,
  );
}

/** Build the local dashboard HTTP server (not yet listening). */
export function createDashboardServer(
  root: string = claudeProjectsDir(),
  codexRoot: string = codexSessionsDir(),
): Server {
  const roots: ScanRoots = { claude: root, codex: codexRoot };
  return createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/' || url.startsWith('/index')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(DASHBOARD_HTML);
      return;
    }
    if (url.startsWith('/api/summary')) {
      void sendSummary(res, roots, url);
      return;
    }
    if (url.startsWith('/api/events')) {
      sendEvents(req, res, roots);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });
}

/**
 * Machine-readable readiness line for parent processes (e.g. the macOS app) that spawn
 * `obolus serve` on an ephemeral port and need to discover the bound URL from stdout.
 */
export function readyLine(port: number): string {
  return JSON.stringify({ obolusServe: 'ready', url: `http://127.0.0.1:${port}`, port });
}

/**
 * Start the local-only dashboard server. Binds to 127.0.0.1 — data never leaves the machine.
 * Pass `port: 0` for an ephemeral port. Returns the listening server so callers can close it.
 */
export async function runServe(opts: ServeOptions = {}): Promise<Server> {
  const root = opts.root ?? claudeProjectsDir();
  const codexRoot = opts.codexRoot ?? codexSessionsDir();
  const port = opts.port ?? DEFAULT_PORT;
  const server = createDashboardServer(root, codexRoot);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : port;
  const url = `http://localhost:${boundPort}`;
  console.log(`Obolus dashboard — ${url}`);
  console.log('Local only (127.0.0.1) · metadata stays on this machine · Ctrl+C to stop');
  // Opt-in: emit a single parseable readiness line for a managing parent process.
  if (process.env.OBOLUS_SERVE_READY_JSON === '1') console.log(readyLine(boundPort));
  if (opts.open) openBrowser(url);
  return server;
}
