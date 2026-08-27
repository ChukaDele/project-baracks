import { describe, expect, it, vi } from 'vitest';
import { ClaudeCodeProvider } from '../src/providers/claude-code.js';
import { CodexProvider } from '../src/providers/codex.js';
import { providerWorkshopArgs } from '../src/providers/commands.js';
import { cursorProvider } from '../src/providers/cursor.js';
import { antigravityProvider } from '../src/providers/antigravity.js';
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
  it('routes Cursor through native ACP with typed provider intent', () => {
    const { gateway, requests } = capturingGateway();
    const provider = cursorProvider({ gateway });
    expect(() => provider.execute({ prompt: 'work', cwd: '/project' })).toThrow('captured');
    expect(requests[0]?.args).toEqual(['acp']);
    expect(requests[0]?.providerRequest).toEqual({
      host: 'cursor',
      prompt: 'work',
      allowGuestMutation: true,
      approvalAuthority: { decisions: [] },
    });
  });

  it('pins Claude auto permissions and disables ambient customizations', () => {
    const { gateway, requests } = capturingGateway();
    const provider = new ClaudeCodeProvider({ gateway });
    expect(() => provider.execute({ prompt: 'work', cwd: '/project' })).toThrow('captured');
    expect(requests[0]?.args).toEqual(
      expect.arrayContaining([
        '--permission-mode',
        'auto',
        '--tools',
        'Read,Edit,Glob,Grep',
        '--safe-mode',
        '--no-session-persistence',
        '--no-chrome',
      ]),
    );
    expect(requests[0]?.args).not.toContain('bypassPermissions');
  });

  it('pins Codex read-only sandboxing and ignores ambient user execution policy', () => {
    const { gateway, requests } = capturingGateway();
    const provider = new CodexProvider({ gateway });
    const priorPath = process.env.MAJOR_EXECUTION_PATH;
    try {
      process.env.MAJOR_EXECUTION_PATH = 'lima';
      expect(() => provider.execute({ prompt: 'work', cwd: '/project' })).toThrow('captured');
      expect(requests[0]?.args).toEqual(
        expect.arrayContaining(['--sandbox', 'read-only', '--ignore-user-config', '--ephemeral']),
      );
    } finally {
      if (priorPath === undefined) delete process.env.MAJOR_EXECUTION_PATH;
      else process.env.MAJOR_EXECUTION_PATH = priorPath;
    }
    expect(requests[0]?.args).not.toContain('code_mode_host');
    expect(requests[0]?.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  it('persists fresh host Codex sessions inside Major-owned state', () => {
    const { gateway, requests } = capturingGateway();
    const provider = new CodexProvider({ gateway });
    const priorPath = process.env.MAJOR_EXECUTION_PATH;
    try {
      process.env.MAJOR_EXECUTION_PATH = 'host';
      expect(() => provider.execute({ prompt: 'work', cwd: '/project' })).toThrow('captured');
      expect(requests[0]?.args).toEqual(
        expect.arrayContaining(['--sandbox', 'read-only', '--ignore-user-config']),
      );
      expect(requests[0]?.args).not.toContain('--ephemeral');
    } finally {
      if (priorPath === undefined) delete process.env.MAJOR_EXECUTION_PATH;
      else process.env.MAJOR_EXECUTION_PATH = priorPath;
    }
  });

  it('uses the provider default for the stable Codex auto alias', () => {
    const { gateway, requests } = capturingGateway();
    const provider = new CodexProvider({ gateway });
    expect(() => provider.execute({ prompt: 'work', cwd: '/project', modelRef: 'auto' })).toThrow(
      'captured',
    );
    expect(requests[0]?.args).not.toContain('--model');
  });

  it('disables only Codex inner sandboxing after Workshop admission', () => {
    const args = ['exec', '--sandbox', 'read-only', '--ignore-user-config', '--ephemeral'];
    const priorPath = process.env.MAJOR_EXECUTION_PATH;
    try {
      process.env.MAJOR_EXECUTION_PATH = 'host';
      expect(providerWorkshopArgs('codex', args)).toEqual([
        'exec',
        '--sandbox',
        'danger-full-access',
        '--ignore-user-config',
        '--ephemeral',
      ]);
      process.env.MAJOR_EXECUTION_PATH = 'lima';
      expect(providerWorkshopArgs('codex', args)).toEqual([
        'exec',
        '--sandbox',
        'danger-full-access',
        '--ignore-user-config',
        '--ephemeral',
      ]);
    } finally {
      if (priorPath === undefined) delete process.env.MAJOR_EXECUTION_PATH;
      else process.env.MAJOR_EXECUTION_PATH = priorPath;
    }
    expect(providerWorkshopArgs('codex', args)).not.toContain(
      '--dangerously-bypass-approvals-and-sandbox',
    );
    expect(providerWorkshopArgs('claude', ['--safe-mode'])).toEqual(['--safe-mode']);
  });

  it('routes Antigravity through the same gateway with sandboxing enabled', () => {
    const { gateway, requests } = capturingGateway();
    const provider = antigravityProvider({ gateway });
    expect(() => provider.execute({ prompt: 'work', cwd: '/project' })).toThrow('captured');
    expect(requests[0]).toMatchObject({ executable: 'agy', cwd: '/project' });
    expect(requests[0]?.args).toEqual(
      expect.arrayContaining([
        '--sandbox',
        '--disable-slash-commands',
        '--mode',
        'plan',
        '--new-project',
      ]),
    );
    expect(requests[0]?.args).not.toContain('--dangerously-skip-permissions');
  });
});
