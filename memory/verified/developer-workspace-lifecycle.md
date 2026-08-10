# Verified developer workspace lifecycle — Chuka's Mac

## Why this exists

Chuka develops many products/websites concurrently on a MacBook M3 Pro with constrained internal SSD capacity. The machine should be treated as a replaceable active workspace, not the only durable home of projects or large assets.

This is a **machine/workspace operating policy**, not a universal rule for every developer. It should be retrieved when Major is creating/cloning/parking/archiving projects, diagnosing disk pressure, choosing local vs cloud development, handling large assets, or preventing duplicate local project copies.

## Core storage model

- **Mac = active workspace.**
- **GitHub = canonical source code**, but only after the actual local Git state is verified as committed/pushed.
- **Vercel/Cloudflare/etc. = deployment/runtime.**
- **Cloud/external storage = large assets, source media, archives and backups.**

The laptop should be replaceable. No important project should exist only on the Mac.

## HOT / WARM / COLD project lifecycle

### HOT — local internal SSD

Keep only genuinely active repositories fully hydrated locally.

Target operating range for this machine: **roughly 5–8 active local repos**, not a hard safety limit. Active repos may contain dependencies, build caches and local development data required for current work.

Preferred long-term code home: a non-iCloud local development directory such as `~/Developer/` with clear active/experiments/scratch organization. **Do not automatically move an existing active repo merely to satisfy this convention.** First verify Major/project registrations, remotes, integrations and paths, then migrate deliberately and update canonical paths.

Avoid Finder-style versioning such as `website-new`, `website-final`, `website-fixed`, `final-final`. Git branches/commits are the version history.

### WARM — GitHub

Projects that are occasionally needed do not require a permanent local clone.

Rehydrate by cloning the canonical repo and reconstructing dependencies from the lockfile/package manifest. When the work is complete, commit/push and park/delete the local clone if appropriate.

Do **not** archive a live GitHub repository merely because it has no current local clone. GitHub archive is for genuinely retired/read-only repositories, not ordinary parking.

### COLD — cloud/external storage

Store large non-source artifacts outside normal Git unless they are intentionally versioned with a suitable mechanism such as Git LFS.

Examples:

- raw/source videos;
- Veo/Flow generations;
- large screenshots/QA captures;
- Figma/design exports;
- reference assets;
- datasets;
- database dumps;
- client source files;
- old builds/ZIP archives.

Application repositories should contain the minimum necessary to reproduce, test and deploy the application plus intentionally versioned production assets.

## Safe park/delete protocol

**Never delete a local clone because "it is on GitHub" without proving that statement.**

Before parking/deleting a clone:

1. confirm the intended repo/project with `project-context-integrity`;
2. inspect `git status` and remote configuration;
3. fetch the remote and verify branch divergence;
4. confirm no local-only commits remain;
5. inspect untracked/ignored important state;
6. identify non-Git state that must survive;
7. save required non-Git state to the correct secure/cloud/external location;
8. only then delete reconstructible dependencies/build caches or the clone itself.

Important non-Git state includes:

- `.env` / `.env.local` and other local config;
- local databases/dumps;
- uploaded files;
- generated/source media;
- design files/references not committed;
- credentials/secrets;
- local scripts excluded by `.gitignore`.

Never commit secrets merely to make a repo deletable.

## Reconstructible data

Treat these as disposable when the project manifests/lockfiles are correct and there is no project-specific reason to retain them:

- `node_modules`;
- `.next`;
- `dist` / `build` outputs;
- `.turbo`;
- coverage/build caches;
- downloaded package cache where safe to rebuild.

Dependencies are not the project. Reconstruct them from the package manifest + lockfile.

Prefer **pnpm for new projects** when compatible because its shared content-addressed store reduces duplicate dependency storage across many Node projects. Do not interrupt a healthy active project solely to migrate package managers.

## Disk headroom policy for this machine

Operational target, not an Apple requirement:

- target **60–80 GB free** during normal heavy development;
- at **~50 GB free**, begin cleanup/demotion of inactive repos and reconstructible artifacts;
- at **~30 GB free**, stop accumulating and reclaim space before heavy multi-agent/build work;
- do not intentionally run the internal SSD close to full because swap/build/cache pressure can compound poor performance.

Storage pressure and RAM pressure are separate signals. Do not infer RAM trouble from disk use alone; use macOS Memory Pressure for memory decisions.

## Docker and caches

- Inspect Docker usage before pruning.
- Treat Docker volumes as data until proven otherwise.
- Do not blindly run aggressive prune commands that include volumes.
- Do not compulsively wipe npm/package caches; verify/inspect first and clean only when disk pressure justifies it.

## Local vs cloud development

Default to a **hybrid** model rather than moving all development to cloud compute solely for storage reasons.

Local is usually best for:

- rapid UI iteration;
- GSAP/Three.js/motion work;
- visual QA/browser work;
- Figma↔code;
- fast interactive Claude/Codex work.

Cloud/isolated environments can be better for:

- heavy builds;
- reproducible throwaway environments;
- long-running jobs;
- heavy backend work;
- rarely touched repos.

Cloud compute is a tool, not the default answer to poor storage lifecycle management.

## iCloud boundary

Do not make an iCloud-synced Documents directory the canonical home of active Git repositories. Keep active code explicitly local; use iCloud/cloud storage for documents, references and archives where appropriate.

## Cross-project implications for Major

1. **Never create a duplicate local repo because the expected path was missing.** Resolve the existing project/remote first.
2. **Do not "fix" a wrong project by creating a new project copy inside the open workspace.** Use `project-context-integrity` and reroute.
3. When a project path changes, update Major's canonical project registration and any dependent integration paths atomically.
4. When disk pressure is high, prefer deleting reconstructible artifacts and demoting inactive repos before buying more infrastructure or weakening project correctness.
5. Large generated media belongs outside normal source repos unless deployment/reproduction requires an optimized production asset.
6. Parking is a reversible lifecycle state. It must not silently archive/delete the GitHub source or destroy non-Git state.

## Source provenance

Distilled from the user's 2026-08-10 workspace/storage operating note. The source established:

- Mac as active workspace;
- GitHub as canonical code;
- deployment providers as runtime;
- cloud/external storage as archive/large-asset layer;
- HOT/WARM/COLD lifecycle;
- safe Git/non-Git checks before deletion;
- 5–8 active repo target;
- 60–80 GB free target with cleanup thresholds;
- pnpm as default for new projects where compatible;
- cautious Docker/cache cleanup;
- local/cloud hybrid development;
- non-iCloud code workspace preference.

## Reuse condition

Retrieve this memory for project lifecycle, local path, storage pressure, clone duplication, archival, dependency/cache cleanup, large-asset handling and local-vs-cloud development decisions. Do not inject the full memory into unrelated product or coding tasks.
