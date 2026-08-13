# Major v0.5.1 stability hardening

## Goal

Make the installed Major runtime independent from the mutable development checkout, improve project/worktree resolution, close the learning-candidate lifecycle, and make operational claims match observed system state without weakening project isolation or owner authority.

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
10. Learning behavior has one canonical CLI implementation rather than shadowed duplicate paths.
11. Global engineering doctrine requires the smallest correct modular implementation and removal of duplicate code paths.
12. Major self-maintenance verifies live PR/workflow state before claiming that a push will or will not trigger CI.
13. Final `main` CI is green after merge.
14. The installed Mac release record points to that green `main` SHA before field-capacity testing begins.

## Actions budget

Batch changes on an unopened or closed-PR branch. Open/reopen the PR only after the repair batch is complete. With `pull_request` CI, treat every push to a branch with an open PR as CI-triggering unless the live workflow configuration proves otherwise. If CI fails deterministically, close the PR, diagnose the complete failure, batch the repair, then reopen once.
