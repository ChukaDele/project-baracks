import { describe, expect, it } from 'vitest';
import { planHumanBlocker } from '../src/supervisor/human-blocker.js';

describe('human blocker orchestration', () => {
  it('keeps independent work running while OAuth is waiting', () => {
    const decision = planHumanBlocker({
      project: 'chuka-personal-site',
      action: 'GitHub authentication is waiting in the Codex browser.',
      independentWork: ['refine typography', 'run unit checks'],
      expectedAuthUrl: 'https://github.com/login',
      visibleBrowser: { activeUrl: 'https://github.com/login', rendered: true },
    });
    expect(decision.state).toBe('PARTIALLY_BLOCKED');
    expect(decision.notification?.title).toBe('Major — Action required');
    expect(decision.browser?.status).toBe('ATTACHED');
    expect(decision.continuedWork).toEqual(['refine typography', 'run unit checks']);
  });

  it('resumes the dependent integration after OAuth resolves', () => {
    const decision = planHumanBlocker({
      project: 'chuka-personal-site',
      action: 'Cloudflare Git integration',
      independentWork: ['run unit checks'],
      resolved: true,
    });
    expect(decision.state).toBe('RESUMING');
    expect(decision.resumeDependentWork).toBe(true);
  });

  it('fails the visible-browser assertion when a hidden session differs from the in-app tab', () => {
    const decision = planHumanBlocker({
      project: 'chuka-personal-site',
      action: 'GitHub authentication',
      independentWork: ['refine copy'],
      expectedAuthUrl: 'https://github.com/login',
      visibleBrowser: { activeUrl: 'http://localhost:3101', rendered: true },
    });
    expect(decision.browser?.status).toBe('BROWSER_ATTACHMENT_FAILURE');
    expect(decision.browser?.message).toContain('BROWSER ATTACHMENT FAILURE');
  });

  it('fully blocks only when no useful work remains', () => {
    const decision = planHumanBlocker({
      project: 'chuka-personal-site',
      action: 'Approve an irreversible domain transfer.',
      independentWork: [],
    });
    expect(decision.state).toBe('FULLY_BLOCKED');
    expect(decision.notification?.message).toContain('Approve an irreversible domain transfer');
  });
});
