import { and, eq } from 'drizzle-orm';
import type { Db, DbConn } from '../db/client.js';
import {
  agentModels,
  agentProviders,
  discoveryObservations,
  type BillingMode,
  type ModelAvailability,
} from '../db/schema.js';
import { newId } from '../domain/ids.js';
import { redactText } from '../security/redact.js';
import { capacityKey, parseCapacityKey } from './account.js';
import type { ModelState, ProviderInfo } from './types.js';

/**
 * Persisted provider/model discovery. Availability and billing state are
 * never merely asserted in code: every write is an observation with a source
 * and confidence, appended to discovery_observations, and the current state
 * on agent_models is what routing consumes. Exhaustion carries a next-probe
 * time; nothing re-probes or retries a model before it.
 *
 * Billing authority: discovery NEVER writes billing_mode. New models persist
 * as 'unknown' (unroutable) and existing rows keep their current value; the
 * only way billing becomes known is recordBillingObservation() with an
 * authoritative source — a human attestation or an observed run outcome.
 * Registry defaults, executable presence and auth-file heuristics are
 * evidence of nothing where money is concerned.
 */

export type ObservationSource = 'registry' | 'cli' | 'probe' | 'run_outcome' | 'human';

const CONFIDENCE_BY_SOURCE = {
  registry: 'configured',
  cli: 'inferred',
  probe: 'inferred',
  run_outcome: 'observed',
  human: 'configured',
} as const;

const DEFAULT_BACKOFF_MS: Record<'rate_limited' | 'exhausted', number> = {
  rate_limited: 15 * 60 * 1000,
  exhausted: 60 * 60 * 1000,
};

function upsertProvider(db: DbConn, info: ProviderInfo, now: string, source: ObservationSource) {
  const { providerName, accountLabel } = parseCapacityKey(info.name);
  const existing = db
    .select()
    .from(agentProviders)
    .where(
      and(eq(agentProviders.name, providerName), eq(agentProviders.accountLabel, accountLabel)),
    )
    .get();
  if (existing) {
    const authoritative = source === 'human' || source === 'probe' || source === 'run_outcome';
    db.update(agentProviders)
      .set({
        executable: authoritative ? (info.executable ?? existing.executable) : existing.executable,
        version: authoritative ? (info.version ?? existing.version) : existing.version,
        lastDiscoveredAt: now,
      })
      .where(eq(agentProviders.id, existing.id))
      .run();
    return existing.id;
  }
  const id = newId('aprov');
  db.insert(agentProviders)
    .values({
      id,
      name: providerName,
      accountLabel,
      executable: info.executable ?? null,
      version: info.version ?? null,
      lastDiscoveredAt: now,
    })
    .run();
  return id;
}

/** Resolve the persisted provider row for a routing/outcome capacity key,
 * which may be a bare provider name (default account) or a
 * `${providerName}#${accountLabel}` composite for a non-default account. */
function selectProviderByCapacityKey(db: DbConn, key: string) {
  const { providerName, accountLabel } = parseCapacityKey(key);
  return db
    .select()
    .from(agentProviders)
    .where(
      and(eq(agentProviders.name, providerName), eq(agentProviders.accountLabel, accountLabel)),
    )
    .get();
}

/**
 * Persist one provider discovery result. A model already backing off
 * (rate-limited/exhausted with a future nextProbeAt) keeps its availability —
 * an optimistic discover() must not erase an observed exhaustion.
 */
