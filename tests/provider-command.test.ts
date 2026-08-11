import { describe, expect, it, vi } from 'vitest';
import { ClaudeCodeProvider } from '../src/providers/claude-code.js';
import { CodexProvider } from '../src/providers/codex.js';
import { cursorProvider } from '../src/providers/cursor.js';
import type { ExecutionGateway, GatewayExecuteRequest } from '../src/security/gateway.js';

function capturingGateway() {
  const requests: GatewayExecuteRequest[] = [];
  const gateway = {
    execute: vi.fn((request: GatewayExecuteRequest) => {
      requests.push(request);
      throw new Error('captured');
    }),
  } as unknown as ExecutionGateway;
  return { gateway, requests };
}

describe('provider command authority', () => {
  it('never asks Cursor to force-approve tools', () => {
    const { gateway, requests } = capturingGateway();
    const provider = cursorProvider({ gateway });
    expect(() => provider.execute({ prompt: 'work', cwd: '/project' })).toThrow('captured');
    expect(requests[0]?.args).toEqual(
      expect.arrayContaining(['--auto-review', '--sandbox', 'enabled']),
    );
    expect(requests[0]?.args).not.toContain('--force');
    expect(requests[0]?.args).not.toContain('--yolo');
  });

  it('pins Claude auto permissions and disables ambient customizations', () => {
    const { gateway, requests } = capturingGateway();
    const provider = new ClaudeCodeProvider({ gateway });
    expect(() => provider.execute({ prompt: 'work', cwd: '/project' })).toThrow('captured');
    expect(requests[0]?.args).toEqual(
      expect.arrayContaining([
        '--permission-mode',
        'auto',
        '--safe-mode',
        '--no-session-persistence',
        '--no-chrome',
      ]),
    );
    expect(requests[0]?.args).not.toContain('bypassPermissions');
  });

  it('pins Codex workspace sandboxing and ignores ambient user execution policy', () => {
    const { gateway, requests } = capturingGateway();
    const provider = new CodexProvider({ gateway });
    expect(() => provider.execute({ prompt: 'work', cwd: '/project' })).toThrow('captured');
    expect(requests[0]?.args).toEqual(
      expect.arrayContaining([
        '--sandbox',
        'workspace-write',
        '--ignore-user-config',
        '--ephemeral',
      ]),
    );
    expect(requests[0]?.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  it('uses the provider default for the stable Codex auto alias', () => {
    const { gateway, requests } = capturingGateway();
    const provider = new CodexProvider({ gateway });
    expect(() => provider.execute({ prompt: 'work', cwd: '/project', modelRef: 'auto' })).toThrow(
      'captured',
    );
    expect(requests[0]?.args).not.toContain('--model');
  });
});
