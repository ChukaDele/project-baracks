const REDACTED = '[REDACTED]';

/**
 * Patterns for secrets that must never reach logs, run events or CLI output.
 * Ordered from most to least specific.
 */
const SECRET_PATTERNS: RegExp[] = [
  // Private key blocks (incl. escaped newlines inside JSON service-account files)
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // GitHub tokens
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // Anthropic / OpenAI style API keys
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  // AWS access keys
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // Google API keys
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  // Slack tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  // JWTs
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // Bearer headers
  /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  // key=value / "key": "value" where the key names a secret
  /((?:password|passwd|secret|token|api[_-]?key|private[_-]?key|client[_-]?secret|credential)s?["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
];

export function redactText(text: string, extraPatterns: RegExp[] = []): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix: unknown) =>
      typeof prefix === 'string' && match.startsWith(prefix) ? `${prefix}${REDACTED}` : REDACTED,
    );
  }
  for (const pattern of extraPatterns) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/** Deep-redacts a JSON-serialisable value by redacting its serialised form. */
export function redactValue<T>(value: T, extraPatterns: RegExp[] = []): T {
  return JSON.parse(redactText(JSON.stringify(value), extraPatterns)) as T;
}
