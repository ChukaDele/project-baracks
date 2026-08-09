---
name: remote-first-web-development
description: Enforce GitHub plus Cloudflare preview before browser work on a web project. Deny local browser targets unless the owner explicitly approves a project-specific exception.
---

# Remote-first web development

## Gate

Before UI implementation, browser inspection, screenshot QA, responsive testing or acceptance testing:

1. Attach Major and verify the project policy.
2. Verify a dedicated GitHub repository and a pushed baseline.
3. Create or connect the Cloudflare project.
4. Push a non-production branch and obtain its generated Cloudflare preview URL.
5. Run `major web preflight --preview-url <Cloudflare URL> --github-url <GitHub URL> --production-branch main`.

Only open the URL when the preflight passes.

## Denied targets

The preflight rejects `localhost`, loopback IPs, `.local`, non-HTTPS URLs and hosts outside `workers.dev` or `pages.dev`. Do not replace a rejected local target with another port.

## Iteration

Build locally without serving. Then use `code → build → commit → push branch → Cloudflare preview → browser QA → fix`. Promote accepted work through `main`.

## Explicit exception

Only an owner may permit a local browser target. Record the project-specific exception and its expiry before loading `dev-server-management`.

## Resolver examples

### Should trigger

- "Build and visually QA a web landing page."
- "Open the staging site in a browser."
- "Start browser acceptance for this React app."

### Should not trigger

- "Run TypeScript tests."
- "Optimise images with a local CLI."
- "Explain Cloudflare preview deployments."

### Conflicts

This skill supersedes generic browser, Sites and local-dev skills whenever they propose a local URL. `dev-server-management` applies only after the explicit exception above.
