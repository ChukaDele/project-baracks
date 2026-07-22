const REDACTED = '[REDACTED]';

/**
 * Patterns for secrets that must never reach logs, run events or CLI output.
 * Ordered from most to least specific. Pattern matching is the SECONDARY
 * safeguard for free text; structured values are redacted structurally by
 * sensitive key first (see redactValue), which removes complete values —
 * including multi-part ones — regardless of format.
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
];

// key=value / "key": "value" where the key CONTAINS a secret word (covers
// env-style names like AWS_SECRET_ACCESS_KEY). Quoted values are consumed to
// the closing quote so values containing whitespace do not leak their tail;
// unquoted values are consumed to the next delimiter. Quoting is preserved
// so redacted JSON text stays parseable.
const KEY_VALUE_PATTERN =
  /([A-Za-z0-9_-]*(?:password|passwd|secret|token|api[_-]?key|apikey|private[_-]?key|client[_-]?secret|credential)s?[A-Za-z0-9_-]*["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"',;}]+)/gi;

export function redactText(text: string, extraPatterns: RegExp[] = []): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix: unknown) =>
      typeof prefix === 'string' && match.startsWith(prefix) ? `${prefix}${REDACTED}` : REDACTED,
    );
  }
  out = out.replace(KEY_VALUE_PATTERN, (_match, prefix: string, value: string) => {
    const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : '';
    return `${prefix}${quote}${REDACTED}${quote}`;
  });
  for (const pattern of extraPatterns) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/** Key names whose ENTIRE value is a secret, whatever its shape or format. */
const SENSITIVE_KEY_PATTERN =
  /(^|[_\-.\s])(password|passwd|secret|secrets|token|tokens|api[_-]?key|apikey|private[_-]?key|client[_-]?secret|credential|credentials|auth|authorization|bearer|cookie|session[_-]?token|access[_-]?key|refresh[_-]?token|signing[_-]?key)([_\-.\s]|$)/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function redactStructured(value: unknown, seen: WeakSet<object>, extraPatterns: RegExp[]): unknown {
  if (typeof value === 'string') return redactText(value, extraPatterns);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return REDACTED; // circular reference: fail closed
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactStructured(item, seen, extraPatterns));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    // The whole value under a sensitive key is dropped — nested objects,
    // arrays and multi-part strings included — so no fragment can survive.
    out[key] = isSensitiveKey(key) ? REDACTED : redactStructured(item, seen, extraPatterns);
  }
  return out;
}

/**
 * Deep-redacts a JSON-serialisable value BEFORE serialisation: complete
 * values under sensitive key names are removed structurally (the primary
 * safeguard), then remaining strings pass through pattern redaction. Fails
 * closed: if redaction itself throws, the entire value is replaced by a
 * redaction-failure marker rather than persisted unredacted.
 */
export function redactValue<T>(value: T, extraPatterns: RegExp[] = []): T {
  try {
    const structural = redactStructured(value, new WeakSet(), extraPatterns);
    // Round-trip to guarantee the result is exactly what would persist.
    return JSON.parse(JSON.stringify(structural)) as T;
  } catch {
    return { redaction: 'failed', note: 'value withheld: could not be safely redacted' } as T;
  }
}
