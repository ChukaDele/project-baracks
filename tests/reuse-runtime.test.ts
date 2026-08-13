import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');

describe('reuse-first provider runtime', () => {
  it('uses the official ACP SDK and Cursor native ACP command only', () => {
    const runtime = source('src/execution/cursor-acp-runtime.ts');
    expect(runtime).toContain("from '@agentclientprotocol/sdk'");
    expect(runtime).toContain("'acp'");
    expect(runtime).toContain("guestProviderProfile('cursor-agent')");
    expect(runtime).toContain('acp.PROTOCOL_VERSION');
    expect(runtime).not.toContain('cursor-agent-acp');
    expect(source('src/providers/commands.ts')).toContain("return ['acp']");
    expect(source('src/providers/commands.ts')).not.toContain("'--auto-review'");
  });

  it('denies ACP permissions unless Major authorised guest mutation', () => {
    const runtime = source('src/execution/cursor-acp-runtime.ts');
    expect(runtime).toContain('if (!request.allowGuestMutation)');
    expect(runtime).toContain('decideProviderAction');
    expect(runtime).toContain("decision.outcome !== 'automatic'");
    expect(runtime).toContain("option.kind === 'allow_once'");
    expect(runtime).not.toContain("option.kind === 'allow_always'");
  });

  it('keeps Claude, Codex and Antigravity on their confined official CLI contracts', () => {
    const commands = source('src/providers/commands.ts');
    expect(commands).toContain("'--safe-mode'");
    expect(commands).toContain("'read-only'");
    expect(commands).toContain("'--sandbox'");
    expect(commands).not.toContain('danger-full-access');
    expect(source('package.json')).not.toContain('@ai-sdk/harness');
  });

  it('requires structured Cursor intent and a hard VM stop until ACP exits cleanly', () => {
    const backend = source('src/execution/lima-backend.ts');
    expect(backend).toContain('requires a structured Major provider request');
    expect(backend).toContain('this.forceStopRequired = true');
    expect(backend).toContain(
      'await this.stop(this.forceStopRequired || this.cancelled || cleanupError !== undefined)',
    );
  });

  it('never returns raw provider account output from authentication probes', () => {
    const backend = source('src/execution/lima-backend.ts');
    expect(backend).toContain('detail: !installed');
    expect(backend).not.toContain('detail: redactText(output)');
  });
});
