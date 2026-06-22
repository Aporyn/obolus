#!/usr/bin/env node
import { runCli } from './cli.js';

runCli(process.argv.slice(2)).catch((err: unknown) => {
  console.error('obolus:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
