#!/usr/bin/env node
import { runProjectContextCli } from './context/project-integrity.js';
import { runSessionContextCli } from './context/session-context.js';
import { runHarnessCli } from './harness/cli.js';
import { runLearningLifecycleCli } from './learning/lifecycle-cli.js';
import { runSkillCli } from './skills/cli.js';
import { runProviderLifecycleCli } from './providers/lifecycle-cli.js';
import { runSupervisorCli } from './supervisor/cli.js';
import { resolveMajorMcpCwd, runMajorMcpServer } from './mcp/server.js';

try {
  const args = process.argv.slice(2);
  if (args[0] === 'mcp') {
    if (args[1] !== 'serve') throw new Error('usage: major mcp serve');
    const mcpArgs = args.slice(2);
    await runMajorMcpServer(resolveMajorMcpCwd(mcpArgs));
  } else {
    const projectContextHandled = await runProjectContextCli(args);
    if (!projectContextHandled) {
      const sessionContextHandled = await runSessionContextCli(args);
      if (!sessionContextHandled) {
        const learningLifecycleHandled = await runLearningLifecycleCli(args);
        if (!learningLifecycleHandled) {
          const skillHandled = await runSkillCli(args);
          if (!skillHandled) {
            const harnessHandled = await runHarnessCli(args);
            if (!harnessHandled) {
              const providerHandled = await runProviderLifecycleCli(args);
              if (!providerHandled) {
                const handled = await runSupervisorCli(args);
                if (!handled) await import('./cli/index.js');
              }
            }
          }
        }
      }
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
