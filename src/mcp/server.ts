import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerMajorMessage, buildMajorDashboard, type MajorDashboard } from '../ui/dashboard.js';
import {
  buildContextPack,
  CONTEXT_PACK_SECTIONS,
  type ContextPackDetail,
  type ContextPackSection,
} from '../context/context-pack.js';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_VERSION = '0.5.3';

type JsonRpcId = string | number | null;

export interface MajorMcpRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface MajorMcpResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string };
}

const TOOLS = [
  {
    name: 'major_context',
    description:
      'Read a bounded, evidence-labelled Major context pack. Start with summary or selected sections; request more detail only when needed.',
    inputSchema: {
      type: 'object',
      properties: {
        detail: { type: 'string', enum: ['summary', 'standard', 'full'], default: 'standard' },
        sections: {
          type: 'array',
          items: { type: 'string', enum: CONTEXT_PACK_SECTIONS },
          uniqueItems: true,
        },
        maxBytes: { type: 'integer', minimum: 2_000, maximum: 64_000, default: 16_000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'major_ask',
    description:
      'Ask a bounded question answered from Major’s current project context and durable run-insight history.',
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string', minLength: 1, maxLength: 2_000 } },
      required: ['question'],
      additionalProperties: false,
    },
  },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function response(id: JsonRpcId, result: unknown): MajorMcpResponse {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id: JsonRpcId, code: number, message: string): MajorMcpResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function compactHistory(dashboard: MajorDashboard) {
  return {
    runs: dashboard.history.runs,
    timeSpent: dashboard.history.timeSpent,
    overhead: dashboard.history.overhead,
    bestWorker: dashboard.history.bestWorker,
    bestWorkerEvidence: dashboard.history.bestWorkerEvidence,
    latestChange: dashboard.history.latestChange,
    repeatedFailures: dashboard.history.repeatedFailures,
    skillPerformance: dashboard.history.skillPerformance,
    humanInterventions: dashboard.history.humanInterventions,
    reuse: dashboard.history.reuse,
    recurrence: dashboard.history.recurrence,
    recentRuns: dashboard.recentRuns,
  };
}

/** Serialize the stable zero-argument context contract without reading global Major state. */
export function serializeLegacyContext(dashboard: MajorDashboard) {
  return {
    schemaVersion: 1,
    kind: 'major.context.v1',
    project: dashboard.project,
    objective: dashboard.objective,
    gbrain: dashboard.gbrain,
    context: dashboard.context,
    execution: dashboard.execution,
    skills: dashboard.skills,
    providers: dashboard.providers,
    workers: dashboard.workers,
    history: compactHistory(dashboard),
  };
}

function isContextPackDetail(value: unknown): value is ContextPackDetail {
  return (
    typeof value === 'string' &&
    (['summary', 'standard', 'full'] as readonly string[]).includes(value)
  );
}

function textToolResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}

/** Resolve the optional explicit working directory used by clients that do not pass workspace roots. */
export function resolveMajorMcpCwd(args: readonly string[], baseCwd = process.cwd()): string {
  if (args.length === 0) return resolve(baseCwd);
  if (args.length === 2 && args[0] === '--cwd' && args[1]?.trim()) {
    return resolve(baseCwd, args[1]);
  }
  throw new Error('usage: major mcp serve [--cwd <repo>]');
}

function rootPathFromResult(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.roots)) return undefined;
  for (const root of value.roots) {
    if (!isRecord(root) || typeof root.uri !== 'string') continue;
    try {
      if (new URL(root.uri).protocol === 'file:') return resolve(fileURLToPath(root.uri));
    } catch {
      // Ignore malformed or non-local roots and fall back to the explicit/default cwd.
    }
  }
  return undefined;
}

function requestArguments(request: MajorMcpRequest): Record<string, unknown> {
  const args = request.params?.arguments;
  if (args === undefined) return {};
  if (!isRecord(args)) throw new Error('tool arguments must be an object');
  return args;
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  cwd: string,
): Promise<ReturnType<typeof textToolResult>> {
  if (name === 'major_context') {
    const dashboard = await buildMajorDashboard(cwd);
    // Preserve the original Cursor/client contract. Progressive disclosure is
    // opt-in through any of the new arguments, so existing callers do not need
    // a synchronized migration. Context packs intentionally remain
    // manifest/selection-only: skill bodies are execution instructions and
    // are disclosed by the canonical resolver only after a goal is routed.
    if (Object.keys(args).length === 0) return textToolResult(serializeLegacyContext(dashboard));
    const detail = args.detail ?? 'standard';
    const sections = args.sections ?? CONTEXT_PACK_SECTIONS;
    const maxBytes = args.maxBytes ?? 16_000;
    if (!isContextPackDetail(detail)) {
      return textToolResult({ error: 'detail must be summary, standard, or full' }, true);
    }
    if (
      !Array.isArray(sections) ||
      sections.some((section) => !CONTEXT_PACK_SECTIONS.includes(section as ContextPackSection))
    ) {
      return textToolResult({ error: 'sections contains an unknown context-pack section' }, true);
    }
    if (
      typeof maxBytes !== 'number' ||
      !Number.isInteger(maxBytes) ||
      maxBytes < 2_000 ||
      maxBytes > 64_000
    ) {
      return textToolResult({ error: 'maxBytes must be an integer from 2,000 to 64,000' }, true);
    }
    return textToolResult(
      buildContextPack(dashboard, {
        detail,
        sections: sections as readonly ContextPackSection[],
        maxBytes,
      }),
    );
  }
  if (name === 'major_ask') {
    const question = args.question;
    if (typeof question !== 'string' || question.trim().length === 0 || question.length > 2_000) {
      return textToolResult(
        { error: 'question must be a non-empty string of at most 2,000 characters' },
        true,
      );
    }
    const result = await answerMajorMessage(question.trim(), cwd);
    return textToolResult({
      schemaVersion: 1,
      kind: 'major.answer.v1',
      answer: result.answer,
      project: result.dashboard.project,
      gbrain: result.dashboard.gbrain,
      skills: result.dashboard.skills,
      history: compactHistory(result.dashboard),
    });
  }
  return textToolResult({ error: `unknown Major tool: ${name}` }, true);
}

