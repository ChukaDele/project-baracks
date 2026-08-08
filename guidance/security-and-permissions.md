# Security and permissions rules

Major uses a **minimum viable security floor plus risk-proportional hardening**. Security protects the project from material harm; it must not become a reason to build enterprise controls before the core workflow has been proven.

These non-negotiable boundaries override delivery speed:

## Secrets and credentials

- Never commit credentials, tokens, private keys or secret material.
- Logs, memory and durable run records must redact secrets before persistence.
- Report credential presence/availability without printing the credential itself.
- Never silently enable paid API billing, consume purchased credits or create a new billable service when subscription-included/free capacity is available or the user has not authorised the spend.

## Production and irreversible risk

Without explicit authority, do not:

- destroy or irreversibly rewrite production data;
- force-push protected production branches;
- weaken authentication/authorisation or a security policy in production;
- change DNS, account ownership, billing or credential ownership;
- publish secrets or private/client data;
- perform an irreversible production release when the project requires approval.

## Normal development is allowed

Security rules should **not** block ordinary reversible engineering work. Within the configured project/worktree and project authority, Major may use normal development tools and shell commands to:

- inspect and edit files;
- install approved project dependencies;
- run package managers, compilers, tests, linters and development servers;
- create/use worktrees and branches;
- commit and push non-protected feature branches;
- open/update pull requests;
- run browser automation;
- create/update preview deployments where the provider/project policy allows it;
- call authenticated development integrations required by the task when they do not create new paid usage or irreversible production changes.

Contain worker writes to the intended project/worktree unless a task explicitly requires another approved path.

## Risk-proportional hardening

Apply deeper security work when the actual feature warrants it, especially for:

- authentication/authorisation;
- private or regulated data;
- money/payments;
- production writes;
- destructive actions;
- externally supplied executable content;
- public upload/input surfaces;
- privileged integrations;
- multi-tenant boundaries.

For low-risk local prototypes, static UI, reversible preview environments and proof-of-work slices, do **not** require exhaustive threat models, elaborate RBAC, compliance documentation, full security scanning, advanced audit infrastructure or speculative abuse controls before demonstrating the MVP.

## Secure the boundary that exists

Do not build security for hypothetical future architecture. Protect the real boundary used by the current slice and extend protection when the system gains a new risk-bearing capability.

## Evidence

Security claims must be tied to objective evidence appropriate to the risk. The absence of a large security checklist is not a defect when the checklist is irrelevant to the current MVP.