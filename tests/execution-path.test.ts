import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configuredExecutionPath,
  executionPathStatus,
  persistExecutionPath,
} from '../src/execution/path.js';

let root = '';
let priorMajorHome: string | undefined;
let priorExecutionPath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-execution-path-'));
  priorMajorHome = process.env.MAJOR_HOME;
  priorExecutionPath = process.env.MAJOR_EXECUTION_PATH;
  process.env.MAJOR_HOME = root;
  delete process.env.MAJOR_EXECUTION_PATH;
});

afterEach(() => {
  if (priorMajorHome === undefined) delete process.env.MAJOR_HOME;
  else process.env.MAJOR_HOME = priorMajorHome;
  if (priorExecutionPath === undefined) delete process.env.MAJOR_EXECUTION_PATH;
  else process.env.MAJOR_EXECUTION_PATH = priorExecutionPath;
  rmSync(root, { recursive: true, force: true });
});

describe('Major execution path selection', () => {
  it('defaults to the contained host path and persists an explicit compatibility choice', () => {
    expect(configuredExecutionPath()).toBe('host');
    expect(executionPathStatus()).toMatchObject({ path: 'host', source: 'default' });

    const persisted = persistExecutionPath('lima');
    expect(configuredExecutionPath()).toBe('lima');
    expect(executionPathStatus()).toMatchObject({
      path: 'lima',
      source: 'config',
      configPath: persisted.configPath,
    });
    expect(JSON.parse(readFileSync(persisted.configPath, 'utf8'))).toMatchObject({
      version: 1,
      path: 'lima',
    });
  });

  it('lets an explicit environment selection override persisted state without rewriting it', () => {
    persistExecutionPath('lima');
    process.env.MAJOR_EXECUTION_PATH = 'host';

    expect(configuredExecutionPath()).toBe('host');
    expect(executionPathStatus()).toMatchObject({ path: 'host', source: 'environment' });
    expect(JSON.parse(readFileSync(join(root, 'execution-path.json'), 'utf8')).path).toBe('lima');
  });

  it('rejects unsupported execution paths', () => {
    process.env.MAJOR_EXECUTION_PATH = 'dsh';
    expect(() => configuredExecutionPath()).toThrow(/expected host or lima/);
  });
});
