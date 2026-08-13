import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkAdoptionRecordFile } from './adoption.js';

export async function runReuseCli(args: string[]): Promise<boolean> {
  if (args[0] !== 'reuse') return false;
  if (args[1] !== 'check') return false;
  const record = args[2];
  if (!record) throw new Error('usage: major reuse check <adoption-record.md>');
  const path = resolve(record);
  if (!existsSync(path)) throw new Error(`adoption record not found: ${path}`);
  const result = checkAdoptionRecordFile(path);
  if (args.includes('--json')) console.log(JSON.stringify({ path, ...result }, null, 2));
  else if (result.valid) console.log(`valid adoption record: ${path}`);
  if (!result.valid) {
    const problems = [
      result.missingSections.length ? `missing: ${result.missingSections.join(', ')}` : '',
      result.emptySections.length ? `empty or placeholder: ${result.emptySections.join(', ')}` : '',
      result.missingSearchLayers.length
        ? `missing or unevaluated search layers: ${result.missingSearchLayers.join(', ')}`
        : '',
      result.evidenceInsufficient ? 'evidence must cite a concrete source or verification' : '',
      result.customBuildGapMissing
        ? 'custom build requires an explicit unmet requirement in Why'
        : '',
    ].filter(Boolean);
    throw new Error(`invalid adoption record (${problems.join('; ')})`);
  }
  return true;
}