export function persistProviderDiscovery(
  db: Db,
  info: ProviderInfo,
  options: {
    source: ObservationSource;
    note?: string;
    now?: () => Date;
    /** An explicit, human-triggered re-probe (e.g. `major provider probe`)
     * may observe a materially changed auth state — a credential refresh or
     * account swap — sooner than the passive backoff window would otherwise
     * allow. Automatic/background discovery must never set this: it exists
     * to record an intentional owner action, not to let routine polling
     * defeat the backoff that prevents hot-looping a real provider. */
    bypassBackoff?: boolean;
  },
) {
  return db.transaction(
    (tx) => {
      const now = (options.now?.() ?? new Date()).toISOString();
      const providerId = upsertProvider(tx, info, now, options.source);
      const persisted = [];
      for (const model of info.models) {
        const existing = tx
          .select()
          .from(agentModels)
          .where(
            and(eq(agentModels.providerId, providerId), eq(agentModels.modelRef, model.modelRef)),
          )
          .get();
        const backingOff =
          !options.bypassBackoff &&
          existing &&
          (existing.availability === 'rate_limited' || existing.availability === 'exhausted') &&
          existing.nextProbeAt !== null &&
          now < existing.nextProbeAt;
        // Registry/doctor discovery is process-free and therefore cannot
        // revoke a prior human/probe/run observation. It may add an unknown
        // model, but it cannot turn a routable attested model back into an
        // unauthenticated unknown merely because it deliberately did not run
        // the provider CLI.
        const preserveAuthoritativeState =
          existing &&
          (options.source === 'registry' || options.source === 'cli') &&
          (existing.visible || existing.authenticated || existing.availability !== 'unknown');
        const availability =
          backingOff || preserveAuthoritativeState ? existing.availability : model.availability;
        const nextProbeAt = backingOff || preserveAuthoritativeState ? existing.nextProbeAt : null;
        // Discovery cannot assert billing: keep the authoritatively observed
        // value if one exists, otherwise stay 'unknown' (unroutable).
        const billingMode = existing ? existing.billingMode : 'unknown';
        const state = {
          routingClass: preserveAuthoritativeState ? existing.routingClass : model.routingClass,
          visible: preserveAuthoritativeState ? existing.visible : model.visible,
          authenticated: preserveAuthoritativeState ? existing.authenticated : model.authenticated,
          availability,
          billingMode,
          prohibited: preserveAuthoritativeState ? existing.prohibited : model.prohibited,
          prohibitedReason: preserveAuthoritativeState
            ? existing.prohibitedReason
            : (model.prohibitedReason ?? null),
          lastProbedAt: now,
          nextProbeAt,
        };
        let modelId: string;
        if (existing) {
          tx.update(agentModels).set(state).where(eq(agentModels.id, existing.id)).run();
          modelId = existing.id;
        } else {
          modelId = newId('amodel');
          tx.insert(agentModels)
            .values({ id: modelId, providerId, modelRef: model.modelRef, ...state })
            .run();
        }
        tx.insert(discoveryObservations)
          .values({
            id: newId('dobs'),
            providerId,
            modelId,
            observedJson: JSON.stringify({
              modelRef: model.modelRef,
              ...state,
              ...(options.note ? { note: redactText(options.note).slice(0, 4_000) } : {}),
            }),
            source: options.source,
            confidence: CONFIDENCE_BY_SOURCE[options.source],
            observedAt: now,
          })
          .run();
        persisted.push({ modelId, modelRef: model.modelRef, availability, nextProbeAt });
      }
      return { providerId, models: persisted };
    },
    { behavior: 'immediate' },
  );
}

/**
 * Record an AUTHORITATIVE billing observation: a human attestation ('human')
 * or a provider-observed run outcome ('run_outcome'). This is the ONLY code
 * path that sets a model's billing_mode; anything configuration-shaped
 * (registry, cli, probe) is refused by the type and would be evidence of
 * nothing anyway.
 */
