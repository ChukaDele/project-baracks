/**
 * Sanitised subprocess environments. Children never inherit the parent
 * environment: they receive an allowlisted subset, and anything that looks
 * like a credential or could activate paid/API billing is stripped unless a
 * valid DecisionRequest explicitly authorises specific variables.
 */

export const DEFAULT_ENV_ALLOWLIST: readonly string[] = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TZ',
  'COLORTERM',
];

/** Names that can switch a provider CLI onto API billing or paid credits. */
export const BILLING_ENV_NAMES: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'OPENAI_API_KEY',
  'OPENAI_ORG_ID',
  'OPENAI_BASE_URL',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS',
];

const SECRET_ENV_PATTERN =
  /(^|_)(API_?KEY|APIKEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|PRIVATE_?KEY|AUTH)(_|$)/i;

export function isSensitiveEnvName(name: string): boolean {
  return BILLING_ENV_NAMES.includes(name) || SECRET_ENV_PATTERN.test(name);
}

export interface SanitizedEnv {
  env: Record<string, string>;
  /** Sensitive names present in the source env that were NOT passed through. */
  stripped: string[];
  /** Sensitive names passed through under explicit authorisation. */
  authorized: string[];
}

export function sanitizeEnv(
  source: NodeJS.ProcessEnv,
  options: {
    allowlist?: readonly string[];
    /** Sensitive names a valid DecisionRequest has authorised. */
    authorizedNames?: readonly string[];
  } = {},
): SanitizedEnv {
  const allowlist = new Set([...DEFAULT_ENV_ALLOWLIST, ...(options.allowlist ?? [])]);
  const authorizedNames = new Set(options.authorizedNames ?? []);
  const env: Record<string, string> = {};
  const stripped: string[] = [];
  const authorized: string[] = [];

  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (authorizedNames.has(name)) {
      env[name] = value;
      if (isSensitiveEnvName(name)) authorized.push(name);
      continue;
    }
    if (isSensitiveEnvName(name)) {
      stripped.push(name);
      continue;
    }
    if (allowlist.has(name)) env[name] = value;
  }

  return { env, stripped: stripped.sort(), authorized: authorized.sort() };
}
