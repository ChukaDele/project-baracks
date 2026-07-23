import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/logging/logger.js';
import { checkCommand } from '../src/security/commands.js';
import { assertWithinRoots, isWithinRoots, PathViolationError } from '../src/security/paths.js';
import { redactText, redactValue } from '../src/security/redact.js';

describe('secret redaction', () => {
  it('redacts common token formats', () => {
    const text = [
      'github: ghp_abcdefghijklmnopqrstuvwxyz123456',
      'api: sk-ant-abc123def456ghi789jkl',
      'aws: AKIAIOSFODNN7EXAMPLE',
      'google: AIzaSyA-1234567890abcdefghijklmnopqrs',
    ].join('\n');
    const redacted = redactText(text);
    expect(redacted).not.toContain('ghp_');
    expect(redacted).not.toContain('sk-ant');
    expect(redacted).not.toContain('AKIA');
    expect(redacted).not.toContain('AIza');
  });

  it('redacts key/value style secrets but keeps the key visible', () => {
    const redacted = redactText('password=hunter2 api_key: abc123 token="xyz"');
    expect(redacted).toContain('password=[REDACTED]');
    expect(redacted).not.toContain('hunter2');
    expect(redacted).not.toContain('abc123');
  });

  it('redacts private key blocks', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----';
    expect(redactText(pem)).toBe('[REDACTED]');
  });

  it('keeps JSON parseable when redacting objects', () => {
    const value = redactValue({ config: { password: 'topsecret', host: 'db.local' } });
    expect(value.config.host).toBe('db.local');
    expect(value.config.password).not.toContain('topsecret');
  });

  it('structurally removes COMPLETE values under sensitive keys, whatever their shape', () => {
    const value = redactValue({
      apiKey: 'multi word secret value',
      auth: { user: 'u', pass: 'p', hosts: ['a', 'b'] },
      tokens: ['one two', 'three four'],
      plain: 'kept',
    });
    const serialised = JSON.stringify(value);
    for (const fragment of ['multi word', 'secret value', '"u"', '"p"', 'one two', 'three four']) {
      expect(serialised).not.toContain(fragment);
    }
    expect(value.plain).toBe('kept');
  });

  it('redacts quoted multi-word values in free text without breaking JSON', () => {
    const line = JSON.stringify({ msg: 'x', secret: 'alpha beta gamma' });
    const redacted = redactText(line);
    expect(redacted).not.toContain('alpha beta');
    expect(() => JSON.parse(redacted) as unknown).not.toThrow();
  });
});

describe('structured JSON logs', () => {
  it('emits one JSON line per record with redaction applied', () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (l) => lines.push(l) });
    logger.info('starting run', { token: 'ghp_abcdefghijklmnopqrstuvwxyz123456' });
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!) as Record<string, string>;
    expect(record.level).toBe('info');
    expect(record.msg).toBe('starting run');
    expect(lines[0]).not.toContain('ghp_abcdef');
  });

  it('child loggers inherit bindings', () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (l) => lines.push(l) }).child({ runId: 'arun_1' });
    logger.warn('slow');
    expect(JSON.parse(lines[0]!)).toMatchObject({ runId: 'arun_1', level: 'warn' });
  });
});

describe('path guards', () => {
  it('accepts paths inside a configured root and rejects escapes', () => {
    expect(isWithinRoots('/tmp/proj/src/a.ts', ['/tmp/proj'])).toBe(true);
    expect(isWithinRoots('/tmp/proj', ['/tmp/proj'])).toBe(true);
    expect(isWithinRoots('/tmp/proj/../other', ['/tmp/proj'])).toBe(false);
    expect(isWithinRoots('/etc/passwd', ['/tmp/proj'])).toBe(false);
    expect(() => assertWithinRoots('/etc', ['/tmp/proj'])).toThrow(PathViolationError);
  });
});

describe('command policy', () => {
  it('prohibits force pushes and direct pushes to protected branches', () => {
    expect(checkCommand('git push --force origin feature').allowed).toBe(false);
    expect(checkCommand('git push origin main').allowed).toBe(false);
    expect(checkCommand('git push origin feature-branch').allowed).toBe(true);
  });

  it('prohibits destructive database and filesystem commands', () => {
    expect(checkCommand('sqlite3 app.db "DROP TABLE users"').allowed).toBe(false);
    expect(checkCommand('rm -rf /').allowed).toBe(false);
  });

  it('applies project-configured prohibitions and allowlists', () => {
    expect(
      checkCommand('docker system prune', { prohibitedPatterns: ['docker\\s+system\\s+prune'] })
        .allowed,
    ).toBe(false);
    expect(checkCommand('curl http://x', { allowedExecutables: ['git', 'pnpm'] }).allowed).toBe(
      false,
    );
    expect(checkCommand('pnpm test', { allowedExecutables: ['git', 'pnpm'] }).allowed).toBe(true);
  });
});
