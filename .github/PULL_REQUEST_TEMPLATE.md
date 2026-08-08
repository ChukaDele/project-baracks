# Bottom line

<!-- What outcome does this PR make true? State it first. -->

## MVP / scope

- **P0 outcome:** <!-- the user/operational result this PR advances -->
- **Deliberately deferred:** <!-- P1/P2 items not required for this proof -->
- **Fastest proof used:** <!-- browser, test, provider response, script, preview, etc. -->

## Changes

<!-- Only the material changes needed to understand/review the outcome. -->

## Verification

- [ ] `pnpm validate:major` (for Major itself)
- [ ] relevant targeted checks pass
- [ ] critical user/operational path is verified where applicable
- [ ] meaningful UI changes were inspected rendered, not only via DOM/unit tests
- [ ] external/provider state claims have observable confirmation where applicable
- [ ] exact head SHA/evidence is recorded for consequential readiness claims

## Risk / authority

- [ ] no secret or credential is committed/exposed
- [ ] no unapproved paid API/credit spend is introduced
- [ ] no destructive/irreversible production-data or ownership/DNS/security-policy action is hidden in this PR
- [ ] security/testing depth is proportional to the actual risk

## Legacy cleanup

For migrations, renames, provider swaps or replacements:

- [ ] useful state/knowledge was migrated before deletion
- [ ] successor path was verified
- [ ] obsolete active code/config/docs/names were removed where safe
- [ ] stale-reference scan has no unexplained legacy matches
- [ ] any temporary shim names its active consumer and removal condition

## Evidence / next action

<!-- Exact commands/results, preview/PR/provider evidence, and the highest-impact next action if the larger goal continues. -->
