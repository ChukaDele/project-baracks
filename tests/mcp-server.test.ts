import { describe, expect, it } from 'vitest';
import {
  handleMajorMcpRequest,
  resolveMajorMcpCwd,
  serializeLegacyContext,
} from '../src/mcp/server.js';
import { buildContextPack } from '../src/context/context-pack.js';
import type { MajorDashboard } from '../src/ui/dashboard.js';

describe('Major MCP server', () => {
  it('accepts an explicit client working directory without changing the default', () => {
    expect(resolveMajorMcpCwd([], '/Users/example/project')).toBe('/Users/example/project');
    expect(resolveMajorMcpCwd(['--cwd', '/Users/example/other'], '/Users/example/project')).toBe(
      '/Users/example/other',
    );
    expect(() => resolveMajorMcpCwd(['--cwd'], '/Users/example/project')).toThrow(
      'usage: major mcp serve [--cwd <repo>]',
    );
  });

  it('negotiates the standard MCP initialize request', async () => {
    const result = await handleMajorMcpRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      },
    });

    expect(result).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'major' },
      },
    });
  });

  it('exposes only the two bounded context tools', async () => {
    const result = await handleMajorMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(result?.result).toMatchObject({
      tools: [{ name: 'major_context' }, { name: 'major_ask' }],
    });
    const tools = (result?.result as { tools: { inputSchema: unknown }[] }).tools;
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({
      inputSchema: { properties: { detail: {}, sections: {}, maxBytes: {} } },
    });
  });

  it('progressively discloses evidence-labelled context within the requested byte budget', () => {
    const dashboard = {
      schema: 'major.dashboard.v1',
      generatedAt: '2026-08-28T12:00:00.000Z',
      project: { identity: 'github.com/chukadele/project-baracks', repoPath: '/repo' },
      objective: { id: 'g1', goal: 'Optimize Major', status: 'active', cycle: 1 },
      policy: null,
      gbrain: {
        status: 'active',
        projectBrainLoaded: true,
        retrievedMemoryCount: 1,
        sources: ['project'],
      },
      context: { memories: Array(20).fill('memory'), decisions: [], unresolvedQuestions: [] },
      workers: [],
      execution: {},
      resources: {},
      providers: [],
      hosts: [],
      skills: {
        selected: [{ id: 'verification', score: 9, reason: 'matched' }],
        internalReachable: 1,
        internalTotal: 1,
        duplicateIds: [],
        orphanInternalSkills: [],
      },
      learning: [],
      history: {},
      recentRuns: [],
    } as unknown as MajorDashboard;
    const pack = buildContextPack(dashboard, {
      detail: 'summary',
      sections: ['overview', 'skills', 'memory'],
      maxBytes: 2_000,
    });

    expect(pack.kind).toBe('major.context-pack.v2');
    expect(pack.disclosure.detail).toBe('summary');
    expect(Buffer.byteLength(JSON.stringify(pack), 'utf8')).toBeLessThanOrEqual(2_000);
    expect(pack.data).toHaveProperty('overview');
    expect(pack.evidence.skills?.[0]).toMatchObject({ qualification: 'derived' });
    expect((pack.data.memory as { context: { memories: string[] } }).context.memories).toHaveLength(
      3,
    );
  });

  it('preserves the v1 context serialization contract for zero-argument clients', () => {
    const dashboard = {
      project: { identity: 'fixture/project', repoPath: '/fixture' },
      objective: { id: 'goal-1', goal: 'Keep compatibility' },
      gbrain: { status: 'active' },
      context: { memories: [], decisions: [], unresolvedQuestions: [] },
      execution: { status: 'idle' },
      skills: { selected: [] },
      providers: [],
      workers: [],
      history: {
        runs: 3,
        timeSpent: 120,
        overhead: 10,
        bestWorker: 'worker-1',
        bestWorkerEvidence: 'fixture evidence',
        latestChange: 'kept v1 stable',
        repeatedFailures: [],
        skillPerformance: [],
        humanInterventions: 0,
        reuse: 1,
        recurrence: 0,
      },
      recentRuns: [{ id: 'run-1' }],
    } as unknown as MajorDashboard;
    const context = serializeLegacyContext(dashboard);

    expect(context).toMatchObject({ schemaVersion: 1, kind: 'major.context.v1' });
    expect(context).toHaveProperty('project');
    expect(context.history).toMatchObject({ runs: 3, recentRuns: [{ id: 'run-1' }] });
    expect(context).not.toHaveProperty('disclosure');
  });

  it('returns a protocol error for unknown methods', async () => {
    const result = await handleMajorMcpRequest({
      jsonrpc: '2.0',
      id: 'x',
      method: 'unknown/method',
    });
    expect(result).toEqual({
      jsonrpc: '2.0',
      id: 'x',
      error: { code: -32601, message: 'method not found: unknown/method' },
    });
  });

  it('does not answer initialized notifications', async () => {
    await expect(
      handleMajorMcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    ).resolves.toBeUndefined();
  });
});
