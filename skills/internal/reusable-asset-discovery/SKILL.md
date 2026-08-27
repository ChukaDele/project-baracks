---
name: reusable-asset-discovery
description: Use before material new implementation to retrieve a compatible reusable implementation in the required local-map, GBrain-index, canonical-package, historical-candidate and prior-art order. Use when deciding whether code, a component, a template, a validator, a schema, an adapter or a calculator should be reused, wrapped, promoted or built. Do not create a new asset registry or copy source trees into GBrain.
---

# reusable-asset-discovery

Classify the work product first. Route a repeatable procedure to the Skills
Library. Route an architectural decision or pattern to GBrain ADR knowledge.
Attach a reusable failure or regression to the relevant asset or skill. Use
this procedure only for a reusable implementation or template.

For an implementation, search in this exact order:

1. Project-local reusable asset map.
2. GBrain reusable organisational asset index.
3. Canonical shared internal packages and templates.
4. Historical project repositories for unpromoted candidates.
5. Mature OSS or paid prior art.
6. Build the minimum new capability only when every earlier level is unsuitable.

At each level, check scope, licence, version, interface, dependencies,
compatibility, tests, quality evidence, known limitations and lifecycle. Prefer
the most proven compatible asset. Do not search historical repositories before
the earlier levels fail. Keep shared code project-independent and place business
logic in a project wrapper.

After a successful validated project increment, record a local
`REUSE_CANDIDATE` only when the export/template is portable and private context
has been removed. Preserve source project, revision, licence, lineage and
evidence. Promotion to a shared package and GBrain metadata projection requires
separate evaluation and authority.

GBrain stores metadata and a canonical pointer, never a duplicated source tree.
Do not create or activate a registry, queue, resolver, scheduler, package,
provider integration or mutation authority in this staging scope.
