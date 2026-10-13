# Reference Engineering v1.1.0 (Major-coordinated release)

A portable Agent Skill that coordinates existing image-to-code, Figma, reverse-engineering, browser, UI and QA skills. It adds a shared **evidence, functionality, data, testing and parity contract** so reconstruction does not stop at a convincing screenshot.

**State:** Major internal skill candidate. Activation requires merging this branch and hot-syncing the validated bundle. The separate user-global skill is installed in ~/.agents/skills/reference-engineering. Passing metadata audit never proves browser parity or a real application reconstruction.

## Why it exists

The existing specialist skills are useful but fragmented. A workflow can recreate screens while forgetting data, a menu state, archived content, permission enforcement, a backend mutation, or the post-success destination. This router forces every claim to have a source, an implementation, a test, and a status. It also keeps user-requested improvements separate from reference functionality.

## Architecture

```text
  USER SOURCE: screenshot | Figma | URL | repo | docs | export | recording
                                   |
                        source rights + scope
                                   |
          evidence + screen/role/state/control/data inventories
                                   |
        ┌──────────────────────────┼──────────────────────────┐
        v                          v                          v
  Reference Replica /        REA / Engineering by       Browser control audit /
  Figma-native pipeline         Reference + repo             website-replication
        |                          |                          |
        └──────────────────────────┼──────────────────────────┘
                                   v
                       architecture + core flow
                                   v
                    build + real data + contracts
                                   v
          E2E / visual / regression / access / data checks
                                   v
                     independent reverse audit
                                   v
                      coverage_gate.py (metadata)
                                   v
                   verified parity + improvement lane
```

## Contents

- `SKILL.md`: skill invocation logic and execution protocol.
- `references/`: skill precedence, source rights, adversarial review and handoff requirements.
- `assets/project-template/`: CSV and JSON structures for evidence, screens, flows, features, controls, datasets, tests, visual comparison and bugs.
- `scripts/coverage_gate.py`: fail-closed offline metadata validator with no third-party packages or network access.
- `tests/`: unit tests validating green and intentionally broken proof.
- `COMPARISON.md`: source-by-source capability evaluation and recommendations.
- Major registry and signed hot bundle own installation and activation; no separate installer exists in this internal skill.

## Quick start

Use the existing Major internal-skill release process to make this skill available: integrate the registry, pass the resolver evaluation, merge an exact-green head, hot-sync the bundle and verify `major skill resolve` plus `major skill audit --strict`. Do not manually patch the live catalogue or install a second copy.

In your project, copy the templates into `reference/` and merge `gitignore.snippet` into the **repo-root** `.gitignore` before capturing raw evidence:

```bash
mkdir -p reference
cp assets/project-template/{project.json,*.csv,recon.md} reference/
# Append the exact 'reference/evidence-private/' ignore entry to repo-root .gitignore.
# Ensure it is respected before capturing: git check-ignore -q reference/evidence-private/test
python3 scripts/coverage_gate.py --dir ./reference --stage recon
```

A blank project intentionally fails the gate. Populate evidence and the complete inventory as the agent works. `--stage recon` validates the source inventory shape but does **not** certify release. Before saying complete:

```bash
python3 scripts/coverage_gate.py --dir ./reference --stage release --format json
```

The verifier checks evidence references, source/target provenance separation and scoped evidence IDs, requirement-specific proof, recorded test revisions, rights, required datasets or signed scope waivers, sample count reconciliation, freshness, per-screen visual comparisons and open P0-P2 findings. Set `project.target_revision` to the exact tested target revision and every passing `tests.csv.revision` to the same revision. Record explicit differentiation scope for public-competitor full-product reconstruction, or an authorization evidence ID for authorized accounts. **It audits metadata only.** The actual browser and test artifacts must also be inspected and independently verified. Even a passing manifest can contain dishonest claims.

## Suggested invocations

- “Reconstruct this full application including screens, owned records, settings, permissions and working journeys. Independently test every in-scope feature.”
- “Use reference-engineering to inspect this logged-in workflow and build a functionally equivalent version in our existing repository. Audit hidden states, data, permissions and persistence.”
- “Compare our implementation with this original site. Give every control an evidence-backed pass, missing, blocked or intentional-improvement status.”
- “Reverse-engineer this **user-owned** codebase and database export, preserve all records, and prove that migration preserves role permissions and archive history.”

## Disclaimers and attribution

This package is an original coordination layer informed by public open-source methodologies. It does **not** bundle upstream authors' tools or install them automatically. Review and pin versions before using third-party code. See the source comparison in `COMPARISON.md`.

Only analyze sources you have a right to access. Always use your own brand and content for competitor-inspired products. Private user data and keys must never be shipped as audit artifacts.

## Compatibility fix (v1.0.1)

The offline Python gate now postpones annotation evaluation and runs under Python 3.9 as advertised.

## Authorization and release evidence (v1.1.0)

Before reading an owned or authorized source, put a dated provenance record in `evidence.csv` with `OWN` or `AUTH` scope, and set the matching `project.json` field. An owner-approved `SCOPE` record is required for exclusions, data waivers, and local-preview exceptions. These fields are evidence pointers rather than legal verification.

On release, provide an HTTPS remote preview for reconstructed websites, or a documented owner-approved local test exception for an isolated synthetic or offline project. Set `target_revision` to the build revision and `revision` on every target evidence row and passing test. Passing tests link to the requirement's target evidence ID. Each passed visual check corresponds to a screen/state/viewport and numeric threshold. The validator will reject stale target evidence even when its URI is a remote artifact.

This is a metadata validator. Independently inspect the actual browser traces, visual snapshots, data reconciliations, authorization, and test logs. A zero-error metadata report alone never proves a product works.

## Reference inventory contracts

- `project.source_origin`: canonical authorized source locator. At least one in-scope source evidence URI must match it.
- `project.scope_approval_evidence_id`: a **separate**, current internal SCOPE evidence record with explicit exception IDs (`F02`, `D01`, `NO_INTERACTIONS`, `NO_VISUAL`, `NO_DATA`, `MVP`, `LOCAL`). It is required when excluding functionality, data, or visual QA.
- `data.rights_evidence_id`: an observed or documented `RIGHTS;D01`-tagged provenance entry for each required dataset. A rights label without evidence fails the metadata gate.
- `project.remote_preview_url`: public HTTPS address for browser QA, or an approved, isolated local-testing exception. Loopback and private-IP previews fail by default.
- `project.target_revision`: must match current Git HEAD when run in a Git checkout. Target evidence and passing tests must carry the same revision; out-of-repo target revisions need independent verification.

The gate also checks global record IDs for collisions, unique target artifact URIs, per-screen visual checks, and evidence freshness. These deterministic rules prevent common bookkeeping mistakes. They cannot verify that the evidence files or permission statements are truthful.

## External evidence origin boundaries

A release manifest declares a canonical `source_origin`. Every externally hosted source artifact must belong to that origin or appear under an explicitly recorded `approved_source_origins` value. Relative local evidence records remain supported for authorized repositories and exports.

A public `remote_preview_url` identifies the rebuilt application. Externally hosted *target evidence* must originate there or from an expressly listed `approved_artifact_origins` location (for example, the team's evidence-storage hostname). The metadata gate normalizes percent-encoded paths, default HTTPS ports, Unicode hostnames, URI fragments and archive buckets before comparing references. Private, local and scheme-less network endpoints require an approved isolated local-testing exception.

These controls help reject internally inconsistent evidence references. They cannot establish actual DNS resolution, human authorization, content integrity or browser functionality; those require separate verification.
