# Summary

<!-- What this PR changes and why. Reference the review finding, task, or roadmap item it addresses. -->

## Changes

<!-- Focused list of what changed, grouped by area. -->

## Safety

- [ ] No live agent execution, merge, deploy, or paid usage is enabled by this change
- [ ] Security/permissions rules are not weakened (or a `security_exception` decision is linked)
- [ ] Secrets cannot reach logs, run events, or durable storage via this change
- [ ] Migrations apply cleanly to a fresh DB and to the previous schema

## Verification

<!-- Exact commands run and their results. -->

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm format:check`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`

## Documentation

- [ ] `docs/` and `guidance/` reflect the implemented behaviour

## Out of scope / follow-ups

<!-- Known gaps deliberately not addressed here, with suggested follow-up tasks. -->
