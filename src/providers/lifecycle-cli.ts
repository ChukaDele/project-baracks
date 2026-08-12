import { openDb } from '../db/client.js';
import { BILLING_MODES, type BillingMode } from '../db/schema.js';
import { trustedExecutableRegistry } from '../security/major-gateway.js';
import { majorExecutionBackend } from '../security/major-gateway.js';
import { isCapabilityAvailable } from '../security/capabilities.js';
import {
  loadPersistedProviderInfos,
  persistProviderDiscovery,
  recordBillingObservation,
} from './discovery-store.js';
import { classifyModel, loadModelRegistry } from './registry.js';

const ATTESTABLE_PROVIDERS = Object.freeze({
  'claude-code': 'claude',
  codex: 'codex',
  cursor: 'cursor-agent',
  antigravity: 'agy',
} as const);

type AttestableProvider = keyof typeof ATTESTABLE_PROVIDERS;

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function required(args: string[], name: string): string {
  const value = flag(args, name);
  if (!value) throw new Error(`missing required ${name}`);
  return value;
}

function knownBilling(value: string): Exclude<BillingMode, 'unknown'> {
  if (value === 'unknown' || !BILLING_MODES.includes(value as BillingMode)) {
    throw new Error('billing must be subscription_included, usage_credits, or api_billing');
  }
  return value as Exclude<BillingMode, 'unknown'>;
}

function attestableProvider(value: string): AttestableProvider {
  if (!(value in ATTESTABLE_PROVIDERS)) {
    throw new Error(`unsupported provider for availability attestation: ${value}`);
  }
  return value as AttestableProvider;
}

export async function runProviderLifecycleCli(args: string[]): Promise<boolean> {
  if (args[0] !== 'provider') return false;
  if (args[1] === 'status') {
    const opened = openDb();
    try {
      const providers = loadPersistedProviderInfos(opened.db);
      if (args.includes('--json')) console.log(JSON.stringify(providers, null, 2));
      else if (providers.length === 0)
        console.log('No provider observations. Run major doctor first.');
      else {
        for (const provider of providers) {
          for (const model of provider.models) {
            console.log(
              `${provider.name}\t${model.modelRef}\t${model.availability}\t${model.billingMode}`,
            );
          }
        }
      }
    } finally {
      opened.sqlite.close();
    }
    return true;
  }
  if (args[1] === 'attest-billing') {
    const evidence = required(args, '--evidence').trim();
    if (!evidence) throw new Error('billing attestation evidence must not be empty');
    const opened = openDb();
    try {
      const result = recordBillingObservation(opened.db, {
        providerName: required(args, '--provider'),
        modelRef: required(args, '--model'),
        billingMode: knownBilling(required(args, '--billing')),
        source: 'human',
        note: evidence,
      });
      console.log(JSON.stringify(result, null, 2));
    } finally {
      opened.sqlite.close();
    }
    return true;
  }
  if (args[1] === 'attest-availability') {
    const providerName = attestableProvider(required(args, '--provider'));
    const modelRef = required(args, '--model').trim();
    const evidence = required(args, '--evidence').trim();
    if (!modelRef) throw new Error('availability model must not be empty');
    if (!evidence) throw new Error('availability attestation evidence must not be empty');

    // The human attests only the observed model/auth state. Major independently
    // verifies that the fixed canonical installation exists and is executable;
    // neither PATH nor a user-supplied executable path can confer trust.
    const executableName = ATTESTABLE_PROVIDERS[providerName];
    const backendProbe = isCapabilityAvailable('live-agent-execution')
      ? await majorExecutionBackend().probeProvider(executableName)
      : undefined;
    const trusted = backendProbe
      ? undefined
      : trustedExecutableRegistry(executableName).verify(executableName);
    if (backendProbe && (!backendProbe.installed || !backendProbe.authenticated)) {
      throw new Error(`isolated provider probe failed for ${providerName}: ${backendProbe.detail}`);
    }
    const classification = classifyModel(loadModelRegistry(), providerName, modelRef);
    if (classification.routingClass === 'unknown') {
      throw new Error(`model ${providerName}/${modelRef} has no routing classification`);
    }
    const opened = openDb();
    try {
      const result = persistProviderDiscovery(
        opened.db,
        {
          name: providerName,
          executable: backendProbe?.executable ?? trusted!.spawnPath,
          installed: true,
          authenticated: true,
          models: [
            {
              modelRef,
              routingClass: classification.routingClass,
              visible: true,
              authenticated: true,
              availability: 'available',
              billingMode: 'unknown',
              expectedBillingMode: classification.billingMode,
              prohibited: classification.prohibited,
              ...(classification.prohibitedReason
                ? { prohibitedReason: classification.prohibitedReason }
                : {}),
              source: 'probe',
            },
          ],
        },
        { source: 'human', note: evidence },
      );
      console.log(JSON.stringify(result, null, 2));
    } finally {
      opened.sqlite.close();
    }
    return true;
  }
  return false;
}
