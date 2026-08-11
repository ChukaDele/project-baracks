import { openDb } from '../db/client.js';
import { BILLING_MODES, type BillingMode } from '../db/schema.js';
import { loadPersistedProviderInfos, recordBillingObservation } from './discovery-store.js';

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
  return false;
}
