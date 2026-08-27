import { describe, expect, it } from 'vitest';
import { createMajorUiServer, startMajorUi } from '../src/ui/server.js';

describe('thin Major UI', () => {
  it('constructs the local-only control surface', () => {
    const server = createMajorUiServer(process.cwd());
    expect(server).toBeDefined();
    expect(typeof server.listeners('request')[0]).toBe('function');
  });

  it('refuses non-local binds and invalid ports before opening a listener', async () => {
    await expect(startMajorUi({ host: '0.0.0.0', port: 0 })).rejects.toThrow(
      /only binds to the local machine/,
    );
    await expect(startMajorUi({ host: '127.0.0.1', port: 65_536 })).rejects.toThrow(
      /port must be an integer/,
    );
  });
});
