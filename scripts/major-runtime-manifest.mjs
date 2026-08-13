#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const [mode, rawRoot] = process.argv.slice(2);
if (!['create', 'verify'].includes(mode) || !rawRoot) {
  console.error('usage: major-runtime-manifest.mjs <create|verify> <runtime-root>');
  process.exit(2);
}
const root = resolve(rawRoot);
const manifestPath = join(root, 'runtime-manifest.json');

function entries(directory = root) {
  const result = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const item = lstatSync(path);
    const pathname = relative(root, path).split(sep).join('/');
    if (pathname === 'runtime-manifest.json') continue;
    const permissions = item.mode & 0o777;
    if (item.isDirectory()) {
      result.push(...entries(path));
    } else if (item.isSymbolicLink()) {
      const target = readlinkSync(path);
      const resolvedTarget = resolve(directory, target);
      const outside = relative(root, resolvedTarget);
      if (isAbsolute(target) || outside === '..' || outside.startsWith(`..${sep}`)) {
        throw new Error(`runtime symlink escapes snapshot: ${pathname} -> ${target}`);
      }
      result.push({ path: pathname, type: 'symlink', mode: permissions, target });
    } else if (item.isFile()) {
      result.push({
        path: pathname,
        type: 'file',
        mode: permissions,
        sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      });
    } else {
      throw new Error(`unsupported runtime entry: ${pathname}`);
    }
  }
  return result;
}

const current = { version: 1, entries: entries() };
if (mode === 'create') {
  writeFileSync(manifestPath, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o444 });
} else {
  const expected = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (JSON.stringify(expected) !== JSON.stringify(current)) {
    throw new Error('runtime content manifest mismatch');
  }
}
