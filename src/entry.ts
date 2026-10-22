#!/usr/bin/env node
import { runProjectContextCli } from './context/project-integrity.js';
import { runSessionContextCli } from './context/session-context.js';
import { runHarnessCli } from './harness/cli.js';
import { runLearningLifecycleCli } from './learning/lifecycle-cli.js';
import { drainLearningQueue } from './learning/queue.js';
import { runKnowledgeCli } from './knowledge/cli.js';
import { runSkillCli } from './skills/cli.js';
import { runProviderLifecycleCli } from './providers/lifecycle-cli.js';
import { runShaperCli } from './observability/shaper-cli.js';
import { runSupervisorCli } from './supervisor/cli.js';
import { resolveMajorMcpCwd, runMajorMcpServer } from './mcp/server.js';

try {
  const args = process.argv.slice(2);
  if (args[0] === 'session' && (args[1] === 'attach' || args[1] === 'hook')) {
    // Replay learning queued by earlier runs. Silent and bounded: session
    // start output is parsed by hosts, and learning never blocks a session.
    try {
      drainLearningQueue(1_000);
    } catch {
      // The queue stays on disk for the next session.
    }
  }
  if (args[0] === 'mcp') {
    if (args[1] !== 'serve') throw new Error('usage: major mcp serve');
    const mcpArgs = args.slice(2);
    await runMajorMcpServer(resolveMajorMcpCwd(mcpArgs));
  } else {
    const projectContextHandled = await runProjectContextCli(args);
    if (!projectContextHandled) {
      const sessionContextHandled = await runSessionContextCli(args);
      if (!sessionContextHandled) {
        const knowledgeHandled = await runKnowledgeCli(args);
        if (!knowledgeHandled) {
          const learningLifecycleHandled = await runLearningLifecycleCli(args);
          if (!learningLifecycleHandled) {
            const skillHandled = await runSkillCli(args);
            if (!skillHandled) {
              const shaperHandled = await runShaperCli(args);
              if (!shaperHandled) {
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
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
