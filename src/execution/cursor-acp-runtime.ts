import { spawn, type ChildProcess } from 'node:child_process';
import { dirname } from 'node:path';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import type { AgentRuntimePort, AgentRuntimeRequest, AgentRuntimeResult } from './agent-runtime.js';
import type { LimaExecutionConfig } from './lima-config.js';
import { guestProviderProfile } from './provider-profile.js';
import {
  decideProviderAction,
  providerActionDigest,
  type ProviderAction,
  type ProviderApprovalAuthority,
  type ProviderApprovalDecision,
  type ProviderActionKind,
} from '../security/provider-approval-policy.js';

type ChildObserver = (child: ChildProcess | undefined) => void;

type ModelOption = Extract<acp.SessionConfigOption, { type: 'select' }>;

export function decideCursorPermission(
  action: ProviderAction,
  authority: ProviderApprovalAuthority,
  remainingDecisions: ProviderApprovalAuthority['decisions'][number][],
  workshopMode = false,
): ProviderApprovalDecision {
  const decision = decideProviderAction({
    host: 'cursor',
    action,
    authority: { ...authority, decisions: remainingDecisions },
    workshopMode,
  });
  if (decision.outcome === 'automatic') {
    const approvedIndex = remainingDecisions.findIndex(
      (approved) => approved.actionDigest === providerActionDigest(action),
    );
    if (approvedIndex >= 0) remainingDecisions.splice(approvedIndex, 1);
  }
  return decision;
}

function selectValues(option: ModelOption): Array<{ value: string; name: string }> {
  return option.options.flatMap((entry) =>
    'options' in entry ? entry.options.map(({ value, name }) => ({ value, name })) : [entry],
  );
}

/** ACP categories are a hint, so fall back to the stable option id/name for older agents. */
export function cursorModelOption(
  options: readonly acp.SessionConfigOption[] | null | undefined,
): ModelOption | undefined {
  return options?.find(
    (option): option is ModelOption =>
      option.type === 'select' &&
      (option.category === 'model' ||
        /(^|[^a-z])model([^a-z]|$)/i.test(`${option.id} ${option.name}`)),
  );
}

export function cursorModelValue(
  option: ModelOption,
  requestedModel: string,
): { value: string; name: string } | undefined {
  const wanted = requestedModel.trim().toLowerCase();
  return selectValues(option).find(
    ({ value, name }) => value.toLowerCase() === wanted || name.toLowerCase() === wanted,
  );
}

function selectedModel(option: ModelOption | undefined): string | undefined {
  if (!option) return undefined;
  const selected = selectValues(option).find(({ value }) => value === option.currentValue);
  return selected?.name ?? option.currentValue;
}

/** First-party Cursor ACP v1 adapter. Major owns policy, VM and copy-back. */
export class CursorAcpRuntime implements AgentRuntimePort {
  constructor(
    private readonly config: LimaExecutionConfig,
    private readonly observeChild: ChildObserver,
  ) {}

