// Embed src/dashboard/dashboard.html into src/dashboard/html.ts as a base64
// string so the dashboard ships inside dist/ with no extra package files and no
// runtime file lookups. base64 avoids any quoting/escaping conflicts with the
// HTML's own inline <script>/<style>. Runs before tsc (see package.json build).
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const htmlPath = new URL('../src/dashboard/dashboard.html', import.meta.url);
const tsPath = new URL('../src/dashboard/html.ts', import.meta.url);

if (!existsSync(htmlPath)) {
  console.log('[embed] src/dashboard/dashboard.html not found; keeping existing html.ts');
  process.exit(0);
}

const html = await readFile(htmlPath, 'utf8');
const base64 = Buffer.from(html, 'utf8').toString('base64');
const ts = `// AUTO-GENERATED from src/dashboard/dashboard.html by scripts/embed-dashboard.mjs.
// Do not edit by hand — edit dashboard.html and rebuild.
export const DASHBOARD_HTML = Buffer.from(
  '${base64}',
  'base64',
).toString('utf8');
`;
await writeFile(tsPath, ts, 'utf8');
console.log(`[embed] embedded ${html.length} bytes of dashboard HTML into html.ts`);
