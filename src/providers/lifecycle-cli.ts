import { createInterface } from 'node:readline/promises';
import { openDb } from '../db/client.js';
import { BILLING_MODES, type BillingMode } from '../db/schema.js';
import { computeProviderReadiness } from '../doctor/readiness.js';
import { trustedExecutableRegistry } from '../security/major-gateway.js';
import { majorExecutionBackend } from '../security/major-gateway.js';
import { isCapabilityAvailable } from '../security/capabilities.js';
import { ExecutableTrustError } from '../security/trusted-executables.js';
import { checkHostCredential, fingerprintCredentialFile } from './host-credential.js';
import { hostProviderVersion } from './host-provider-version.js';
import type { ProviderCommandHost } from './commands.js';
import {
  getCredentialFingerprint,
  loadPersistedProviderInfos,
  persistProviderDiscovery,
  recordBillingObservation,
  setCredentialFingerprint,
} from './discovery-store.js';
import {
  authenticatedCodexAccountLabels,
  codexUsageReport,
  formatCodexUsage,
  redactCodexUsageText,
  writeCodexUsageReport,
  type CodexUsageAccount,
} from './codex-usage.js';
import { readApprovedCodexProfileUsage } from './codex-profile-reader.js';
import { syncApprovedCodexProfiles } from './codex-profile-sync.js';
import { classifyModel, loadModelRegistry } from './registry.js';

const ATTESTABLE_PROVIDERS = Object.freeze({
  'claude-code': 'claude',
  codex: 'codex',
  cursor: 'cursor-agent',
  antigravity: 'agy',
} as const);

type AttestableProvider = keyof typeof ATTESTABLE_PROVIDERS;

const PROVIDER_TO_HOST: Record<AttestableProvider, ProviderCommandHost> = {
  'claude-code': 'claude',
  codex: 'codex',
  cursor: 'cursor',
  antigravity: 'antigravity',
};

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

/**
 * Real isolated probe when core safety is active, else a presence-only
 * fallback that can never itself assert authentication. Persists the result
 * and returns it — the single code path `probe` and `connect` both use so
 * their reported state can never drift apart.
 */
async function probeAndPersist(providerName: AttestableProvider, note?: string) {
  const executableName = ATTESTABLE_PROVIDERS[providerName];
  const backendProbe = isCapabilityAvailable('live-agent-execution')
    ? await majorExecutionBackend().probeProvider(executableName)
    : undefined;
  let trustedSpawnPath: string | undefined;
  if (!backendProbe) {
    try {
      trustedSpawnPath = trustedExecutableRegistry(executableName).verify(executableName).spawnPath;
    } catch (error) {
      if (!(error instanceof ExecutableTrustError)) throw error;
    }
  }
  const installed = backendProbe ? backendProbe.installed : Boolean(trustedSpawnPath);
  const authenticated = backendProbe ? backendProbe.authenticated : false;
  const detail =
    backendProbe?.detail ??
    (trustedSpawnPath
      ? `resolved at ${trustedSpawnPath} (isolated probe unavailable; presence only)`
      : `${executableName} is not installed or not trusted`);
  const opened = openDb();
  try {
    const existing = loadPersistedProviderInfos(opened.db).find((p) => p.name === providerName);
    // visible (is the model known to exist) and authenticated (is it logged
    // in) are separate dimensions: an installed-but-unauthenticated probe
    // must not also erase the installed signal. An authenticated probe is
    // exactly the "newly authorized validation attempt" that legitimately
    // clears a stale exhausted/rate-limited flag from before the owner's
    // account swap; an unauthenticated probe leaves availability alone
    // rather than guessing at it.
    const models = (existing?.models ?? []).map((m) => ({
      ...m,
      visible: installed,
      authenticated,
      ...(authenticated ? { availability: 'available' as const } : {}),
    }));
    const executablePath = backendProbe?.executable ?? trustedSpawnPath;
    const result = persistProviderDiscovery(
      opened.db,
      {
        name: providerName,
        ...(executablePath !== undefined ? { executable: executablePath } : {}),
        installed,
        authenticated,
        models,
      },
      // Only an authenticated probe is the "materially changed state" that
      // justifies bypassing backoff; a still-failing probe has observed
      // nothing new and must leave any existing backoff window intact
      // rather than silently clearing it while availability stays exhausted.
      { source: 'probe', note: note ?? detail, bypassBackoff: authenticated },
    );
    return { provider: providerName, installed, authenticated, detail, ...result };
  } finally {
    opened.sqlite.close();
  }
}

