# Legacy cleanup rules

Legacy cleanup is a required part of completing migrations, renames, provider swaps and architectural replacements. A migration is not complete while obsolete runtime paths, stale guidance, duplicate skills or former names still influence active work.

## Principle

**Preserve history in Git; preserve only current truth in active context.**

## Migration protocol

For every material replacement:

1. **Inventory** — identify old code paths, configs, guidance, skill copies, scripts, env names, branches, package dependencies, docs, database fields/tables, routes and terminology affected.
2. **Classify** each item:
   - `KEEP` — still canonical;
   - `MIGRATE` — useful content/state must move to the successor;
   - `SHIM` — temporarily required by a real active consumer;
   - `DELETE` — obsolete once successor is verified.
3. **Migrate knowledge/data** before destructive cleanup.
4. **Verify successor** with the smallest objective proof that the replacement actually works.
5. **Remove obsolete active artefacts** rather than leaving duplicate implementations around.
6. **Scan for stale references** to former names, paths, flags, packages and APIs.
7. **Run the critical path** after cleanup to prove removal did not break the new canonical route.
8. **Record a compact migration receipt** for consequential migrations: what changed, successor, evidence, any temporary shim, and removal condition.

## Temporary shims

A compatibility shim is allowed only when a known active consumer requires it. Every shim must state:

- consumer;
- why immediate removal is impossible;
- canonical successor;
- removal condition;
- review/expiry point.

A shim with no active consumer is dead code and should be deleted.

## Stale-reference gate

Before declaring a migration complete, search the repository for:

- old project/product names;
- superseded provider names;
- obsolete environment variables;
- dead feature flags;
- old route/API names;
- removed package imports;
- former database/schema names;
- duplicate skill/guidance copies;
- comments/docs telling agents to use the old path.

Each match must be current by design, an explicitly documented temporary shim, or removed.

## No legacy-context pollution

Do not load archived/superseded instructions into agent context. Do not copy legacy docs into new-project templates. Do not retain duplicate skill versions after the canonical version is installed.

## Case study: Major 2.0

The old Major implementation is a migration source, not a second runtime. Major 2.0 should extract useful guidance, task/evidence concepts, routing lessons and history; replace disabled execution with the new orchestration model; then delete obsolete disabled gates, stale provider assumptions and redundant docs/code after equivalent/new behaviour is verified.

The completed state must have one clear answer to: **Where is the current rule? Which execution path is live? Which skill is canonical?**