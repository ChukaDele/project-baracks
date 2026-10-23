---
title: UI engineering specialist skills
type: reusable-capability
status: recorded-global-install
updated: 2026-10-13
tags: [frontend, design, figma, react, accessibility, skills, qa]
---

# UI engineering specialist skills

## Recorded install and ownership
On 8 October 2026, the Mac's official skills installer returned successful global installations of these six external skills, at `~/.agents/skills/<name>/SKILL.md` with Claude Code links and shared Codex/Cursor discovery:
- `ui-skills-root`: choose the smallest applicable specialist skill set from UI Skills, normally one.
- `create-design-md`: document a **verified existing** product design language, without inventing tokens.
- `interface-design`: develop greenfield SaaS dashboards, admin interfaces and tools.
- `react-doctor`: scan changed React code for regressions; in private repos disable telemetry and dependency networking by default.
- `improve-ui`: evidence-led audit of visual inconsistencies without silently rewriting product source.
- `web-quality-audit`: browser-evidenced performance, accessibility and SEO quality review.

Recorded global routing contract: `~/.agents/ui-skills-routing.md`. Claude `~/.claude/CLAUDE.md`, Codex `~/.codex/AGENTS.md`, and Cursor `~/.cursor/rules/ui-skills-routing/RULE.mdc` received routing pointers on 8 October. This is the **last verified state**; the Mac is currently offline and present state cannot be independently checked.

## Authority and when to trigger
1. Existing user-approved design, business requirements, repo rules, Figma components and project-specific tokens outrank generic skill style opinions.
2. Exact machine-readable Figma design → official Figma-to-code fidelity workflow, no parallel design-from-scratch loop.
3. Screenshot / URL recreation → `reference-replica`; shipped binary/feature reverse engineering → `engineering-by-reference` / REA.
4. No approved visual and a genuinely new SaaS interface → `interface-design`.
5. Existing site's design-language documentation → `create-design-md`.
6. Audit existing UI for candidate refinements → `improve-ui`.
7. Material React component changes → changed-scope `react-doctor`.
8. Browser performance / SEO / accessibility audits → `web-quality-audit`.
9. Scroll-input synchronization with GSAP/WebGL/Lenis → **Major's `responsive-motion-systems`** skill. Lenis is a conditional project runtime; it does not replace the external UI skills or native scroll.
10. Mobile and edge-condition QA retains Emil `mobile-native` and `break-ui`.

Do **not** activate these skills for unrelated writing, operations, backend work or generic marketing copy. Restrict ordinary UI work to one primary specialist, adding only distinct required reviewers.

## Safety
React Doctor's optional score API, telemetry, crash reporting and dependency supply-chain network checks should be disabled in confidential repositories (`--no-telemetry --no-supply-chain`), with a reviewed pinned CLI version. Remote scripts, arbitrary packages and private/browser traces must not be uploaded or executed without project trust review.

## Persistence and verification
This version-controlled record is a **GBrain-ready backup** of the earlier local staging file `~/.gbrain/pending-import/ui-engineering-skills.md`. The Mac has been disconnected from Remote Desktop Commander, so neither current global installation nor live PGLite indexing can be asserted today. Once available, prefer the existing GBrain MCP write tool when the server owns PGLite; otherwise use CLI import only with a released database lock, then verify `get` and `search`.

Sources:
- https://github.com/ibelick/ui-skills
- https://github.com/Dammyjay93/interface-design
- https://github.com/millionco/react-doctor
- https://github.com/addyosmani/web-quality-skills
