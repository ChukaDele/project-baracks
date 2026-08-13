import { existsSync } from 'node:fs';
import { dirname, parse, resolve } from 'node:path';
import { checkDesignDirectionRecordFile } from './direction.js';

export async function runDesignCli(args: string[]): Promise<boolean> {
  if (args[0] !== 'design') return false;
  if (args[1] !== 'check') return false;
  const record = args[2];
  if (!record) throw new Error('usage: major design check <direction-decision.md>');
  const path = resolve(record);
  if (!existsSync(path)) throw new Error(`design direction record not found: ${path}`);
  let projectRoot = resolve(process.cwd());
  const filesystemRoot = parse(projectRoot).root;
  while (!existsSync(resolve(projectRoot, '.git')) && projectRoot !== filesystemRoot) {
    projectRoot = dirname(projectRoot);
  }
  if (!existsSync(resolve(projectRoot, '.git'))) {
    throw new Error('current directory is not inside a Git project');
  }
  const result = checkDesignDirectionRecordFile(path, projectRoot);
  if (args.includes('--json')) console.log(JSON.stringify({ path, ...result }, null, 2));
  else if (result.valid) console.log(`approved design direction: ${path}`);
  if (!result.valid) {
    const problems = [
      result.missingFields.length ? `missing: ${result.missingFields.join(', ')}` : '',
      result.invalidFields.length ? `invalid or pending: ${result.invalidFields.join(', ')}` : '',
      result.missingArtifacts.length
        ? `missing artifacts: ${result.missingArtifacts.join(', ')}`
        : '',
      result.escapedArtifacts.length
        ? `outside/symlink artifacts: ${result.escapedArtifacts.join(', ')}`
        : '',
    ].filter(Boolean);
    throw new Error(`design direction is not approved (${problems.join('; ')})`);
  }
  return true;
}
