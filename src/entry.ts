#!/usr/bin/env node
import { runProjectContextCli } from './context/project-integrity.js';
import { runSessionContextCli } from './context/session-context.js';
import { runDesignCli } from './design/cli.js';
import { runLearningLifecycleCli } from './learning/lifecycle-cli.js';
import { runReuseCli } from './reuse/cli.js';
import { runSkillCli } from './skills/cli.js';
import { runProviderLifecycleCli } from './providers/lifecycle-cli.js';
import { runSupervisorCli } from './supervisor/cli.js';

try {
  const args = process.argv.slice(2);
  const projectContextHandled = await runProjectContextCli(args);
  if (!projectContextHandled) {
    const sessionContextHandled = await runSessionContextCli(args);
    if (!sessionContextHandled) {
      const learningLifecycleHandled = await runLearningLifecycleCli(args);
      if (!learningLifecycleHandled) {
        const designHandled = await runDesignCli(args);
        if (!designHandled) {
          const reuseHandled = await runReuseCli(args);
          if (!reuseHandled) {
            const skillHandled = await runSkillCli(args);
            if (!skillHandled) {
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
