export const WORKSTATION_PROFILE = 'major-workstation-web' as const;
export const WORKSTATION_LISTEN_HOST = '127.0.0.1' as const;
export const WORKSTATION_CHROME_HOST = 'localhost' as const;
export const WORKSTATION_PORT = 3080;
export const WORKSTATION_APP_BUNDLE = 'Major.app';
export const WORKSTATION_LOCK_RELATIVE = 'run/workstation.lock';
export const WORKSTATION_LOG_RELATIVE = 'logs/workstation.log';
export const WORKSTATION_CHROME_PROFILE_RELATIVE = 'chrome-profile';
export const WORKSTATION_CURRENT_PROJECT_RELATIVE = 'run/current-project';
export const WORKSTATION_LAUNCHER_RELATIVE = 'bin/start-major-workstation.sh';

export const WORKSTATION_DSH_APP_ARGS = [
  '--host',
  WORKSTATION_LISTEN_HOST,
  '--port',
  String(WORKSTATION_PORT),
  '--no-open',
  '--trusted-host',
  WORKSTATION_CHROME_HOST,
] as const;

export const WORKSTATION_FORBIDDEN = [
  'electron-builder',
  '@tauri-apps',
  'Library/LaunchAgents',
  'launchctl bootstrap',
] as const;

export interface WorkstationAppPlan {
  profile: typeof WORKSTATION_PROFILE;
  listen: `${typeof WORKSTATION_LISTEN_HOST}:${typeof WORKSTATION_PORT}`;
  chromeAppUrl: string;
  dshCommand: string;
  chromeCommand: string;
  lockRelative: typeof WORKSTATION_LOCK_RELATIVE;
  logRelative: typeof WORKSTATION_LOG_RELATIVE;
  appBundle: typeof WORKSTATION_APP_BUNDLE;
  preservesMajorPath: true;
  autoStartDaemon: false;
  duplicatePolicy: 'refuse-if-lock-alive';
  liveTrafficRemains: 'lima-cli-acp';
}

export function chromeAppUrl(): string {
  return `http://${WORKSTATION_CHROME_HOST}:${WORKSTATION_PORT}`;
}

export function buildWorkstationAppPlan(): WorkstationAppPlan {
  return {
    profile: WORKSTATION_PROFILE,
    listen: `${WORKSTATION_LISTEN_HOST}:${WORKSTATION_PORT}`,
    chromeAppUrl: chromeAppUrl(),
    dshCommand: `"$DSH_HOME/runtime/node_modules/.bin/dsh" --profile ${WORKSTATION_PROFILE} ${WORKSTATION_DSH_APP_ARGS.join(' ')}`,
    chromeCommand: `Google Chrome --user-data-dir="$DSH_HOME/${WORKSTATION_CHROME_PROFILE_RELATIVE}" --app=${chromeAppUrl()} --no-first-run`,
    lockRelative: WORKSTATION_LOCK_RELATIVE,
    logRelative: WORKSTATION_LOG_RELATIVE,
    appBundle: WORKSTATION_APP_BUNDLE,
    preservesMajorPath: true,
    autoStartDaemon: false,
    duplicatePolicy: 'refuse-if-lock-alive',
    liveTrafficRemains: 'lima-cli-acp',
  };
}

export function formatWorkstationAppPlan(plan: WorkstationAppPlan): string {
  return [
    `profile: ${plan.profile}`,
    `listen: ${plan.listen}`,
    `chrome app: ${plan.chromeAppUrl}`,
    `dsh: ${plan.dshCommand}`,
    `chrome: ${plan.chromeCommand}`,
    `lock: $DSH_HOME/${plan.lockRelative}`,
    `log: $DSH_HOME/${plan.logRelative}`,
    `app: $DSH_HOME/${plan.appBundle}`,
    `preserves major path: ${plan.preservesMajorPath}`,
    `daemon: ${plan.autoStartDaemon}`,
    `duplicates: ${plan.duplicatePolicy}`,
    `live traffic: ${plan.liveTrafficRemains}`,
  ].join('\n');
}
