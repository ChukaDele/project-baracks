---
name: dev-server-management
description: Use whenever starting, restarting, previewing, browser-QAing or debugging a local web development server. Allocate and reuse a stable per-project Major port instead of defaulting to shared localhost ports such as 3000/3001.
---

# Dev Server Management

Local development servers are a **machine-global shared resource**. Treat port selection as deterministic coordination, not an incidental framework default.

## Core rule

Before starting or opening a local web app:

1. resolve the current git project;
2. run `major dev port current` (or `major dev port <project>`);
3. reuse the returned stable project port;
4. if a healthy server for the same project already responds there, reuse it rather than starting another;
5. otherwise start the framework explicitly on that port;
6. browser QA must open the same assigned port;
7. never silently fall back to `3000` or `3001` when Major is available.

Do not kill another project's process merely to reclaim a convenient port.

## Framework examples

Use the project's existing package manager/scripts. Pass the Major-assigned port explicitly.

- Next.js: `pnpm dev -- --port "$PORT"`
- Vite: `pnpm dev -- --port "$PORT" --strictPort`
- Generic Node/dev server: prefer its documented `--port` flag or `PORT="$PORT"` environment variable.

Do not permanently rewrite package scripts just to change one local port unless the project deliberately wants that mapping checked into source control.

## Collision handling

If the assigned port is occupied:

- first determine whether it is the same project's healthy existing dev server;
- if yes, reuse it;
- if it belongs to another process/project, run `major dev port current --reassign` and use the newly allocated port;
- do not blindly terminate unrelated listeners.

## Acceptance evidence

A local-preview task is not complete until:

- the server is reachable on the Major-assigned port;
- the browser is pointed at that exact port;
- a refresh/reload still serves the intended project;
- no second project was displaced.

## Learning / filing

The port number itself is machine-local operational state and must not be promoted into global knowledge. The reusable global lesson is the allocation procedure.

## Resolver examples

### Should trigger

- "Start the Bredge site locally and open it in the browser."
- "Run browser QA on the JSS dev server without colliding with my other localhost apps."
- "The app is already on localhost:3001 but another project uses that port; fix the dev environment."

### Should not trigger

- "What TCP port does PostgreSQL normally use?"
- "Explain what localhost means."
- "Deploy this Vercel preview to production."

### Conflicts

- `webapp-testing` / `playwright` own browser test technique; this skill owns the local server/port lifecycle those tests depend on.
- `root-cause-qa` owns diagnosis of a broken app; this skill owns deterministic local-server coordination.