  async execute(request: AgentRuntimeRequest): Promise<AgentRuntimeResult> {
    if (request.host !== 'cursor') throw new Error(`Cursor ACP cannot execute ${request.host}`);
    const profile = guestProviderProfile('cursor-agent');
    const guestHome = request.guestHome;
    const child = spawn(
      this.config.limactlPath,
      [
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        '-n',
        '-u',
        profile.user,
        'env',
        '-i',
        `HOME=${guestHome}`,
        `USER=${profile.user}`,
        `LOGNAME=${profile.user}`,
        `TMPDIR=${guestHome}/tmp`,
        `XDG_CACHE_HOME=${guestHome}/.cache`,
        `XDG_CONFIG_HOME=${guestHome}/.config`,
        `XDG_DATA_HOME=${guestHome}/.local/share`,
        `PATH=${dirname(profile.executable)}:/usr/bin:/bin`,
        profile.executable,
        'acp',
      ],
      { shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.observeChild(child);
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });
    const text: string[] = [];
    let activeSessionId: string | undefined;
    let context: acp.ClientContext | undefined;
    const signalTransport = (signal: NodeJS.Signals) => {
      try {
        if (typeof child.pid === 'number') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // The transport may already have exited.
      }
    };
    const abort = () => {
      if (context && activeSessionId) {
        void context.notify(acp.methods.agent.session.cancel, { sessionId: activeSessionId });
      }
      signalTransport('SIGTERM');
    };
    request.abortSignal.addEventListener('abort', abort, { once: true });
    const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
    const remainingDecisions = [...request.approvalAuthority.decisions];
    try {
      const result = await acp
        .client({ name: 'major' })
        .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
          if (!request.allowGuestMutation) {
            return { outcome: { outcome: 'cancelled' as const } };
          }
          const action = {
            kind: (params.toolCall.kind ?? 'unknown') as ProviderActionKind,
            ...(params.toolCall.name ? { name: params.toolCall.name } : {}),
            ...(params.toolCall.title ? { title: params.toolCall.title } : {}),
            ...(params.toolCall.rawInput !== undefined
              ? { rawInput: params.toolCall.rawInput }
              : {}),
          };
          const decision = decideCursorPermission(
            action,
            request.approvalAuthority,
            remainingDecisions,
            request.workshopMode === true,
          );
          request.emit({
            type: 'approval-decision',
            data: {
              toolCallId: params.toolCall.toolCallId,
              actionDigest: providerActionDigest(action),
              ...decision,
            },
          });
          if (decision.outcome !== 'automatic') {
            return { outcome: { outcome: 'cancelled' as const } };
          }
          const selected = params.options.find((option) => option.kind === 'allow_once');
          return selected
            ? { outcome: { outcome: 'selected' as const, optionId: selected.optionId } }
            : { outcome: { outcome: 'cancelled' as const } };
        })
        .onNotification(acp.methods.client.session.update, ({ params }) => {
          request.emit({ type: 'acp-session-update', data: params.update });
          const update = params.update as { sessionUpdate?: string; content?: { text?: string } };
          if (update.sessionUpdate === 'agent_message_chunk' && update.content?.text) {
            text.push(update.content.text);
          }
        })
        .connectWith(stream, async (ctx) => {
          context = ctx;
          const initialized = await ctx.request(acp.methods.agent.initialize, {
            protocolVersion: acp.PROTOCOL_VERSION,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
          });
          if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
            throw new Error(`Cursor ACP protocol mismatch: ${initialized.protocolVersion}`);
          }
          let configOptions: acp.SessionConfigOption[] | null | undefined;
          if (request.resumeSessionRef) {
            activeSessionId = request.resumeSessionRef;
            const loaded = await ctx.request(acp.methods.agent.session.load, {
              sessionId: activeSessionId,
              cwd: request.guestWorkspace,
              mcpServers: [],
            });
            configOptions = loaded.configOptions;
          } else {
            const created = await ctx.request(acp.methods.agent.session.new, {
              cwd: request.guestWorkspace,
              mcpServers: [],
            });
            activeSessionId = created.sessionId;
            configOptions = created.configOptions;
          }
          let modelOption = cursorModelOption(configOptions);
          const requestedModel =
            request.modelRef && request.modelRef !== 'auto' ? request.modelRef : undefined;
          if (requestedModel) {
            if (!modelOption) {
              throw new Error('Cursor ACP does not expose model selection for this session');
            }
            const selected = cursorModelValue(modelOption, requestedModel);
            if (!selected) {
              throw new Error(`Cursor ACP model is unavailable: ${requestedModel}`);
            }
            const configured = await ctx.request(acp.methods.agent.session.setConfigOption, {
              sessionId: activeSessionId,
              configId: modelOption.id,
              value: selected.value,
            });
            modelOption = cursorModelOption(configured.configOptions);
            if (!modelOption || modelOption.currentValue !== selected.value) {
              throw new Error(`Cursor ACP did not confirm requested model: ${requestedModel}`);
            }
          }
          request.emit({
            type: 'provider-capabilities',
            data: { modelSelection: modelOption ? 'supported' : 'unsupported' },
          });
          const actualModel = selectedModel(modelOption);
          if (actualModel) request.emit({ type: 'provider-model', data: { actualModel } });
          const response = await ctx.request(acp.methods.agent.session.prompt, {
            sessionId: activeSessionId,
            prompt: [{ type: 'text', text: request.prompt }],
          });
          return {
            response,
            sessionId: activeSessionId,
            modelSelection: modelOption ? ('supported' as const) : ('unsupported' as const),
            ...(requestedModel ? { requestedModel } : {}),
            ...(actualModel ? { actualModel } : {}),
          };
        });
      const stdout = text.join('');
      request.emit({ type: 'provider-text', data: stdout });
      request.emit({ type: 'provider-result', data: result.response });
      const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
      child.stdin.end();
      await Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, 500))]);
      if (child.exitCode === null) signalTransport('SIGTERM');
      await Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
      if (child.exitCode === null) signalTransport('SIGKILL');
      return {
        exitCode: 0,
        stdout,
        stderr,
        sessionRef: result.sessionId,
        modelSelection: result.modelSelection,
        ...(result.requestedModel ? { requestedModel: result.requestedModel } : {}),
        ...(result.actualModel ? { actualModel: result.actualModel } : {}),
      };
    } finally {
      request.abortSignal.removeEventListener('abort', abort);
      if (child.exitCode === null) signalTransport('SIGKILL');
      this.observeChild(undefined);
    }
  }
}
