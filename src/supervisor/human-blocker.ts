export const BLOCKER_STATES = [
  'RUNNING',
  'PARTIALLY_BLOCKED',
  'FULLY_BLOCKED',
  'RESUMING',
] as const;
export type BlockerState = (typeof BLOCKER_STATES)[number];

export interface VisibleBrowserState {
  activeUrl?: string;
  rendered: boolean;
}

export interface BrowserAttachment {
  status: 'ATTACHED' | 'BROWSER_ATTACHMENT_FAILURE';
  message: string;
}

export interface HumanBlockerPlan {
  project: string;
  action: string;
  independentWork: string[];
  expectedAuthUrl?: string;
  visibleBrowser?: VisibleBrowserState;
  resolved?: boolean;
}

export interface HumanBlockerDecision {
  state: BlockerState;
  notification?: { title: string; message: string } | undefined;
  browser?: BrowserAttachment | undefined;
  pausedDependencies: string[];
  continuedWork: string[];
  resumeDependentWork: boolean;
}

export function assertVisibleBrowserState(
  expectedAuthUrl: string,
  visible: VisibleBrowserState,
): BrowserAttachment {
  let expected: URL;
  let active: URL;
  try {
    expected = new URL(expectedAuthUrl);
    active = new URL(visible.activeUrl ?? '');
  } catch {
    return {
      status: 'BROWSER_ATTACHMENT_FAILURE',
      message: 'BROWSER ATTACHMENT FAILURE: the visible in-app browser has no valid active URL.',
    };
  }

  if (
    !visible.rendered ||
    active.hostname !== expected.hostname ||
    active.hostname === 'localhost'
  ) {
    return {
      status: 'BROWSER_ATTACHMENT_FAILURE',
      message: `BROWSER ATTACHMENT FAILURE: expected rendered ${expected.hostname}, found ${active.hostname || 'no active host'}.`,
    };
  }
  return { status: 'ATTACHED', message: `Visible in-app browser is active on ${active.hostname}.` };
}

export function planHumanBlocker(input: HumanBlockerPlan): HumanBlockerDecision {
  if (input.resolved) {
    return {
      state: 'RESUMING',
      pausedDependencies: [],
      continuedWork: input.independentWork,
      resumeDependentWork: true,
    };
  }

  const continuedWork = input.independentWork;
  const state: BlockerState = continuedWork.length > 0 ? 'PARTIALLY_BLOCKED' : 'FULLY_BLOCKED';
  return {
    state,
    notification: {
      title: 'Major — Action required',
      message: `${input.project}: ${input.action}`,
    },
    ...(input.expectedAuthUrl && input.visibleBrowser
      ? { browser: assertVisibleBrowserState(input.expectedAuthUrl, input.visibleBrowser) }
      : {}),
    pausedDependencies: [input.action],
    continuedWork,
    resumeDependentWork: false,
  };
}
