# Major v0.5.1 stability hardening

## Goal

Make the installed Major runtime independent from the mutable development checkout, improve project/worktree resolution, and close the learning-candidate lifecycle without weakening project isolation or owner authority.

## Acceptance

The release is not complete unless all of the following are true:

1. PR exact-head CI is green.
2. The immutable runtime snapshot smoke executes successfully from packaged production dependencies.
3. A fresh SQLite database initializes using migrations packaged inside the snapshot.
4. Git worktrees resolve to the canonical repository identity.
5. Stale remembered directories are not accepted as valid repositories.
6. Previously attached projects remain locatable even without an active goal.
7. Repeated learning candidates can be surfaced, promoted or dismissed with evidence.
8. Normal installation requires a clean `main` equal to `origin/main` and the full local release gate.
9. Installing a release does not make the active CLI depend on mutable `project-baracks/dist` or `node_modules`.
10. Final `main` CI is green after merge.
11. The installed Mac release record points to that green `main` SHA before field-capacity testing begins.

## Actions budget

Batch changes on an unopened branch. Open the PR only after the static audit is complete. Prefer one PR CI run and one final `main` CI run. If CI fails, diagnose the complete failure before pushing a repair batch.