/** Handle one MCP JSON-RPC request. Notifications return undefined. */
export async function handleMajorMcpRequest(
  request: MajorMcpRequest,
  cwd = process.cwd(),
): Promise<MajorMcpResponse | undefined> {
  const id = request.id ?? null;
  if (request.id === undefined) return undefined;
  if (request.jsonrpc !== undefined && request.jsonrpc !== '2.0') {
    return errorResponse(id, -32600, 'jsonrpc must be 2.0');
  }
  if (typeof request.method !== 'string') return errorResponse(id, -32600, 'method is required');

  try {
    switch (request.method) {
      case 'initialize':
        return response(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'major', version: SERVER_VERSION },
          instructions:
            'Major is the durable project context, policy and run-insight layer. Use major_context before bounded work.',
        });
      case 'ping':
        return response(id, {});
      case 'tools/list':
        return response(id, { tools: TOOLS });
      case 'tools/call': {
        const name = request.params?.name;
        if (typeof name !== 'string')
          return errorResponse(id, -32602, 'tools/call requires a tool name');
        return response(id, await callTool(name, requestArguments(request), cwd));
      }
      case 'resources/list':
        return response(id, { resources: [] });
      case 'prompts/list':
        return response(id, { prompts: [] });
      case 'shutdown':
        return response(id, null);
      default:
        return errorResponse(id, -32601, `method not found: ${request.method}`);
    }
  } catch (error) {
    return errorResponse(id, -32603, error instanceof Error ? error.message : String(error));
  }
}

/** Run the standard newline-delimited stdio MCP server used by Cursor. */
export async function runMajorMcpServer(cwd = process.cwd()): Promise<void> {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let clientSupportsRoots = false;
  let rootCwd: string | undefined;
  let pendingRoots:
    | {
        id: string;
        promise: Promise<string | undefined>;
        resolve: (cwd: string | undefined) => void;
      }
    | undefined;
  let nextRequestId = 1;

  const requestRoots = (): void => {
    if (pendingRoots || !clientSupportsRoots) return;
    let resolveRoots!: (cwd: string | undefined) => void;
    const promise = new Promise<string | undefined>((resolvePromise) => {
      resolveRoots = resolvePromise;
    });
    const id = `major-roots-${nextRequestId++}`;
    pendingRoots = { id, promise, resolve: resolveRoots };
    const timeout = setTimeout(() => {
      if (pendingRoots?.id !== id) return;
      pendingRoots = undefined;
      resolveRoots(undefined);
    }, 1_500);
    promise.then(
      () => clearTimeout(timeout),
      () => clearTimeout(timeout),
    );
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'roots/list' })}\n`);
  };

  const processRequest = async (request: MajorMcpRequest): Promise<void> => {
    if (request.method === 'initialize') {
      const capabilities = request.params?.capabilities;
      clientSupportsRoots = isRecord(capabilities) && isRecord(capabilities.roots);
    }
    if (request.method === 'notifications/initialized') requestRoots();
    if (request.method === 'notifications/roots/list_changed') {
      rootCwd = undefined;
      requestRoots();
    }
    if (request.method === 'tools/call' && pendingRoots) rootCwd = await pendingRoots.promise;
    const result = await handleMajorMcpRequest(request, rootCwd ?? cwd);
    if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
  };

  let queue = Promise.resolve();
  for await (const line of input) {
    if (!line.trim()) continue;
    let request: MajorMcpRequest;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) throw new Error('request must be a JSON object');
      request = parsed;
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify(errorResponse(null, -32700, error instanceof Error ? error.message : String(error)))}\n`,
      );
      continue;
    }
    if (
      pendingRoots &&
      request.id === pendingRoots.id &&
      request.method === undefined &&
      (request.result !== undefined || request.error !== undefined)
    ) {
      const resolver = pendingRoots.resolve;
      pendingRoots = undefined;
      rootCwd = request.error ? undefined : rootPathFromResult(request.result);
      resolver(rootCwd);
      continue;
    }
    queue = queue.then(() => processRequest(request));
  }
  await queue;
}
