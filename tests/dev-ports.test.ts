import { createServer, type Server } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allocateDevPort, listDevPorts } from '../src/dev/ports.js';

let root = '';
let priorPath: string | undefined;
let priorStart: string | undefined;
let priorEnd: string | undefined;
let blockers: Server[] = [];

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'major-dev-port-'));
  priorPath = process.env.MAJOR_DEV_PORT_PATH;
  priorStart = process.env.MAJOR_DEV_PORT_START;
  priorEnd = process.env.MAJOR_DEV_PORT_END;
  process.env.MAJOR_DEV_PORT_PATH = join(root, 'ports.json');
  const start = await freePort();
  process.env.MAJOR_DEV_PORT_START = String(start);
  process.env.MAJOR_DEV_PORT_END = String(start + 20);
  blockers = [];
});

afterEach(async () => {
  for (const server of blockers) {
    if (server.listening) {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  }
  if (priorPath === undefined) delete process.env.MAJOR_DEV_PORT_PATH;
  else process.env.MAJOR_DEV_PORT_PATH = priorPath;
  if (priorStart === undefined) delete process.env.MAJOR_DEV_PORT_START;
  else process.env.MAJOR_DEV_PORT_START = priorStart;
  if (priorEnd === undefined) delete process.env.MAJOR_DEV_PORT_END;
  else process.env.MAJOR_DEV_PORT_END = priorEnd;
  rmSync(root, { recursive: true, force: true });
});

describe('Major dev-port allocator', () => {
  it('assigns stable distinct per-project ports and never falls back to 3000/3001', async () => {
    const bredge = await allocateDevPort({ project: 'bredge', repoPath: '/tmp/bredge' });
    const bredgeAgain = await allocateDevPort({ project: 'bredge', repoPath: '/tmp/bredge' });
    const jss = await allocateDevPort({ project: 'jss-tool', repoPath: '/tmp/jss-tool' });

    expect(bredgeAgain.port).toBe(bredge.port);
    expect(jss.port).not.toBe(bredge.port);
    expect([3000, 3001]).not.toContain(bredge.port);
    expect(listDevPorts()).toHaveLength(2);
  });

  it('skips an occupied port on first allocation', async () => {
    const blocked = Number(process.env.MAJOR_DEV_PORT_START);
    const server = createServer();
    blockers.push(server);
    await new Promise<void>((resolveListen) => server.listen(blocked, '127.0.0.1', resolveListen));

    const assignment = await allocateDevPort({ project: 'surface-talent', repoPath: '/tmp/st' });
    expect(assignment.port).not.toBe(blocked);
  });

  it('can reassign a project without taking another project reserved port', async () => {
    const first = await allocateDevPort({ project: 'bredge', repoPath: '/tmp/bredge' });
    const second = await allocateDevPort({ project: 'jss-tool', repoPath: '/tmp/jss-tool' });
    const reassigned = await allocateDevPort({
      project: 'bredge',
      repoPath: '/tmp/bredge',
      reassign: true,
    });

    expect(reassigned.port).not.toBe(first.port);
    expect(reassigned.port).not.toBe(second.port);
  });
});
