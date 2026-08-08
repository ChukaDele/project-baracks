---
name: legacy-cleanup
description: Complete migrations and replacements by removing obsolete active code, configuration, guidance, names and duplicate paths after the successor is verified.
---

# Legacy Cleanup

Use for renames, provider swaps, architecture replacements, migrations and consolidation work.

1. Inventory affected old artefacts and terminology.
2. Classify KEEP / MIGRATE / SHIM / DELETE.
3. Migrate useful state/knowledge first.
4. Verify the successor works.
5. Delete obsolete active paths; Git is the history archive.
6. Search the repo for stale names, imports, flags, env vars, routes, packages, docs and duplicate skills.
7. Allow compatibility shims only for known active consumers, with explicit removal conditions.
8. Run the critical path after deletion.
9. Record a compact migration receipt when consequential.
10. Finish with one canonical implementation, rule and name wherever practical.
