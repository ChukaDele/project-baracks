import { randomUUID } from 'node:crypto';

export type IdPrefix =
  | 'proj'
  | 'ritem'
  | 'task'
  | 'tdep'
  | 'tsug'
  | 'arun'
  | 'aevt'
  | 'aprov'
  | 'amodel'
  | 'wtree'
  | 'vrun'
  | 'rfind'
  | 'dreq'
  | 'evid'
  | 'rupd'
  | 'rapl'
  | 'usage'
  | 'tclm'
  | 'dobs'
  | 'rchk'
  | 'xpd';

/** Stable, globally unique, prefix-typed ID (e.g. `task_5f0c...`). */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
