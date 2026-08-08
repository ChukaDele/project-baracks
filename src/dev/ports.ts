import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { majorHome } from '../supervisor/state.js';

export interface DevPortAssignment {
  project: string;
  repoPath: string;
  port: number;
  updatedAt: string;
}

interface DevPortStore {
  version: 1;
  assignments: DevPortAssignment[];
}

export function devPortPath(): string {
  return process.env.MAJOR_DEV_PORT_PATH
    ? resolve(process.env.MAJOR_DEV_PORT_PATH)
    : join(majorHome(), 'dev-ports.json');
}

function readStore(): DevPortStore {
  const path = devPortPath();
  if (!existsSync(path)) return { version: 1, assignments: [] };
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as DevPortStore;
  if (parsed.version !== 1 || !Array.isArray(parsed.assignments)) {
    throw new Error(`invalid Major dev-port store: ${path}`);
  }
  return parsed;
}

function writeStore(store: DevPortStore): void {
  const path = devPortPath();
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

function numericEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

async function portFree(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolveFree) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolveFree(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolveFree(true));
    });
  });
}

export async function allocateDevPort(input: {
  project: string;
  repoPath: string;
  reassign?: boolean;
}): Promise<DevPortAssignment> {
  const store = readStore();
  const existingIndex = store.assignments.findIndex(
    (candidate) => candidate.project === input.project,
  );
  const existing = existingIndex >= 0 ? store.assignments[existingIndex] : undefined;
  if (existing && !input.reassign) return existing;

  const start = numericEnv('MAJOR_DEV_PORT_START', 3100);
  const end = numericEnv('MAJOR_DEV_PORT_END', 3999);
  if (start > end) throw new Error('MAJOR_DEV_PORT_START must be <= MAJOR_DEV_PORT_END');

  const reserved = new Set(
    store.assignments
      .filter((candidate) => candidate.project !== input.project)
      .map((candidate) => candidate.port),
  );

  let selected: number | undefined;
  for (let port = start; port <= end; port += 1) {
    if (port === 3000 || port === 3001 || reserved.has(port)) continue;
    if (await portFree(port)) {
      selected = port;
      break;
    }
  }
  if (selected === undefined) {
    throw new Error(`no free Major dev port available in ${start}-${end}`);
  }

  const assignment: DevPortAssignment = {
    project: input.project,
    repoPath: resolve(input.repoPath),
    port: selected,
    updatedAt: new Date().toISOString(),
  };
  if (existingIndex >= 0) store.assignments[existingIndex] = assignment;
  else store.assignments.push(assignment);
  writeStore(store);
  return assignment;
}

export function listDevPorts(): DevPortAssignment[] {
  return readStore()
    .assignments.slice()
    .sort((a, b) => a.port - b.port);
}
