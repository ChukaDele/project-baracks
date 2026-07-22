export interface CommandPolicy {
  /** Preferred: when non-empty, only these executables may be spawned. */
  allowedExecutables?: readonly string[];
  /** Additional project-configured prohibited command patterns. */
  prohibitedPatterns?: readonly (RegExp | string)[];
  /** Branches that must never receive a direct push. Default: main, master. */
  protectedBranches?: readonly string[];
}

export type CommandCheck = { allowed: true } | { allowed: false; reason: string };

const DEFAULT_PROTECTED_BRANCHES = ['main', 'master'];

/** Built-in prohibitions that apply regardless of project configuration. */
function builtInViolation(command: string, protectedBranches: readonly string[]): string | null {
  const trimmed = command.trim();
  if (/\bgit\s+push\b[^|;&]*(--force|-f\b|--force-with-lease)/.test(trimmed)) {
    return 'force pushes are prohibited';
  }
  if (/\bgit\s+push\b/.test(trimmed)) {
    for (const branch of protectedBranches) {
      const pattern = new RegExp(`\\bgit\\s+push\\b[^|;&]*\\b${branch}\\b`);
      if (pattern.test(trimmed)) return `direct pushes to ${branch} are prohibited`;
    }
  }
  if (/\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE|TRUNCATE\s+\w)/i.test(trimmed)) {
    return 'destructive database commands are prohibited';
  }
  if (/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/.test(trimmed)) {
    return 'recursive force deletion is prohibited';
  }
  return null;
}

export function checkCommand(command: string, policy: CommandPolicy = {}): CommandCheck {
  const violation = builtInViolation(
    command,
    policy.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES,
  );
  if (violation) return { allowed: false, reason: violation };

  for (const pattern of policy.prohibitedPatterns ?? []) {
    const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    if (re.test(command)) {
      return { allowed: false, reason: `matches prohibited pattern: ${re.source}` };
    }
  }

  if (policy.allowedExecutables && policy.allowedExecutables.length > 0) {
    const executable = command.trim().split(/\s+/)[0] ?? '';
    const base = executable.split('/').at(-1) ?? executable;
    if (!policy.allowedExecutables.includes(base)) {
      return { allowed: false, reason: `executable not in allowlist: ${base}` };
    }
  }

  return { allowed: true };
}