/** Reads a yes/no answer. Returns undefined (never prompts) when stdin is
 * not a real terminal, so a non-interactive caller gets an explicit
 * "confirmation required" result instead of a hang or a guessed answer. */
async function confirm(question: string): Promise<boolean | undefined> {
  if (!process.stdin.isTTY) return undefined;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [Y/n] `)).trim().toLowerCase();
    return answer === '' || answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

/** Reads a numbered choice. Returns undefined (never prompts) when stdin is
 * not a real terminal, or when the answer isn't one of the offered numbers —
 * same fail-closed shape as confirm(). */
async function promptChoice(question: string, options: string[]): Promise<number | undefined> {
  if (!process.stdin.isTTY) return undefined;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(question);
    options.forEach((option, index) => console.log(`  [${index + 1}] ${option}`));
    const answer = (await rl.question('> ')).trim();
    const choice = Number(answer);
    return Number.isInteger(choice) && choice >= 1 && choice <= options.length ? choice : undefined;
  } finally {
    rl.close();
  }
}

const BILLING_PROMPT_OPTIONS: ReadonlyArray<{
  label: string;
  mode: Exclude<BillingMode, 'unknown'> | null;
}> = [
  { label: 'Included in my subscription', mode: 'subscription_included' },
  { label: 'Usage credits / metered', mode: 'usage_credits' },
  { label: 'API billing', mode: 'api_billing' },
  { label: "I don't know", mode: null },
];

/**
 * After a provider becomes authenticated, the minimum evidence Major needs to
 * route it safely is its billing mode — never inferred, never defaulted to a
 * paid mode. If there's nothing left with billingMode 'unknown', there is
 * nothing to ask. If non-interactive (or the user picks "I don't know"),
 * this reports what to run later rather than guessing or silently
 * authorizing anything.
 */
async function promptBillingIfNeeded(providerName: AttestableProvider): Promise<void> {
  const opened = openDb();
  let modelRef: string | undefined;
  try {
    const info = loadPersistedProviderInfos(opened.db).find((p) => p.name === providerName);
    modelRef = info?.models.find((m) => m.billingMode === 'unknown')?.modelRef;
  } finally {
    opened.sqlite.close();
  }
  if (!modelRef) return;
  const choice = await promptChoice(
    `How is this ${providerName} account used?`,
    BILLING_PROMPT_OPTIONS.map((o) => o.label),
  );
  if (choice === undefined) {
    console.log(
      JSON.stringify(
        {
          provider: providerName,
          status: 'billing-confirmation-required',
          action: `major provider attest-billing --provider ${providerName} --model ${modelRef} --billing <mode> --evidence "<how you know>"`,
        },
        null,
        2,
      ),
    );
    return;
  }
  const selected = BILLING_PROMPT_OPTIONS[choice - 1]!;
  if (selected.mode === null) return; // "I don't know" — leave billingMode unknown, ask again later
  const persisted = openDb();
  try {
    recordBillingObservation(persisted.db, {
      providerName,
      modelRef,
      billingMode: selected.mode,
      source: 'human',
      note: 'confirmed interactively during major provider connect',
    });
  } finally {
    persisted.sqlite.close();
  }
}

const PROVIDER_HELP = `Usage: major provider <command> [options]

Commands:
  status                                             list persisted provider/model state
  usage [--json]                                     read current capacity from existing Codex accounts;
                                                      persists a masked snapshot for status/session attach
  sync-profiles [--json]                             import approved Codex policy profiles into named
                                                      provider-auth slots and persist codex#label routing
  connect <name> [--yes|--no] [--relogin]             onboard a provider: reuse a host login if one exists and is
                                                      version-compatible, else fall back to native sign-in
                                                      (--provider <name> also accepted; --relogin re-authenticates
                                                      even when already READY)
  probe --provider <name>                            re-check a provider through the isolated runner (e.g. after an account swap)
  attest-billing --provider <p> --model <m> --billing <mode> --evidence <text>
                                                      record the owner-confirmed billing mode for a model
  attest-availability --provider <p> --model <m> --evidence <text>
                                                      record an owner-confirmed installed+authenticated observation
  help                                               show this message

<name>/<p> is one of: claude-code, codex, cursor, antigravity
<mode> is one of: subscription_included, usage_credits, api_billing
`;

export async function runProviderLifecycleCli(args: string[]): Promise<boolean> {
  if (args[0] !== 'provider') return false;
  if (args[1] === undefined || args[1] === '--help' || args[1] === '-h' || args[1] === 'help') {
    console.log(PROVIDER_HELP);
    return true;
  }
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
  if (args[1] === 'usage') {
    const approved = await readApprovedCodexProfileUsage();
    if (approved) {
      writeCodexUsageReport(approved);
      if (args.includes('--json')) console.log(JSON.stringify(approved, null, 2));
      else console.log(formatCodexUsage(approved));
      return true;
    }
    const opened = openDb();
    let labels: string[] = [];
    try {
      labels = authenticatedCodexAccountLabels(loadPersistedProviderInfos(opened.db));
    } finally {
      opened.sqlite.close();
    }
    let accounts: CodexUsageAccount[];
    try {
      accounts = labels.length === 0 ? [] : await majorExecutionBackend().readCodexUsage(labels);
    } catch (error) {
      const detail = redactCodexUsageText(error instanceof Error ? error.message : String(error));
      accounts = labels.map((accountLabel) => ({ accountLabel, error: detail }));
    }
    const report = codexUsageReport(accounts);
    writeCodexUsageReport(report);
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else console.log(formatCodexUsage(report));
    return true;
  }
  if (args[1] === 'sync-profiles') {
    const opened = openDb();
    try {
      const report = await syncApprovedCodexProfiles(majorExecutionBackend(), opened.db);
      if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
      else if (report.error && report.profiles.length === 0) {
        console.log(`Codex profile sync failed: ${report.error}`);
      } else {
        for (const profile of report.profiles) {
          const availability = profile.availability ?? 'unknown';
          console.log(
            `${profile.policyId}\t${profile.accountLabel}\t${profile.imported ? 'imported' : 'skipped'}\t${availability}\t${profile.detail}`,
          );
        }
        if (report.error) console.log(`warning: ${report.error}`);
      }
      if (report.error) process.exitCode = 1;
    } finally {
      opened.sqlite.close();
    }
    return true;
  }
  if (args[1] === 'connect') {
    // Self-service onboarding, in priority order: (1) if already genuinely
    // READY, do nothing; (2) reuse a host login if one exists AND is proven
    // version-compatible with the worker's own copy; (3) otherwise fall
    // back to the provider's own native login inside the isolated worker
    // (currently verified only for Codex — see provider-profile.ts's
    // loginArgs). None of this requires Workshop, a Secure Enclave lease,
    // or M1 authority; see docs/readiness-model.md.
    const providerArg =
      flag(args, '--provider') ?? (args[2] && !args[2].startsWith('-') ? args[2] : undefined);
    if (!providerArg)
      throw new Error('missing required --provider (or: major provider connect <name>)');
    const providerName = attestableProvider(providerArg);
    const host = PROVIDER_TO_HOST[providerName];
    const executableName = ATTESTABLE_PROVIDERS[providerName];
    const assumeYes = args.includes('--yes') || args.includes('-y');
    const assumeNo = args.includes('--no');
    const relogin = args.includes('--relogin') || args.includes('--force');

    // Step 1: never touch a credential that's already genuinely working.
    if (!relogin) {
      const opened = openDb();
      let currentState: string | undefined;
      try {
        const info = loadPersistedProviderInfos(opened.db).find((p) => p.name === providerName);
        currentState = info ? computeProviderReadiness(info).state : undefined;
      } finally {
        opened.sqlite.close();
      }
      if (currentState === 'READY') {
        const result = await probeAndPersist(providerName, 'connect: already ready, re-confirmed');
        console.log(JSON.stringify({ ...result, status: 'already-ready' }, null, 2));
        return true;
      }
    }

    // Step 2: host-credential reuse, gated by proven version compatibility.
    const check = checkHostCredential(host);
    let hostReuseSucceeded = false;
    let fallbackReason: string | undefined;
    if (check.status === 'not-found') {
      fallbackReason = `no host login found for ${providerName} (${check.detail})`;
    } else if (check.status === 'unsafe') {
      fallbackReason = check.detail;
    } else {
      let hostVersion: string | undefined;
      try {
        hostVersion = hostProviderVersion(
          trustedExecutableRegistry(executableName).verify(executableName).spawnPath,
        );
      } catch {
        hostVersion = undefined;
      }
      const guestProbe = isCapabilityAvailable('live-agent-execution')
        ? await majorExecutionBackend().probeProvider(executableName)
        : undefined;
      const guestVersion = guestProbe?.version;
      const compatibility =
        hostVersion && guestVersion
          ? hostVersion === guestVersion
            ? 'compatible'
            : 'not compatible'
          : 'unknown';
      console.log(
        JSON.stringify(
          {
            provider: providerName,
            hostVersion: hostVersion ?? 'unknown',
            majorVersion: guestVersion ?? 'unknown',
            credentialReuse: compatibility,
          },
          null,
          2,
        ),
      );
      if (compatibility === 'not compatible') {
        fallbackReason = 'Host login cannot be safely reused.';
      } else {
        const fingerprint = fingerprintCredentialFile(check.path);
        const opened = openDb();
        let existingFingerprint: string | null;
        try {
          existingFingerprint = getCredentialFingerprint(opened.db, providerName);
        } finally {
          opened.sqlite.close();
        }
        if (existingFingerprint === fingerprint) {
          hostReuseSucceeded = true;
        } else {
          const question = existingFingerprint
            ? `A different ${providerName} credential is available on this Mac (${check.path}). Replace the active Major credential?`
            : `${providerName} is already authenticated on this Mac (${check.path}). Reuse this login inside Major's isolated worker?`;
          let proceed: boolean | undefined = assumeYes ? true : assumeNo ? false : undefined;
          if (proceed === undefined) proceed = await confirm(question);
          if (proceed === undefined) {
            // Genuinely ambiguous (no --yes/--no, non-interactive): ask
            // again rather than guess — this is the one case that does NOT
            // fall through to native login automatically.
            console.log(
              JSON.stringify(
                {
                  provider: providerName,
                  status: 'confirmation-required',
                  path: check.path,
                  changed: existingFingerprint !== null,
                  action:
                    'rerun with --yes to reuse this login, or --no to fall back to native sign-in',
                },
                null,
                2,
              ),
            );
            return true;
          }
          if (!proceed) {
            fallbackReason = 'declined reusing the host login.';
          } else {
            const imported = await majorExecutionBackend().importProviderCredential(
              host,
              check.path,
            );
            if (imported.ok) {
              const persisted = openDb();
              try {
                setCredentialFingerprint(persisted.db, providerName, fingerprint);
              } finally {
                persisted.sqlite.close();
              }
              hostReuseSucceeded = true;
            } else {
              fallbackReason = `host login import failed: ${imported.detail}`;
            }
          }
        }
      }
    }

    if (hostReuseSucceeded) {
      const result = await probeAndPersist(providerName, 'connect: imported host credential');
      if (result.authenticated) {
        console.log(JSON.stringify(result, null, 2));
        await promptBillingIfNeeded(providerName);
        return true;
      }
      fallbackReason = 'the imported host credential did not result in a working connection.';
    }

    // Step 3: provider-native login. Never a dead end for a provider whose
    // login flow is verified — see step 2's every path into fallbackReason.
    console.log(
      `${fallbackReason ?? 'starting native sign-in.'} Starting isolated ${providerName} login...`,
    );
    const login = await majorExecutionBackend().loginProviderNative(host, (line) =>
      console.log(line),
    );
    if (!login.ok) {
      console.log(
        JSON.stringify(
          { provider: providerName, status: 'login-failed', detail: login.detail },
          null,
          2,
        ),
      );
      return true;
    }
    const result = await probeAndPersist(providerName, 'connect: provider-native login');
    console.log(JSON.stringify(result, null, 2));
    await promptBillingIfNeeded(providerName);
    return true;
  }
  if (args[1] === 'probe') {
    // A cheap, explicit re-check — the supported path for "I switched
    // accounts, is the provider ready now?" (see docs/readiness-model.md).
    // Unlike routine discovery, this is a deliberate owner action: it may
    // observe a materially changed auth state sooner than the passive
    // backoff window would otherwise allow, and it never requires a new
    // release, a database edit or re-running M1 field validation.
    const providerName = attestableProvider(required(args, '--provider'));
    console.log(JSON.stringify(await probeAndPersist(providerName), null, 2));
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
  // args[0] === 'provider' but args[1] matched no known subcommand: this is
  // definitely a provider-command typo, not some other CLI's command, so
  // report it here rather than falling through to an unrelated dispatcher's
  // misleading "unknown command" error.
  throw new Error(`unknown provider subcommand: ${args[1]}\n\n${PROVIDER_HELP}`);
}
