import { createHash } from 'node:crypto';
import type { UpdateProposal } from './types.js';

/** Serialise with sorted object keys so identical payloads hash identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

/**
 * The canonical payload identity of a proposal: a hash over its change set.
 * Rationale and evidence references contextualise a proposal; the changes ARE
 * the payload.
 */
export function proposalPayloadHash(proposal: Pick<UpdateProposal, 'changes'>): string {
  return createHash('sha256').update(canonicalJson(proposal.changes)).digest('hex');
}

const KEY_HASH_LENGTH = 16;

/** Idempotency keys embed the payload hash: same key => same payload. */
export function proposalIdempotencyKey(
  baseKey: string,
  proposal: Pick<UpdateProposal, 'changes'>,
): string {
  return `${baseKey}#${proposalPayloadHash(proposal).slice(0, KEY_HASH_LENGTH)}`;
}

/** True when the key's embedded hash matches the proposal's actual payload. */
export function idempotencyKeyMatchesPayload(
  idempotencyKey: string,
  proposal: Pick<UpdateProposal, 'changes'>,
): boolean {
  return idempotencyKey.endsWith(`#${proposalPayloadHash(proposal).slice(0, KEY_HASH_LENGTH)}`);
}
