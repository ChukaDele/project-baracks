import { DEEPSEEK_HARNESS_PIN } from './pin.js';

export const HARNESS_MIGRATION_PHASES = [
  'pin',
  'shadow',
  'strangle',
  'cutover',
  'cleanup',
] as const;

export type HarnessMigrationPhase = (typeof HARNESS_MIGRATION_PHASES)[number];

/** Live workers still use Lima. Composition and conformance exist. */
export const CURRENT_HARNESS_MIGRATION_PHASE: HarnessMigrationPhase = 'shadow';

export const DEFAULT_EXECUTION_BACKEND = 'lima' as const;

export const MAJOR_KERNEL_BUNDLE = '@major/dsh-kernel';
export const DSH_BASE_BUNDLE = '@deepseek-ai/dsh-base';
export const DSH_WEB_BUNDLE = '@deepseek-ai/dsh-web-app';
export const DSH_HEADLESS_BUNDLE = '@deepseek-ai/dsh-headless';
export const DSH_CLAUDE_CODE_BUNDLE = '@deepseek-ai/dsh-subagent-claude-code';
export const DSH_CODEX_BUNDLE = '@deepseek-ai/dsh-subagent-codex';
export const MAJOR_KERNEL_LOCAL_SPEC = 'file:../../bundles/major-kernel';
export const EMPTY_CORDIS_PATCH = '[]\n';
export const MAJOR_KERNEL_PATCH = `- insert:
    - id: subagent-claude-review
      name: '@deepseek-ai/dsh-subagent-claude-code'
      config:
        providerName: claude-review
        permissionMode: plan
    - id: major-workstation
      name: '@major/dsh-kernel'
`;
/** Web profile: disable auto (native on darwin loopback) and mount upstream browse host + UI. */
export const MAJOR_WORKSTATION_WEB_PATCH = `- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: directory-picker-browse-ui
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
`;
export const PROFILE_PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`;

export interface DshBundle {
  name: string;
  patchFile: 'cordis.patch.yml';
  patch: typeof MAJOR_KERNEL_PATCH;
}

export interface DshProfile {
  id: string;
  name: string;
  listen: '127.0.0.1';
  purpose: 'owner-web' | 'major-headless';
  bundles: readonly string[];
  patch: typeof EMPTY_CORDIS_PATCH | typeof MAJOR_WORKSTATION_WEB_PATCH;
  autoStartDaemon: false;
  attachRufloGlobally: false;
}

export function majorKernelBundle(): DshBundle {
  return {
    name: MAJOR_KERNEL_BUNDLE,
    patchFile: 'cordis.patch.yml',
    patch: MAJOR_KERNEL_PATCH,
  };
}

export function majorWorkstationWebProfile(): DshProfile {
  return {
    id: 'major-workstation-web',
    name: '@major/dsh-profile-workstation-web',
    listen: '127.0.0.1',
    purpose: 'owner-web',
    bundles: [
      DSH_BASE_BUNDLE,
      DSH_WEB_BUNDLE,
      DSH_CODEX_BUNDLE,
      DSH_CLAUDE_CODE_BUNDLE,
      MAJOR_KERNEL_BUNDLE,
    ],
    patch: MAJOR_WORKSTATION_WEB_PATCH,
    autoStartDaemon: false,
    attachRufloGlobally: false,
  };
}

export function majorWorkstationHeadlessProfile(): DshProfile {
  return {
    id: 'major-workstation-headless',
    name: '@major/dsh-profile-workstation-headless',
    listen: '127.0.0.1',
    purpose: 'major-headless',
    bundles: [
      DSH_BASE_BUNDLE,
      DSH_HEADLESS_BUNDLE,
      DSH_CODEX_BUNDLE,
      DSH_CLAUDE_CODE_BUNDLE,
      MAJOR_KERNEL_BUNDLE,
    ],
    patch: EMPTY_CORDIS_PATCH,
    autoStartDaemon: false,
    attachRufloGlobally: false,
  };
}

export function workstationProfiles(): readonly [DshProfile, DshProfile] {
  return [majorWorkstationWebProfile(), majorWorkstationHeadlessProfile()];
}

export function pinnedBundleVersion(bundle: string): string | undefined {
  const packages = DEEPSEEK_HARNESS_PIN.npm.packages;
  return bundle in packages ? packages[bundle as keyof typeof packages] : undefined;
}

export function profileManifest(profile: DshProfile): {
  name: string;
  private: true;
  dependencies: Record<typeof MAJOR_KERNEL_BUNDLE, typeof MAJOR_KERNEL_LOCAL_SPEC>;
  dsh: { profile: { bundles: readonly string[] } };
} {
  return {
    name: profile.name,
    private: true,
    dependencies: { [MAJOR_KERNEL_BUNDLE]: MAJOR_KERNEL_LOCAL_SPEC },
    dsh: { profile: { bundles: profile.bundles } },
  };
}

export function bundleManifest(bundle: DshBundle): {
  name: string;
  private: true;
  type: 'module';
  main: './index.js';
  exports: { '.': './index.js' };
  files: ['index.js', 'cordis.patch.yml'];
  version: '0.0.0-shadow';
  dsh: { bundle: { patch: string } };
} {
  return {
    name: bundle.name,
    private: true,
    type: 'module',
    main: './index.js',
    exports: { '.': './index.js' },
    files: ['index.js', 'cordis.patch.yml'],
    version: '0.0.0-shadow',
    dsh: { bundle: { patch: `./${bundle.patchFile}` } },
  };
}
