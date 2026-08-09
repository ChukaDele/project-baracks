---
name: human-blocker-orchestration
description: Surface human-only authentication and approval blockers in the visible Codex in-app browser, notify the owner, and continue independent work.
---

# Human-blocker orchestration

## Default browser

For Major-managed work, use the Codex in-app browser for authentication, OAuth, consent, 2FA and other human-only browser actions. If a tool opens an external URL, capture it and reopen it in the in-app browser where possible. Bring that tab to the foreground.

Before stating that an owner action is visible, verify that the active visible tab has the expected authentication host, the page rendered, and the tab is not loopback, blank or unrelated. If this cannot be proved, report `BROWSER ATTACHMENT FAILURE`, repair the attachment, and do not claim the page is open.

## Blocker classification

- `RUNNING`: no human dependency is active.
- `PARTIALLY BLOCKED`: a human-only dependency is active and independent work remains. Pause only the dependent branch.
- `FULLY BLOCKED`: no useful work can continue without the human action.
- `RESUMING`: browser state proves the dependency resolved. Verify the intended identity, resume the paused branch, and remove the blocker without requesting a generic confirmation message.

Human-only actions are passwords, passkeys, 2FA, OAuth consent, CAPTCHA, payment, irreversible account or domain decisions, and permissions the agent cannot grant. Everything else remains agent work.

## Required handoff

When a human-only action is required:

1. Surface and verify the in-app authentication tab.
2. Immediately run `scripts/notify-human-blocker.sh <project> <specific-action>`.
3. Post `🔴 HUMAN ACTION REQUIRED — <specific action>` in the task.
4. Continue all independent work. Do not stop the entire task for one blocked integration.
5. Poll the visible tab. When it changes to the expected authenticated state, verify identity and continue automatically.

The loopback OAuth exception permits only a trusted CLI callback. It never permits a local application preview, development URL, visual QA, E2E target or user-facing link.
