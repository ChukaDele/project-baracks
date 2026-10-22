import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Worker-prompt block for a repository that has a prebuilt Graphify graph
 * (`graphify update .` once per repo; see docs/speed-and-tokens.md). Empty
 * when there is no graph, so other repositories pay nothing. */
export function graphifyContext(repoPath: string): string {
  if (!existsSync(join(repoPath, 'graphify-out', 'graph.json'))) return '';
  return `REPOSITORY GRAPH (graphify-out/):
- Before broad file reads or grep sweeps, ask the prebuilt graph: \`graphify query "<question>" --budget 1500\`, \`graphify path "<A>" "<B>"\`, \`graphify explain "<concept>"\`, \`graphify affected "<symbol>"\`. Each returns a small scoped subgraph.
- If the CLI is unavailable in this workspace, read graphify-out/GRAPH_REPORT.md for orientation instead.
- The graph can lag the source: confirm any file you change by reading it. Do not rebuild or commit graphify-out/; the owner refreshes it.
`;
}
