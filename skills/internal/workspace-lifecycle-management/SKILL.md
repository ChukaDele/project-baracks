---
name: workspace-lifecycle-management
description: Use when creating, cloning, locating, moving, parking, deleting or archiving a project; when disk/storage pressure is high; when duplicate local project copies appear; when deciding local vs cloud development; or when handling large project assets, dependency caches and Docker storage. Preserve canonical project identity and non-Git state while keeping the Mac as a lean active workspace.
---

# Workspace Lifecycle Management

Major should keep the development machine lean **without losing project truth**.

## Prime model

For this machine:

- Mac = active workspace;
- GitHub = canonical source code after commit/push verification;
- Vercel/Cloudflare/etc. = deployment/runtime;
- cloud/external storage = large assets, archives and backups.

The laptop should be replaceable. No important project exists only on the Mac.

## First: resolve the project

Before clone/move/delete/park/archive actions, load `project-context-integrity`.

- Locate the existing project/remote before creating another copy.
- Do not create `project-new`, `project-final`, `project-fixed` or another nested clone because the expected path is missing.
- Git provides version history; Finder folders do not.
- If a project is already registered at another path, use the canonical path or deliberately migrate/update the registration.

## HOT / WARM / COLD

### HOT

Genuinely active local projects. Keep fully usable on the internal SSD.

For Chuka's current machine, target roughly **5–8 active local repos**. This is an operating target, not a hard execution gate.

Prefer a dedicated non-iCloud code directory such as `~/Developer/` over iCloud-synced Documents for future organization. Do not mass-move healthy active projects solely to satisfy the convention; migrate paths deliberately and update Major/project integrations.

### WARM

Canonical repo on GitHub, no permanent local clone required. Re-clone and reinstall dependencies when needed.

A parked live project does not need its GitHub repository marked Archived.

### COLD

Large/non-source state belongs in secure cloud/external storage where appropriate: source media, Veo/Flow output, large QA captures, reference assets, datasets, DB dumps, design exports, old builds and archives.

Keep standard Git repos focused on source plus the minimum production assets required to reproduce/test/deploy the application. Use Git LFS only when intentional binary versioning is actually needed.

## Safe parking protocol

Never equate `repo exists on GitHub` with `safe to delete locally`.

Before deleting a local clone:

1. confirm project identity and remote;
2. `git status`;
3. `git fetch`;
4. verify local branch vs remote;
5. verify there are no local-only commits;
6. inspect untracked/ignored files;
7. identify non-Git state;
8. back up required non-Git state appropriately;
9. only then remove reconstructible artifacts or the clone.

Non-Git state may include `.env`, local DBs, uploads, source media, design files, credentials, excluded scripts and provider-local configuration.

Never commit secrets simply to satisfy the parking checklist.

## Reconstructible artifacts

When safe, delete/rebuild instead of storing indefinitely:

- `node_modules`;
- `.next`;
- `dist` / `build`;
- `.turbo`;
- coverage/build caches;
- other manifest/lockfile-reconstructible dependencies.

Prefer pnpm for new compatible Node projects because shared package storage reduces duplicate disk use. Do not churn a healthy active project solely to switch package managers.

## Disk pressure response

For this specific machine:

- normal target: **60–80 GB free**;
- around **50 GB free**: start cleanup/demote inactive repos;
- around **30 GB free**: stop accumulating and reclaim space before heavy multi-agent/build work.

When disk pressure appears, diagnose before buying infrastructure:

1. largest project directories;
2. dependency/build folders;
3. duplicate clones;
4. Downloads/media/QA artifacts;
5. Docker images/build cache/containers;
6. package caches if materially large.

Do not infer RAM trouble from SSD use; use macOS Memory Pressure for memory decisions.

## Docker and cache safety

- inspect Docker usage before pruning;
- treat Docker volumes as data until proven otherwise;
- never run an aggressive volume prune casually;
- verify package caches before clearing; do not make cache wiping a ritual.

## Local vs cloud

Use a hybrid approach.

Prefer local for interactive UI, motion, Three.js/GSAP, visual QA, Figma-code and fast agent work. Prefer isolated/cloud environments when they materially help heavy builds, long-running jobs, reproducible backend work or rarely touched repos.

Do not move everything to paid cloud compute merely because the local storage lifecycle is unmanaged.

## Large assets

For media-heavy sites/products, separate:

- source/original/generation/archive assets → cloud/external storage;
- compressed optimized assets actually needed by the application → repo/CDN/deployment storage as appropriate.

Avoid repositories accumulating `final.mp4`, `final2.mp4`, `final-final.mp4`, stale screenshots and unused generations.

## Lifecycle state changes

When moving a project between HOT/WARM/COLD:

- preserve canonical remote and deployment state;
- preserve necessary secrets/config through the project's approved secret-management path;
- update Major's known path if the local location changes;
- update project docs/integration paths that genuinely depend on local location;
- do not leave duplicate active clones after migration unless there is a deliberate worktree/branch reason.

## Resolver examples

### Should trigger

- "Can I delete these finished projects from my Mac now that they're on GitHub?"
- "My project folders are using 75 GB. Clean this up safely."
- "Move my active repos out of Documents without breaking Major."
- "I can't find JSS at the expected path; should I clone it again?"
- "Should this 4 GB Flow video live in the repo?"
- "Should I use Codespaces instead of keeping this project local?"

### Should not trigger

- "Fix this TypeScript error."
- "Redesign the landing page."
- "Why did this API request return 401?"

### Conflicts

- `project-context-integrity` resolves which repo/project is canonical before lifecycle mutations.
- `legacy-cleanup` owns obsolete code/config/docs inside a project; this skill owns local clone/storage lifecycle.
- `cost-control` owns paid infrastructure/model economics; this skill owns local workspace/storage hygiene.
- `remote-first-web-development` owns preview/deployment behavior, not whether a repo should remain permanently cloned.
