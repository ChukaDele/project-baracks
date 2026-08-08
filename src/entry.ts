#!/usr/bin/env node
import { runSupervisorCli } from './supervisor/cli.js';

try {
  const handled = await runSupervisorCli(process.argv.slice(2));
  if (!handled) await import('./cli/index.js');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
