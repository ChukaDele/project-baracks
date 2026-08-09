---
name: dev-server-management
description: Coordinate an explicitly owner-approved local web-server exception. Cloudflare previews are the default for every web project.
---

# Explicit local exception

This skill has no authority to start a local server unless the owner has explicitly opted in for the current project. Load `remote-first-web-development` first. That skill owns the normal browser-preview path.

When the owner has given that narrow exception, allocate a Major port, reuse a healthy project listener and never displace another project. The exception applies only to that project and does not change the global remote-first default.
