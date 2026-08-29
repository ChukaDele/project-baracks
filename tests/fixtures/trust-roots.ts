import { userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Test-only replacement; this file is outside src and is never emitted into dist. */
export function trustedMajorHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.MAJOR_HOME ?? join(userInfo().homedir, '.major'));
}

export function trustedAccountHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.MAJOR_HOME ? dirname(trustedMajorHome(env)) : resolve(env.HOME ?? userInfo().homedir);
}

export function trustedCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.MAJOR_HOME
    ? join(trustedAccountHome(env), '.codex')
    : resolve(env.CODEX_HOME ?? join(trustedAccountHome(env), '.codex'));
}

export function testFixturePath(name: string): string | undefined {
  return process.env[name];
}
