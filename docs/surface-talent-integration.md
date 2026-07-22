# Surface Talent integration

Surface Talent is the first supervised project. Its configuration is an instance of the
generic project adapter — nothing Surface-Talent-specific is hard-coded in Major.

## Registering

1. Copy `examples/surface-talent.project.json` and adjust:
   - `repoPath` — where the Surface Talent repo lives on this machine (`~` expands);
   - `githubRepo` — `owner/repo` for gh operations;
   - `roadmapSource.spreadsheetId` — the roadmap spreadsheet's ID;
   - `roadmapSource.stableIdColumn` — the column holding stable row IDs;
   - `verificationCommands` — the commands that must pass for a change to count.
2. Export `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service-account file (the config
   stores only the env-var name, never a path to or contents of credentials).
3. `major project add ./surface-talent.project.json`
4. `major doctor` — confirm the project is listed and overnight execution is safe.

## What the config controls

- **Containment**: subprocess cwd must stay inside `repoPath`; `protectedPaths` are
  off-limits to agents; `prohibitedCommands` extends the built-in command policy;
  `protectedBranches` blocks direct pushes.
- **Verification**: `verificationCommands` are what the `verifying` lifecycle state runs.
- **Approvals**: `approvalCategories` defines which decisions must go to a human
  (defaults include `paid_usage`, `merge`, `deploy`, `roadmap_done`,
  `security_exception`).
- **Roadmap**: rows are read by stable ID; updates follow the proposal/dry-run/evidence
  flow in `docs/roadmap-sync.md`.

No machine-specific absolute paths or credentials belong in the committed config —
everything sensitive arrives via environment variables at runtime.
