# Specialist skill routing and precedence

| Input + intent | Primary | Additional validation | Suppress by default |
| --- | --- | --- | --- |
| Image/screenshot -> visual design | `reference-replica`; optionally Surya `Replica` prompt schema | local visual capture, `figma-fidelity` metrics, `break-ui` | Backend, branding, marketing, mobile-only QA unless requested |
| Figma -> faithful implementation | Figma-native `figma-design-to-code` | `figma-fidelity`, UI design rules | Screenshot prompt-only workflows when design-node metadata exists |
| Live website -> behavioural implementation | User-authorized browser capture + `website-replication-skill` inventory/control-ledger method | `engineering-by-reference`, REA (when lawful), parity test | Blind image-to-code only; unpermitted/private API copying |
| User-owned repo -> system reconstruction | Repo inspection, REA, `engineering-by-reference` | unit/integration/E2E tests, data-migration reconciliation | Rebuilding from screenshots when code exists |
| Full-stack product -> parity | existing repo patterns + `replica-architect`/`replica-backend` methodology | feature matrix, auth/tenant/DB constraints, migrations, monitoring | Premature microservices or gratuitous framework changes |
| Visual QA | Figma Fidelity if Figma source; otherwise image and responsive diff tools | `break-ui`, `mobile-native` if device in scope | Visual scores as proof of functionality |
| Business improvement requested | evidence-backed user complaint analysis (`replica-entrepreneur`) | impact/effort, risk and experiment design | Unverified review quotes or speculative additions |
| Release requested | existing deployment workflow | actual smoke tests, reversible rollout, clean IP sweep, user approval | Silent production changes |

If skill name/path is unknown or not installed, do not invent it. Check the live machine's directories and tool connectivity. Record unverified skills separately from discovered skills. If a primary capability is missing, record the gap and obtain owner approval before installation; preserve existing router precedence.

For current setup review, known prior components (not currently verified online) include REA v3.2.1, Reference Replica, Engineering by Reference, Figma Fidelity, five UI Skills, `mobile-native`, `break-ui`, browser QA, Claude/Codex/Cursor skills. Avoid unconditional import of upstream packs with 11 similarly named skills. Keep an upstream source/commit pin and run security review + tests before importing any code.
