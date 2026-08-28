import {
  classifyClaims,
  resolveEntityId,
  type ClaimRelationship,
  type KnowledgeFact,
} from './semantics.js';

export type KnowledgeRecordKind = 'source-claim' | 'user-conclusion' | 'major-conclusion';

export interface KnowledgeInputRecord extends KnowledgeFact {
  kind: KnowledgeRecordKind;
  sourceLocator: string;
  retrievalId: string;
  notable: boolean;
}

export interface KnowledgeReceiptItem {
  id: string;
  outcome: 'accepted' | 'rejected' | 'unresolved';
  reason: string;
  relationship?: ClaimRelationship;
  canonicalEntityId?: string;
}

export interface KnowledgeIngestReceipt {
  accepted: KnowledgeReceiptItem[];
  rejected: KnowledgeReceiptItem[];
  unresolved: KnowledgeReceiptItem[];
  truncated: number;
}

export interface KnowledgeMeaning {
  kind: KnowledgeRecordKind;
  summary: string;
  evidence: string;
  sourceLocator: string;
  retrievalId: string;
  observedAt: string;
}

export interface KnowledgeBoundaries {
  /** Existing GBrain/learning boundary supplied by the caller; this module owns no store. */
  captureMeaning(meaning: KnowledgeMeaning): void;
}

export function ingestKnowledge(
  records: readonly KnowledgeInputRecord[],
  existing: readonly KnowledgeFact[],
  boundaries: KnowledgeBoundaries,
  limit = 100,
): KnowledgeIngestReceipt {
  const receipt: KnowledgeIngestReceipt = {
    accepted: [],
    rejected: [],
    unresolved: [],
    truncated: 0,
  };
  const seen = [...existing];
  for (const record of records.slice(0, Math.max(0, limit))) {
    const canonicalEntityId = resolveEntityId([...seen, record], record.entityId);
    if (!canonicalEntityId) {
      receipt.unresolved.push({
        id: record.id,
        outcome: 'unresolved',
        reason: 'ambiguous-or-unestablished-entity-alias',
      });
      continue;
    }
    if (!record.sourceLocator.trim() || !record.retrievalId.trim() || !record.observedAt.trim()) {
      receipt.rejected.push({
        id: record.id,
        outcome: 'rejected',
        reason: 'missing-source-retrieval-or-observed-provenance',
      });
      continue;
    }
    if (!record.notable) {
      receipt.rejected.push({ id: record.id, outcome: 'rejected', reason: 'not-notable' });
      continue;
    }
    const relationships = seen
      .filter((fact) => fact.entityId === canonicalEntityId)
      .map((fact) => classifyClaims({ ...record, entityId: canonicalEntityId }, fact));
    const relationship = relationships.includes('CONTRADICTORY')
      ? 'CONTRADICTORY'
      : relationships.includes('DUPLICATE')
        ? 'DUPLICATE'
        : relationships.includes('RELATED')
          ? 'RELATED'
          : 'DISTINCT';
    if (relationship === 'CONTRADICTORY') {
      receipt.unresolved.push({
        id: record.id,
        outcome: 'unresolved',
        reason: 'overlapping-contradictory-claim',
        relationship,
        canonicalEntityId,
      });
      continue;
    }
    if (relationship === 'DUPLICATE') {
      receipt.rejected.push({
        id: record.id,
        outcome: 'rejected',
        reason: 'duplicate',
        relationship,
        canonicalEntityId,
      });
      continue;
    }
    boundaries.captureMeaning({
      kind: record.kind,
      summary: `${canonicalEntityId}: ${record.predicate} = ${record.value}`,
      evidence: record.sourceRef ?? record.sourceLocator,
      sourceLocator: record.sourceLocator,
      retrievalId: record.retrievalId,
      observedAt: record.observedAt,
    });
    receipt.accepted.push({
      id: record.id,
      outcome: 'accepted',
      reason: relationship === 'RELATED' ? 'notable-related-meaning' : 'notable-distinct-meaning',
      relationship,
      canonicalEntityId,
    });
    seen.push({ ...record, entityId: canonicalEntityId });
  }
  receipt.truncated = Math.max(0, records.length - Math.max(0, limit));
  return receipt;
}