export function recordBillingObservation(
  db: Db,
  input: {
    providerName: string;
    modelRef: string;
    billingMode: Exclude<BillingMode, 'unknown'>;
    source: 'human' | 'run_outcome';
    note?: string;
    now?: () => Date;
  },
) {
  return db.transaction(
    (tx) => {
      const provider = selectProviderByCapacityKey(tx, input.providerName);
      if (!provider) throw new Error(`provider not persisted: ${input.providerName}`);
      const model = tx
        .select()
        .from(agentModels)
        .where(
          and(eq(agentModels.providerId, provider.id), eq(agentModels.modelRef, input.modelRef)),
        )
        .get();
      if (!model) throw new Error(`model not persisted: ${input.providerName}/${input.modelRef}`);
      const now = (input.now?.() ?? new Date()).toISOString();
      tx.insert(discoveryObservations)
        .values({
          id: newId('dobs'),
          providerId: provider.id,
          modelId: model.id,
          observedJson: JSON.stringify({
            modelRef: input.modelRef,
            billingMode: input.billingMode,
            note: input.note ? redactText(input.note).slice(0, 4_000) : null,
          }),
          source: input.source,
          confidence: CONFIDENCE_BY_SOURCE[input.source],
          observedAt: now,
        })
        .run();
      tx.update(agentModels)
        .set({ billingMode: input.billingMode })
        .where(eq(agentModels.id, model.id))
        .run();
      return { modelId: model.id, billingMode: input.billingMode };
    },
    { behavior: 'immediate' },
  );
}

/**
 * Record an availability outcome observed from a real run (rate limit,
 * exhaustion, or recovery), with the backoff window that gates re-probing.
 */
export function recordModelOutcome(
  db: Db,
  input: {
    providerName: string;
    modelRef: string;
    outcome: Extract<ModelAvailability, 'available' | 'rate_limited' | 'exhausted' | 'unknown'>;
    backoffMs?: number;
    now?: () => Date;
  },
) {
  return db.transaction(
    (tx) => {
      const provider = selectProviderByCapacityKey(tx, input.providerName);
      if (!provider) throw new Error(`provider not persisted: ${input.providerName}`);
      const model = tx
        .select()
        .from(agentModels)
        .where(
          and(eq(agentModels.providerId, provider.id), eq(agentModels.modelRef, input.modelRef)),
        )
        .get();
      if (!model) throw new Error(`model not persisted: ${input.providerName}/${input.modelRef}`);
      const nowMs = (input.now?.() ?? new Date()).getTime();
      const nextProbeAt =
        input.outcome === 'available' || input.outcome === 'unknown'
          ? null
          : new Date(nowMs + (input.backoffMs ?? DEFAULT_BACKOFF_MS[input.outcome])).toISOString();
      tx.update(agentModels)
        .set({
          availability: input.outcome,
          nextProbeAt,
          lastProbedAt: new Date(nowMs).toISOString(),
        })
        .where(eq(agentModels.id, model.id))
        .run();
      tx.insert(discoveryObservations)
        .values({
          id: newId('dobs'),
          providerId: provider.id,
          modelId: model.id,
          observedJson: JSON.stringify({
            modelRef: input.modelRef,
            availability: input.outcome,
            nextProbeAt,
          }),
          source: 'run_outcome',
          confidence: 'observed',
          observedAt: new Date(nowMs).toISOString(),
        })
        .run();
      return { modelId: model.id, availability: input.outcome, nextProbeAt };
    },
    { behavior: 'immediate' },
  );
}

/** False while a model is inside its backoff window: no probe, no retry. */
export function shouldProbe(
  model: { nextProbeAt: string | null },
  now: () => Date = () => new Date(),
): boolean {
  return model.nextProbeAt === null || now().toISOString() >= model.nextProbeAt;
}

/** Atomically consume one expired backoff retry. The model becomes unknown
 * before the worker starts, so a generic failure cannot leave it permanently
 * retry-eligible and hot-looping through every coordinator cycle. */
