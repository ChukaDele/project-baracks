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

const SHELLS = ['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh'];

const DESTRUCTIVE_SQL = /\b(DROP\s+(TABLE|DATABASE|SCHEMA|INDEX)|TRUNCATE\s+\w|TRUNCATE\s*$)/i;

function basename(executable: string): string {
  return executable.split('/').at(-1) ?? executable;
}

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

/** String-form check, used for command strings held in configuration. */
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
    const base = basename(executable);
    if (!policy.allowedExecutables.includes(base)) {
      return { allowed: false, reason: `executable not in allowlist: ${base}` };
    }
  }

  return { allowed: true };
}

/** git global options that consume the following argument as a value. */
const GIT_VALUE_FLAGS = ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'];

function gitViolation(
  args: readonly string[],
  protectedBranches: readonly string[],
): string | null {
  // Skip global flags (and their values) to find the real subcommand, so
  // `git -C somedir push …` cannot slip past the push rules.
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (GIT_VALUE_FLAGS.includes(arg)) {
      if (positionals.length === 0) i++; // consume the flag's value pre-subcommand
      continue;
    }
    if (arg.startsWith('-')) continue;
    positionals.push(arg);
  }
  const subcommand = positionals[0];
  if (subcommand !== 'push') return null;

  for (const arg of args) {
    if (/^(--force|--force-with-lease(=.*)?|--force-if-includes)$/.test(arg)) {
      return 'force pushes are prohibited';
    }
    if (/^-[a-zA-Z]*f[a-zA-Z]*$/.test(arg)) {
      return 'force pushes are prohibited (short flag)';
    }
  }

  // args after 'push': [remote?, refspec...]. A push must name an explicit,
  // non-protected refspec — a bare push can silently target a protected branch
  // via upstream tracking, so it is refused.
  const targets = positionals.slice(1);
  if (targets.length < 2) {
    return 'git push must name an explicit remote and refspec (bare pushes are prohibited)';
  }
  for (const refspec of targets.slice(1)) {
    const destination = refspec.includes(':') ? refspec.split(':').at(-1)! : refspec;
    const branch = destination.replace(/^refs\/heads\//, '');
    if (protectedBranches.includes(branch)) {
      return `direct pushes to ${branch} are prohibited`;
    }
  }
  return null;
}

function rmViolation(args: readonly string[]): string | null {
  let recursive = false;
  let force = false;
  for (const arg of args) {
    if (arg === '--recursive') recursive = true;
    if (arg === '--force') force = true;
    if (/^-[a-zA-Z]+$/.test(arg)) {
      if (/[rR]/.test(arg)) recursive = true;
      if (arg.includes('f')) force = true;
    }
    if (arg === '--no-preserve-root') return 'rm --no-preserve-root is prohibited';
  }
  if (recursive && force) return 'recursive force deletion is prohibited';
  return null;
}

/**
 * Structured (argv) command-policy check — the form the execution gateway
 * enforces at spawn time. Never accepts a shell command string, so there is
 * no shell parsing to confuse: each argument is inspected as-is.
 */
export function checkArgv(
  executable: string,
  args: readonly string[],
  policy: CommandPolicy,
): CommandCheck {
  const base = basename(executable);

  if (!policy.allowedExecutables || policy.allowedExecutables.length === 0) {
    return { allowed: false, reason: 'executable allowlist is mandatory and empty' };
  }
  if (!policy.allowedExecutables.includes(base)) {
    return { allowed: false, reason: `executable not in allowlist: ${base}` };
  }

  if (SHELLS.includes(base) && args.some((a) => /^-[a-zA-Z]*c/.test(a))) {
    return { allowed: false, reason: 'shell command strings (-c) are prohibited' };
  }

  const protectedBranches = policy.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES;
  if (base === 'git') {
    const violation = gitViolation(args, protectedBranches);
    if (violation) return { allowed: false, reason: violation };
  }

  if (base === 'rm') {
    const violation = rmViolation(args);
    if (violation) return { allowed: false, reason: violation };
  }

  for (const arg of args) {
    if (DESTRUCTIVE_SQL.test(arg)) {
      return { allowed: false, reason: 'destructive database commands are prohibited' };
    }
  }

  const joined = [base, ...args].join(' ');
  for (const pattern of policy.prohibitedPatterns ?? []) {
    const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    if (re.test(joined) || args.some((a) => re.test(a))) {
      return { allowed: false, reason: `matches prohibited pattern: ${re.source}` };
    }
  }

  return { allowed: true };
}
