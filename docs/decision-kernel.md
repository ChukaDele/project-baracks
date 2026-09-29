# Decision kernel

Major can use TypeSafe/Jev for bounded semantic judgments only when `TYPESAFE_API_KEY` is present and `MAJOR_SEMANTIC_EGRESS=allow` is explicitly set. Runtime egress is additionally limited to projects classified as `workshop` or `knowledge`; `client` and `unknown` projects stay on deterministic paths. Semantic state and question content pass through Major's deep secret redactor before the live SDK call. If any gate is absent, or TypeSafe times out, errors, returns low confidence, or returns malformed output, Major falls back to the pre-existing deterministic behavior. The SDK-standard `TYPESAFE_BASE_URL` is supported, and Major also accepts `TYPESAFE_ENDPOINT` as an explicit base URL override. No model is pinned by Major.

## Precedence

Jev supplies suggestions, never authority. Decisions are composed in this order:

1. Major trust and project policy, global stop state, resource ceilings, and containment.
2. `executeMajorCommand`, paid-spend approval, independent-review, and Toolsmith validation gates.
3. Deterministic safety escalation and integrity rules.
4. High-confidence semantic routing or filtering.
5. Existing deterministic fallback.

Canonical project context is never semantically removed. Only optional learning or retrieved context is filtered. Client and unclassified project content is not sent to TypeSafe by Major's runtime. Provider exhaustion and rate limits remain capacity signals, not work failures. A worker
completion claim still requires the existing independent completion grade.

## Capabilities

- Skill routing uses a roster pass followed by detailed reads of at most three candidates. Explicit
  skill IDs and strong deterministic matches cannot be rejected.
- Task routing classifies purpose, complexity, and risk, while deterministic security, destructive,
  and production signals can only raise risk.
- The repair gate chooses a bounded posture and forces a strategy change after two materially
  unchanged failures; it cannot mark work complete.
- Tool and browser helpers select only from caller-provided allowlists and never execute. Browser
  suggestions additionally require the validated `jev-browser-use` capability and existing remote
  preview and project-write policy.

Telemetry at `$MAJOR_HOME/decision-kernel/events.jsonl` contains decision name, status, timing,
question count, returned model name when available, and confidence only. Prompts, CVs, retrieved text,
answer state, and credentials are never recorded.

## Enable

Set `TYPESAFE_API_KEY` only in the server/runtime environment and set `MAJOR_SEMANTIC_EGRESS=allow` only when semantic state is permitted to leave eligible non-client projects. Tests inject a fake adapter and never call TypeSafe. Removing either setting immediately restores deterministic behavior; no migration or persisted semantic state is involved.
