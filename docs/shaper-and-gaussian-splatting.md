# Shaper and Gaussian Splatting integration record

## Current integration levels

| Repository | Major stage | Operational boundary |
| --- | --- | --- |
| [Taleshape Shaper](https://github.com/taleshape-com/shaper) | Adapter plus dashboard artifact | Major exports bounded read-only CSV or JSON. Shaper remains an optional external consumer. |
| [GraphDeco Gaussian Splatting](https://github.com/graphdeco-inria/gaussian-splatting) | Reference plus skill | Major routes the workflow and license gates. It does not install, vendor, or execute the reference implementation. |

The Shaper source was reviewed at `084b5ab49c42bb7881db84011311b9d521352faf`.
The GraphDeco source was reviewed at
`54c035f7834b564019656c3e3fcc3646292f727d`. Re-check the exact revision and
license before a future promotion.

## Shaper adapter

Major's existing SQLite database remains the source of truth. The adapter does
not create a database, copy event payloads, open a port, start Docker, upload
telemetry, or add a Shaper package to the Major runtime.

Export run telemetry with:

```text
major telemetry shaper --format csv --days 30 --limit 5000
major telemetry shaper --format json --project PROJECT --provider PROVIDER
```

Export the current task and recent run status counts with:

```text
major telemetry shaper --view command-centre --format csv --days 30
```

The adapter sets SQLite `query_only` after the normal Major database-open and
migration boundary. Reads are bounded to 1 to 366 days and 1 to 50,000 rows.
Project, provider, run-purpose, and row-limit filters are parameterized.
Major does not have a separate `blocked` task status. Decision-blocked work is
represented by the existing `needs_decision` status in the command-centre
view.

Known fields include run ID, project, task ID, current task status, run
purpose, worker ID when persisted, provider, configured provider-account
label, model, billing mode, start/end time, duration, retry count derived from
the durable claim attempt, result status, approval state, CI/test outcome, and
event count. Token and cost values are read only from the latest structured
`usage_observations` row when recognized. The total token count is derived only
when both input and output counts are known.

Task family, cache/reuse status, concurrency, queue wait, failure text,
general human-intervention state, numeric quality score, invoked skills,
GBrain read/write counts, provider throttling, and provider capacity signals
are currently unavailable. These fields remain `null` in JSON and empty in
CSV. The export never exposes task descriptions,
event payloads, repository paths, sessions, routing reasons, credentials, or
credential fingerprints.

## Working Shaper dashboard artifact

`shaper-dashboards/command-centre.dashboard.sql` is a portable Shaper
dashboard definition. It reads two project-local exports beside the dashboard:

- `major-command-centre.csv` from the `--view command-centre` command;
- `major-run-telemetry.csv` from the default run telemetry command.

The dashboard contains task-status and recent-run-status panels, followed by a
recent run-outcome panel. It is intentionally a file-backed dashboard. This
keeps the Major control plane independent of Shaper while giving an operator a
working SQL-first surface backed by real Major rows after the two exports are
generated.

To enable it, place the dashboard and exports in a project-local Shaper
directory, then validate and render it using an independently operated
Shaper service. To disable it, stop using the export commands or remove the
separate Shaper deployment. Major execution is unaffected either way.

Shaper's official repository documents self-hosting, Docker, SQL dashboards,
embedded analytics, scheduled PDF/PNG/CSV/Excel output, alerts, and
password-protected sharing. Those features remain operator-selected. No
scheduled delivery, alert, embedding, managed hosting, or public sharing is
enabled by this Major change.

## Shaper license and provenance

Shaper is licensed under MPL-2.0. Major copies no Shaper source and adds no
Shaper dependency. A future source-level modification would need a renewed
license review and the required notices.

## Gaussian Splatting boundary

The official GraphDeco repository is a reference implementation. Its custom
license grants non-commercial research and evaluation rights and requires
explicit licensor permission for commercial use. The reference README also
requires a CUDA-capable GPU, reports 24 GB VRAM for paper-quality training,
and uses PyTorch, CUDA extensions, COLMAP inputs, and recursive submodules.

Major therefore records the repository as `reference + skill` only. It does
not copy source, add submodules, download weights, install a global
environment, create an adapter, or run training/viewer code. Commercial work
must first identify a maintained implementation with compatible rights. A
future real spatial project must also provide consented data, hardware, an
isolated environment, output validation, and retention/deletion evidence.

## Intentional deferrals

- Shaper server lifecycle, Docker orchestration, import/render proof against a
  live service, scheduled reports, alerts, embeds, and managed hosting remain
  outside Major's runtime.
- A richer telemetry schema for cache savings, queue wait, concurrency,
  failure classifications, quality scores, skill invocation, and GBrain
  operations is deferred until those facts are durably recorded by Major.
- No Gaussian Splatting adapter or native capability is justified without a
  real spatial use case, supported GPU environment, consented capture, and
  compatible commercial or research rights.
- No customer, capture, or generated spatial data is committed to this
  repository. Keep exports and spatial artifacts project-local with explicit
  retention.
