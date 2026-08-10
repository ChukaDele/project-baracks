#!/usr/bin/env node
import { runProjectContextCli } from './context/project-integrity.js';
import { runSupervisorCli } from './supervisor/cli.js';

try {
  const args = process.argv.slice(2);
  const contextHandled = await runProjectContextCli(args);
  if (!contextHandled) {
    const handled = await runSupervisorCli(args);
    if (!handled) await import('./cli/index.js');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
