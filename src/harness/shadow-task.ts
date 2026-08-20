import { CURRENT_HARNESS_MIGRATION_PHASE, DEFAULT_EXECUTION_BACKEND } from './composition.js';
import { DEEPSEEK_HARNESS_PIN } from './pin.js';

export interface HarnessShadowTask {
  phase: typeof CURRENT_HARNESS_MIGRATION_PHASE;
  executionHost: typeof DEFAULT_EXECUTION_BACKEND;
  liveTrafficRemains: 'lima-cli-acp';
  optInDefault: false;
  ready: false;
  pinVersion: string;
  attestedCommit: string;
  smoke: {
    purpose: 'prove-composed-profiles';
    command: string;
  };
  representativeProjectTask: {
    purpose: 'one-real-project-run-inside-lima';
    blockedUntil: string;
  };
}

/** Planned first Lima-hosted dsh smoke. Does not switch live Major workers. */
export function buildHarnessShadowTask(): HarnessShadowTask {
  const commit = DEEPSEEK_HARNESS_PIN.git.attestedCommit;
  if (!commit) {
    throw new Error('DeepSeek Harness pin is not attested; shadow tasks are forbidden');
  }
  return {
    phase: CURRENT_HARNESS_MIGRATION_PHASE,
    executionHost: DEFAULT_EXECUTION_BACKEND,
    liveTrafficRemains: 'lima-cli-acp',
    optInDefault: false,
    ready: false,
    pinVersion: DEEPSEEK_HARNESS_PIN.npm.version,
    attestedCommit: commit,
    smoke: {
      purpose: 'prove-composed-profiles',
      command:
        'DSH_HOME="${MAJOR_DSH_HOME:-$MAJOR_HOME/dsh-harness}" ' +
        '"$DSH_HOME/runtime/node_modules/.bin/dsh" --profile major-workstation-headless --dump-config',
    },
    representativeProjectTask: {
      purpose: 'one-real-project-run-inside-lima',
      blockedUntil:
        'isolated pin install plus independent review; live workers stay on Lima + official CLI/ACP',
    },
  };
}

export function formatHarnessShadowTask(task: HarnessShadowTask): string {
  return [
    `phase: ${task.phase}`,
    `execution host: ${task.executionHost}`,
    `live traffic: ${task.liveTrafficRemains}`,
    `opt-in default: ${task.optInDefault}`,
    `ready: ${task.ready}`,
    `smoke: ${task.smoke.command}`,
    `representative task blocked until: ${task.representativeProjectTask.blockedUntil}`,
  ].join('\n');
}
