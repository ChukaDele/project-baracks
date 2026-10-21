import { describe, expect, it } from 'vitest';
import { providerArgs } from '../src/providers/commands.js';
import type { ProviderInfo } from '../src/providers/types.js';
import { effortFor, route } from '../src/routing/router.js';
import {
  selectCoordinator,
  STRONGEST_ROUTING_REQUEST,
  taskRoutingRequest,
} from '../src/supervisor/runtime.js';
import type { SupervisorGoal } from '../src/supervisor/state.js';
import type { SupervisorAdmissionRiskAssessment } from '../src/supervisor/worker-report.js';
import { model } from './helpers.js';

const FLEET: ProviderInfo[] = [
  {
    name: 'claude-code',
    installed: true,
    authenticated: true,
    models: ['fable', 'opus', 'sonnet'].map((ref) =>
      model({ modelRef: ref, routingClass: ref as 'fable' | 'opus' | 'sonnet' }),
    ),
  },
  {
    name: 'codex',
    installed: true,
    authenticated: true,
    models: [model({ modelRef: 'gpt-codex', routingClass: 'codex' })],
  },
];

function goal(
  classification?: SupervisorAdmissionRiskAssessment['classification'],
  risk: SupervisorAdmissionRiskAssessment['risk'] = {},
): SupervisorGoal {
  return {
    id: 'goal-1',
    project: 'demo',
    repoPath: '/tmp/demo',
    goal: 'demo goal',
    autonomous: false,
    status: 'active',
    preferredCoordinator: 'claude',
    cycle: 0,
    consecutiveFailures: 0,
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:00.000Z',
    ...(classification
      ? {
          admissionRiskAssessment: {
            source: 'major_outcome_policy_v1',
            classification,
            estimatedFiles: 1,
            acceptancePaths: 1,
            risk,
            materialRiskCriteria: [],
          },
        }
      : {}),
  };
}

describe('task class -> routing class and effort', () => {
  it.each([
    ['bounded', {}, 'sonnet', 'low'],
    ['substantive', {}, 'opus', 'medium'],
    ['high_consequence', { touchesPersistence: true }, 'fable', 'high'],
    ['high_consequence', { touchesSecurity: true }, 'fable', 'high'],
    ['unavailable', {}, 'fable', 'high'],
    [undefined, {}, 'fable', 'high'],
  ] as const)('%s %j -> %s at %s effort', (classification, risk, cls, effort) => {
    const selection = selectCoordinator(goal(classification, risk), FLEET);
    expect(selection).toMatchObject({ kind: 'route', modelRef: cls, effort });
  });

  it('marks security work as security_sensitive', () => {
    expect(taskRoutingRequest(goal('high_consequence', { touchesSecurity: true }))).toMatchObject({
      riskLevel: 'security_sensitive',
    });
  });

  it('escalates a failing cheap task to a stronger class and effort', () => {
    const failing = { ...goal('bounded'), consecutiveFailures: 2 };
    // Work-failure rotation may also move it to another provider; the target still escalates.
    const selection = selectCoordinator(failing, FLEET);
    expect(selection).toMatchObject({ kind: 'route', effort: 'medium' });
    expect(selection.reason).toContain('target=opus');
  });

  it('falls down the existing ladder when the class is unavailable', () => {
    const noSonnet: ProviderInfo[] = [
      { ...FLEET[0]!, models: FLEET[0]!.models.filter((m) => m.routingClass !== 'sonnet') },
      FLEET[1]!,
    ];
    expect(selectCoordinator(goal('bounded'), noSonnet)).toMatchObject({
      provider: 'codex',
      effort: 'low',
    });
  });

  it('lets a cheap task use fable when it is the only capacity left', () => {
    const fableOnly: ProviderInfo[] = [
      { ...FLEET[0]!, models: FLEET[0]!.models.filter((m) => m.routingClass === 'fable') },
    ];
    expect(selectCoordinator(goal('bounded'), fableOnly)).toMatchObject({
      modelRef: 'fable',
      effort: 'low',
    });
  });

  it('lets the owner override the class without bypassing billing', () => {
    const request = { ...taskRoutingRequest(goal('bounded')), targetClass: 'fable' as const };
    expect(selectCoordinator(goal('bounded'), FLEET, request)).toMatchObject({
      modelRef: 'fable',
      effort: 'high',
    });
    const unbilled: ProviderInfo[] = [
      {
        ...FLEET[0]!,
        models: FLEET[0]!.models.map((m) => ({ ...m, billingMode: 'unknown' as const })),
      },
    ];
    expect(route(request, unbilled).kind).toBe('checkpoint');
  });

  it('keeps independent review at the strongest class and high effort', () => {
    expect(effortFor(STRONGEST_ROUTING_REQUEST)).toBe('high');
    expect(effortFor({ purpose: 'review', complexity: 'routine' })).toBe('high');
  });
});

describe('provider effort flags', () => {
  it('passes effort to Claude and Codex only', () => {
    const base = { prompt: 'p', outputMode: 'batch' as const, effort: 'low' as const };
    expect(providerArgs('claude', base)).toEqual(expect.arrayContaining(['--effort', 'low']));
    expect(providerArgs('codex', base).slice(0, 3)).toEqual([
      'exec',
      '-c',
      'model_reasoning_effort="low"',
    ]);
    const resume = providerArgs('codex', { ...base, resumeSessionRef: 's1' });
    expect(resume.slice(0, 3)).toEqual(['exec', '-c', 'model_reasoning_effort="low"']);
    expect(resume.indexOf('resume')).toBeGreaterThan(2);
    expect(providerArgs('antigravity', base).join(' ')).not.toContain('effort');
    expect(providerArgs('claude', { prompt: 'p', outputMode: 'batch' })).not.toContain('--effort');
  });
});
