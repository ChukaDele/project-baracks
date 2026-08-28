---
name: analytics-with-shaper
description: Use when a task needs SQL-first dashboards, operational analytics, repeated reporting, alerts, exports, embedded analytics, or control-plane visualisation with Taleshape Shaper. Keep Shaper optional and Major authoritative.
---

# Analytics with Shaper

## Use when

Use this skill for a Shaper dashboard, SQL-based operational analysis, a
repeated report, scheduled PDF/PNG/CSV/Excel output, an alert, embedded
analytics, or an internal control-plane visualisation. Use the Major telemetry
adapter when the source is Major's run history.

## Do not use when

Do not use this skill when a bounded SQL query, an existing project UI, or a
small deterministic export already answers the question. Do not use it for
network traffic shaping, 3D ShapeR, SHAP model explanations, or ordinary log
debugging. Do not use Shaper to replace a domain database or a Major state
transition.

## Decision logic

1. Define the decision, audience, freshness, retention, and output before
   choosing a dashboard.
2. Query the existing source of truth first. Reuse its schema and business
   rules. Do not duplicate core business logic in dashboard SQL.
3. Choose a plain query or export when the result is one-off, low-volume, and
   easier to inspect without a visual surface.
4. Choose Shaper when interactive filtering, repeated analysis, presentation,
   scheduled reporting, alerts, or embedding adds material value.
5. Keep the Shaper deployment outside the Major runtime dependency graph.
   Prefer a local or independently operated service and local file ingestion.
6. Treat Shaper as read-only. Never grant it authority to mutate Major state,
   credentials, approvals, routing, or project data.

## Major telemetry path

Use `major telemetry shaper --format csv` for run-level telemetry. Use
`--view command-centre` for current task-status and recent run-status counts.
Both views accept bounded `--days`, `--project`, `--provider`,
`--run-purpose`, and `--limit` filters. Inspect the schema before writing SQL.
Known fields are exported. Unsupported fields remain empty or `null`.

The adapter excludes task text, descriptions, event payloads, repository
paths, sessions, routing reasons, credential material, and fingerprints.
Provider account values are non-secret configured labels only.

## Shaper workflow

1. Export a bounded, privacy-reviewed dataset into a project-local directory.
2. Write or update a `.dashboard.sql` file with a stable data-source path.
3. Validate the SQL and the expected row shape before deployment.
4. Render a representative dashboard or report and check filters, empty data,
   null fields, labels, and export output.
5. Record the source window, filters, row count, privacy exclusions, and
   whether Shaper was referenced, validated, or rendered operationally.
6. For scheduled reports, alerts, embeds, or managed hosting, apply the
   project policy and data-owner approval before enabling external delivery.

## Constraints

- Major and the underlying project database remain authoritative.
- Shaper is optional. Major must operate when it is offline or absent.
- Shaper is MPL-2.0. Do not copy or modify its source without accepting and
  recording the license obligations.
- Do not infer rates, cost, quality, queue time, cache savings, or failure
  causes without a stored numerator, denominator, and provenance.
- An installed Shaper process is not an integrated or operationally proven
  Shaper dashboard. Prove import and render separately.

## Provenance

Reference: `taleshape-com/shaper`, the official SQL-first analytics and
dashboard implementation, reviewed on 2026-08-28. Major localises the
workflow and owns only the bounded export boundary. No upstream source is
vendored.