export function consumeModelRetry(
  db: Db,
  input: { providerName: string; modelRef: string; now?: () => Date },
): boolean {
  return db.transaction(
    (tx) => {
      const provider = selectProviderByCapacityKey(tx, input.providerName);
      if (!provider) return false;
      const model = tx
        .select()
        .from(agentModels)
        .where(
          and(eq(agentModels.providerId, provider.id), eq(agentModels.modelRef, input.modelRef)),
        )
        .get();
      const now = (input.now?.() ?? new Date()).toISOString();
      if (
        !model ||
        (model.availability !== 'rate_limited' && model.availability !== 'exhausted') ||
        model.nextProbeAt === null ||
        model.nextProbeAt > now
      ) {
        return false;
      }
      const updated = tx
        .update(agentModels)
        .set({ availability: 'unknown', nextProbeAt: null, lastProbedAt: now })
        .where(
          and(
            eq(agentModels.id, model.id),
            eq(agentModels.availability, model.availability),
            eq(agentModels.nextProbeAt, model.nextProbeAt),
          ),
        )
        .run();
      if (updated.changes !== 1) return false;
      tx.insert(discoveryObservations)
        .values({
          id: newId('dobs'),
          providerId: provider.id,
          modelId: model.id,
          observedJson: JSON.stringify({
            modelRef: model.modelRef,
            availability: 'unknown',
            retryStartedAt: now,
          }),
          source: 'run_outcome',
          confidence: 'observed',
          observedAt: now,
        })
        .run();
      return true;
    },
    { behavior: 'immediate' },
  );
}

/** Build routing inputs from PERSISTED state, not fresh assertions. */
export function loadPersistedProviderInfos(
  db: DbConn,
  now: () => Date = () => new Date(),
): ProviderInfo[] {
  const currentTime = now().toISOString();
  const providers = db.select().from(agentProviders).all();
  return providers.map((provider) => {
    const models = db
      .select()
      .from(agentModels)
      .where(eq(agentModels.providerId, provider.id))
      .all();
    const states: ModelState[] = models.map((m) => {
      const state: ModelState = {
        modelRef: m.modelRef,
        routingClass: m.routingClass,
        visible: m.visible,
        authenticated: m.authenticated,
        availability: m.availability,
        billingMode: m.billingMode,
        prohibited: m.prohibited,
        source: 'persisted',
      };
      if (
        (m.availability === 'rate_limited' || m.availability === 'exhausted') &&
        m.nextProbeAt !== null &&
        currentTime >= m.nextProbeAt
      ) {
        state.retryEligible = true;
      }
      if (m.prohibitedReason !== null) state.prohibitedReason = m.prohibitedReason;
      return state;
    });
    const info: ProviderInfo = {
      name: capacityKey(provider.name, provider.accountLabel),
      installed: states.some((s) => s.visible),
      models: states,
    };
    if (provider.executable !== null) info.executable = provider.executable;
    if (provider.version !== null) info.version = provider.version;
    return info;
  });
}

/** The fingerprint of the credential currently imported for this provider,
 * or null if none has been imported (or the provider is unknown). Never the
 * credential itself — see `fingerprintCredentialFile` in host-credential.ts. */
export function getCredentialFingerprint(db: DbConn, providerName: string): string | null {
  return selectProviderByCapacityKey(db, providerName)?.credentialFingerprint ?? null;
}

/** Records which credential (by fingerprint only) is currently imported for
 * a provider. Called only after a successful import — never speculatively. */
export function setCredentialFingerprint(db: Db, providerName: string, fingerprint: string): void {
  const { providerName: name, accountLabel } = parseCapacityKey(providerName);
  const now = new Date().toISOString();
  const existing = db
    .select()
    .from(agentProviders)
    .where(and(eq(agentProviders.name, name), eq(agentProviders.accountLabel, accountLabel)))
    .get();
  if (existing) {
    db.update(agentProviders)
      .set({ credentialFingerprint: fingerprint })
      .where(eq(agentProviders.id, existing.id))
      .run();
    return;
  }
  db.insert(agentProviders)
    .values({
      id: newId('aprov'),
      name,
      accountLabel,
      credentialFingerprint: fingerprint,
      lastDiscoveredAt: now,
    })
    .run();
}
