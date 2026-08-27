import { describe, expect, it } from 'vitest';
import { handleMajorMcpRequest } from '../src/mcp/server.js';

describe('Major MCP server', () => {
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
    expect((result?.result as { tools: unknown[] }).tools).toHaveLength(2);
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
