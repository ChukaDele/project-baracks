# Reusable assets assessment

## Decision

The existing Major Skills Library is the correct canonical activation boundary. No adequate reusable implementation store or GBrain asset index is currently exposed. This promotion adds the smallest shared catalog: a versioned canonical locator, structured metadata, a metadata-only GBrain projection, and deterministic retrieval. It does not add a database, memory system, queue, package manager, source mirror, or new production authority.

## Current state

- **Canonical implementation:** repository file named by an asset `locator`.
- **Shared catalog:** `guidance/reusable-assets.registry.json`.
- **Project-local map:** `.major/reusable-assets.registry.json`.
- **GBrain projection:** `guidance/gbrain-reusable-assets.index.json`. It contains metadata only. It never contains implementation bodies.
- **Historical candidate register:** `guidance/reusable-assets.candidates.json`.
- **Initial promoted asset:** `templates/project/GOAL_STATE.md`. It is project-independent, has provenance and validation evidence, and requires a wrapper for project facts.

The installed `gbrain` command is not exposed on this workstation. The available GBrain checkout contains a generic import/search system but no reusable-asset metadata adapter. Its canonical state was not changed. Therefore the projection is ready for supported ingestion, but there is no verified live GBrain indexing or retrieval path in this tranche.

## Retrieval contract

Major searches in this fixed order and stops when a verified match is found:

1. Project-local reusable asset map.
2. GBrain organisation reusable-asset index.
3. Canonical shared catalog.
4. Historical candidate register.
5. Mature prior art.
6. Minimum new implementation.

The resolver returns metadata and a locator. It does not copy an implementation body into GBrain. Consumers must check scope, compatibility, provenance and project policy before use. Shared primitives remain project-independent. Project or client logic belongs in a wrapper or composition layer.

## Lifecycle and promotion

`LOCAL → REUSE_CANDIDATE → EVALUATED → PROMOTED → MONITORED → UPDATED/DEPRECATED`

A completed normal Major worker can report an `assetCandidate`. Major validates its locator and records a project-local `REUSE_CANDIDATE`. It cannot self-promote. Review must establish cross-project value, remove sensitive assumptions, retain provenance, identify dependencies and ownership, and attach evidence before a shared promotion.

Procedures remain skills. Implementations remain assets. Architectural decisions remain GBrain patterns or ADRs. Failures and fixes attach as a regression or lesson to the relevant asset or skill.

## Duplicate and migration finding

The GBrain checkout has one exact duplicate bootstrap template: `templates/bootstrap/CLAUDE.md.template` and `templates/bootstrap/template-repo/CLAUDE.md`. The other inspected bootstrap pairs differ. This promotion has no authority to alter the separate GBrain checkout, so it records the finding rather than consolidating it. A GBrain-owned change can replace the duplicate with its generator source after its own tests establish ownership.

The migration is intentionally small: add metadata to proven canonical implementations, sync the immutable Major bundle, then add a supported GBrain ingestion adapter. Do not mass-promote historical project code. Only record candidates that pass the lifecycle gate.
