import { userInfo } from 'node:os';
import { join } from 'node:path';

/** OS-account anchored roots. Vitest substitutes a fixture implementation. */
export function trustedAccountHome(_env: NodeJS.ProcessEnv = process.env): string {
  return userInfo().homedir;
}

export function trustedMajorHome(_env: NodeJS.ProcessEnv = process.env): string {
  return join(trustedAccountHome(), '.major');
}

export function trustedCodexHome(_env: NodeJS.ProcessEnv = process.env): string {
  return join(trustedAccountHome(), '.codex');
}

/** Production has no environment-controlled fixture paths or fault injection. */
export function testFixturePath(_name: string): string | undefined {
  return undefined;
}
