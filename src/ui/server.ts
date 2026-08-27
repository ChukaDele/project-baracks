import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { buildMajorDashboard, answerMajorMessage } from './dashboard.js';
import { EXECUTION_PATHS, persistExecutionPath, type ExecutionPath } from '../execution/path.js';

const MAX_BODY_BYTES = 32_000;

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Major control surface</title>
<style>
:root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; background: #f5f6f8; color: #17202a; }
body { margin: 0; }
main { max-width: 1180px; margin: 0 auto; padding: 28px; }
header { display: flex; justify-content: space-between; gap: 20px; align-items: start; margin-bottom: 22px; }
h1, h2 { margin: 0 0 8px; letter-spacing: -0.02em; }
h1 { font-size: 28px; }
h2 { font-size: 17px; }
p { margin: 6px 0; color: #52606d; }
button { border: 1px solid #c7d0d9; border-radius: 7px; background: white; color: #17202a; padding: 8px 12px; cursor: pointer; }
button:hover { border-color: #52606d; }
.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
section { background: white; border: 1px solid #dfe4e8; border-radius: 10px; padding: 16px; min-width: 0; }
.wide { grid-column: span 2; }
.full { grid-column: 1 / -1; }
.value { font-size: 22px; font-weight: 650; }
.muted { color: #697783; font-size: 13px; }
.good { color: #16734a; }
.warn { color: #9a5b00; }
.bad { color: #b42318; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 7px 14px; margin: 10px 0 0; }
dt { color: #697783; }
dd { margin: 0; overflow-wrap: anywhere; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; border-bottom: 1px solid #edf0f2; padding: 8px 6px; vertical-align: top; }
th { color: #52606d; font-weight: 600; }
ul { padding-left: 19px; margin: 8px 0; }
li { margin: 5px 0; }
form { display: flex; gap: 8px; margin-top: 12px; }
input { flex: 1; border: 1px solid #c7d0d9; border-radius: 7px; padding: 9px 10px; font: inherit; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f5f6f8; border-radius: 7px; padding: 10px; font-size: 12px; }
@media (max-width: 820px) { main { padding: 16px; } .grid { grid-template-columns: 1fr; } .wide, .full { grid-column: auto; } header { display: block; } header button { margin-top: 10px; } }
</style>
</head>
<body>
<main>
<header><div><h1>Major</h1><p>Thin intelligence and control surface for the headless core.</p></div><button id="refresh">Refresh</button></header>
<div id="app"><p>Loading Major state…</p></div>
</main>
<script>
const app = document.querySelector('#app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const list = values => values && values.length ? '<ul>' + values.map(value => '<li>' + esc(value) + '</li>').join('') + '</ul>' : '<p class="muted">None recorded.</p>';
function stateClass(value) { return value === 'READY' || value === 'active' || value === 'host' ? 'good' : value === 'AUTH_REQUIRED' || value === 'blocked' ? 'warn' : ''; }
function render(data) {
  const objective = data.objective;
  const project = data.project;
  const policy = data.policy;
  const history = data.history;
  const runs = data.recentRuns || [];
  const workers = data.workers || [];
  app.innerHTML = '';
  app.insertAdjacentHTML('beforeend', '<div class="grid">' +
    '<section><h2>Current objective</h2><div class="value">' + esc(objective ? objective.status.toUpperCase() : 'NONE') + '</div><p>' + esc(objective ? objective.goal : 'No project objective is attached to this workspace.') + '</p>' + (objective && objective.ownerGate ? '<p class="warn">Owner gate: ' + esc(objective.ownerGate) + '</p>' : '') + '</section>' +
    '<section><h2>Execution boundary</h2><div class="value ' + stateClass(data.execution.selection.path) + '">' + esc(data.execution.selection.path.toUpperCase()) + '</div><dl><dt>boundary</dt><dd>' + esc(data.execution.boundary.kind) + '</dd><dt>available</dt><dd>' + esc(data.execution.boundary.available) + '</dd><dt>filesystem</dt><dd>' + esc(data.execution.boundary.filesystemIsolation) + '</dd><dt>network</dt><dd>' + esc(data.execution.boundary.networkIsolation) + '</dd></dl><div><button data-path="host">Use host path</button> <button data-path="lima">Use Lima compatibility</button></div></section>' +
    '<section><h2>Resources</h2><dl><dt>workers</dt><dd>' + esc(data.resources.workers.active) + '/' + esc(data.resources.workers.limit) + '</dd><dt>total</dt><dd>' + esc(data.resources.total.active) + '/' + esc(data.resources.total.limit) + '</dd><dt>queued</dt><dd>' + esc(data.resources.queued) + '</dd><dt>memory</dt><dd>' + esc(data.resources.memoryAvailablePercent) + '%</dd></dl></section>' +
    '<section><h2>Workers</h2>' + (workers.length ? '<ul>' + workers.map(worker => '<li><span class="' + stateClass(worker.status) + '">' + esc(worker.status) + '</span> ' + esc(worker.host) + '/' + esc(worker.provider) + (worker.account ? '/' + esc(worker.account) : '') + (worker.model ? '<br><span class="muted">' + esc(worker.model) + '</span>' : '') + '</li>').join('') + '</ul>' : '<p class="muted">No worker claims for this project.</p>') + '</section>' +
    '<section class="wide"><h2>Project and policy</h2><dl><dt>project</dt><dd>' + esc(project ? project.identity : 'none') + '</dd><dt>repo</dt><dd>' + esc(project ? project.repoPath : 'none') + '</dd><dt>trust</dt><dd>' + esc(policy ? policy.projectClass + '/' + policy.trust : 'none') + '</dd><dt>worker ceiling</dt><dd>' + esc(policy ? policy.maxWorkers : 'none') + '</dd></dl></section>' +
    '<section class="wide"><h2>GBrain and context</h2><dl><dt>status</dt><dd>' + esc(data.gbrain.status) + '</dd><dt>project brain</dt><dd>' + esc(data.gbrain.projectBrainLoaded) + '</dd><dt>retrieved memories</dt><dd>' + esc(data.gbrain.retrievedMemoryCount) + '</dd><dt>sources</dt><dd>' + esc(data.gbrain.sources.join(', ')) + '</dd></dl><h3>Memories</h3>' + list(data.context.memories) + '<h3>Decisions</h3>' + list(data.context.decisions) + '<h3>Unresolved questions</h3>' + list(data.context.unresolvedQuestions) + '</section>' +
    '<section><h2>Skills</h2><p>' + esc(data.skills.internalReachable) + '/' + esc(data.skills.internalTotal) + ' internal skills reachable</p>' + list((data.skills.selected || []).map(skill => skill.id + ' (' + skill.score + ')')) + '</section>' +
    '<section><h2>Providers</h2>' + ((data.providers || []).length ? '<ul>' + data.providers.map(provider => '<li><span class="' + stateClass(provider.state) + '">' + esc(provider.state) + '</span> ' + esc(provider.name) + '<br><span class="muted">' + esc(provider.detail) + '</span></li>').join('') + '</ul>' : '<p class="muted">No provider observations.</p>') + '</section>' +
    '<section><h2>Host integrations</h2>' + list((data.hosts || []).map(host => host.host + ': rules ' + host.rulesInstalled + ', hook ' + host.hookInstalled)) + '</section>' +
    '<section class="wide"><h2>Run history</h2><dl><dt>runs</dt><dd>' + esc(history.runs) + '</dd><dt>average duration</dt><dd>' + esc(history.timeSpent.averageDurationMs ?? 'unknown') + ' ms</dd><dt>infrastructure overhead</dt><dd>' + esc(history.overhead.infrastructureOverheadMs ?? 'unknown') + ' ms</dd><dt>best worker</dt><dd>' + esc(history.bestWorker ? history.bestWorker.worker : history.bestWorkerEvidence) + '</dd><dt>latest change</dt><dd>' + esc(history.latestChange.result) + '</dd></dl></section>' +
    '<section><h2>Repeated failures</h2>' + list((history.repeatedFailures || []).map(failure => failure.signature + ' (' + failure.occurrences + 'x)')) + '</section>' +
    '<section><h2>Learning</h2>' + list((data.learning || []).map(candidate => candidate.status + ' ' + candidate.occurrences + 'x: ' + candidate.summary)) + '</section>' +
    '<section class="full"><h2>Recent run receipts</h2>' + (runs.length ? '<table><thead><tr><th>Recorded</th><th>Worker</th><th>Outcome</th><th>Duration ms</th><th>Productive ratio</th><th>Infrastructure ms</th></tr></thead><tbody>' + runs.map(run => '<tr><td>' + esc(run.recordedAt) + '</td><td>' + esc(run.worker || 'unknown') + '</td><td>' + esc(run.outcome || 'unknown') + '</td><td>' + esc(run.durationMs ?? 'unknown') + '</td><td>' + esc(run.productiveWorkRatio ?? 'unknown') + '</td><td>' + esc(run.infrastructureOverheadMs ?? 'unknown') + '</td></tr>').join('') + '</tbody></table>' : '<p class="muted">No durable run receipts for this project.</p>') + '</section>' +
    '<section class="full"><h2>Talk to Major</h2><p class="muted">Questions are answered from the same durable dashboard data. Execution remains a separate, policy-gated CLI action.</p><form id="ask"><input name="message" placeholder="Why did the latest task take so long?" autocomplete="off"><button>Ask</button></form><pre id="answer" hidden></pre></section>' +
    '</div>');
  document.querySelector('#refresh').onclick = () => load();
  document.querySelectorAll('[data-path]').forEach(button => button.onclick = async () => { await fetch('/api/execution-path', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: button.dataset.path }) }); await load(); });
  document.querySelector('#ask').onsubmit = async event => { event.preventDefault(); const message = new FormData(event.target).get('message'); const response = await fetch('/api/message', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }) }); const result = await response.json(); const answer = document.querySelector('#answer'); answer.hidden = false; answer.textContent = result.answer || result.error || 'No answer.'; };
}
async function load() { const response = await fetch('/api/dashboard'); const data = await response.json(); if (data.error) { app.textContent = data.error; return; } render(data); }
load();
</script>
</body>
</html>`;

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer<ArrayBufferLike>[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer =
      typeof chunk === 'string'
        ? Buffer.from(chunk, 'utf8')
        : Buffer.from(chunk as Uint8Array<ArrayBufferLike>);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large');
    chunks.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function createMajorUiServer(cwd = process.cwd()): Server {
  return createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (request.method === 'GET' && url.pathname === '/') {
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          response.end(HTML);
          return;
        }
        if (request.method === 'GET' && url.pathname === '/api/dashboard') {
          sendJson(response, 200, await buildMajorDashboard(cwd));
          return;
        }
        if (request.method === 'POST' && url.pathname === '/api/message') {
          const body = await readJson(request);
          const message = typeof body.message === 'string' ? body.message.trim() : '';
          if (!message) {
            sendJson(response, 400, { error: 'message is required' });
            return;
          }
          sendJson(response, 200, await answerMajorMessage(message, cwd));
          return;
        }
        if (request.method === 'POST' && url.pathname === '/api/execution-path') {
          const body = await readJson(request);
          const path = body.path;
          if (typeof path !== 'string' || !EXECUTION_PATHS.includes(path as ExecutionPath)) {
            sendJson(response, 400, { error: 'path must be host or lima' });
            return;
          }
          sendJson(response, 200, persistExecutionPath(path as ExecutionPath));
          return;
        }
        sendJson(response, 404, { error: 'not found' });
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });
}

export async function startMajorUi(
  options: {
    cwd?: string;
    host?: string;
    port?: number;
  } = {},
): Promise<{ server: Server; url: string }> {
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error('Major UI only binds to the local machine');
  }
  const port = options.port ?? Number.parseInt(process.env.MAJOR_UI_PORT ?? '4317', 10);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('Major UI port must be an integer from 0 to 65535');
  }
  const server = createMajorUiServer(options.cwd ?? process.cwd());
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://${host}:${actualPort}`;
  console.log(`Major UI listening at ${url}`);
  return { server, url };
}
