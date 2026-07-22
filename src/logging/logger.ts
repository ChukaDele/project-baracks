import { redactText } from '../security/redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  write?: (line: string) => void;
  bindings?: Record<string, unknown>;
  extraRedactionPatterns?: RegExp[];
}

/** Structured JSON logger. Every line is redacted before it is written. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const write = options.write ?? ((line: string) => process.stderr.write(line + '\n'));
  const bindings = options.bindings ?? {};
  const patterns = options.extraRedactionPatterns ?? [];

  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    const record = { ts: new Date().toISOString(), level, msg, ...bindings, ...fields };
    write(redactText(JSON.stringify(record), patterns));
  };

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (childBindings) =>
      createLogger({
        write,
        bindings: { ...bindings, ...childBindings },
        extraRedactionPatterns: patterns,
      }),
  };
}
