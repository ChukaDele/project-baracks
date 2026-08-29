import Database from 'better-sqlite3';
import { defaultDbPath } from '../db/client.js';
import {
  readShaperCommandCentre,
  readShaperTelemetry,
  shaperCommandCentreCsv,
  shaperTelemetryCsv,
} from './shaper.js';

function value(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const candidate = args[index + 1];
  if (!candidate || candidate.startsWith('--')) throw new Error(`${flag} requires a value`);
  return candidate;
}

function numberValue(args: string[], flag: string): number | undefined {
  const raw = value(args, flag);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} requires a number`);
  return parsed;
}

export async function runShaperCli(args: string[]): Promise<boolean> {
  if (args[0] !== 'telemetry' || args[1] !== 'shaper') return false;
  const format = value(args, '--format') ?? 'json';
  if (format !== 'json' && format !== 'csv') throw new Error('--format must be json or csv');
  const view = value(args, '--view') ?? 'run-telemetry';
  if (view !== 'run-telemetry' && view !== 'command-centre') {
    throw new Error('--view must be run-telemetry or command-centre');
  }
  const options: Parameters<typeof readShaperTelemetry>[1] = {};
  const days = numberValue(args, '--days');
  const project = value(args, '--project');
  const provider = value(args, '--provider');
  const runPurpose = value(args, '--run-purpose');
  const limit = numberValue(args, '--limit');
  if (days !== undefined) options.days = days;
  if (project !== undefined) options.project = project;
  if (provider !== undefined) options.provider = provider;
  if (runPurpose !== undefined) options.runPurpose = runPurpose;
  if (limit !== undefined) options.limit = limit;
  const sqlite = openShaperTelemetryDb();
  try {
    if (view === 'command-centre') {
      const rows = readShaperCommandCentre(sqlite, options);
      process.stdout.write(
        format === 'csv'
          ? shaperCommandCentreCsv(rows)
          : JSON.stringify({ schemaVersion: 2, kind: 'shaper-command-centre', data: rows }) + '\n',
      );
    } else {
      const rows = readShaperTelemetry(sqlite, options);
      process.stdout.write(
        format === 'csv'
          ? shaperTelemetryCsv(rows)
          : JSON.stringify({ schemaVersion: 2, kind: 'shaper-run-telemetry', data: rows }) + '\n',
      );
    }
  } finally {
    sqlite.close();
  }
  return true;
}

/** Open an existing Major database without creating directories, files, or running migrations. */
export function openShaperTelemetryDb(path: string = defaultDbPath()): Database.Database {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  try {
    sqlite.pragma('query_only = ON');
    return sqlite;
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
