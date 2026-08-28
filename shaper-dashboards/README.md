# Major Shaper dashboard

This directory contains a file-backed Shaper dashboard definition. The
dashboard is an optional consumer of Major's read-only telemetry export.

Generate the two project-local source files in this directory before opening
the dashboard in Shaper:

```text
major telemetry shaper --view command-centre --format csv --days 30 > major-command-centre.csv
major telemetry shaper --format csv --days 30 --limit 5000 > major-run-telemetry.csv
```

Open `command-centre.dashboard.sql` with a separately operated Shaper
instance. Keep the CSV files local to the project. Do not commit them when
they contain operational or customer-sensitive data.

The dashboard uses only Shaper SQL and DuckDB's local CSV reader. It does not
add a Shaper dependency to Major and does not grant Shaper control-plane
authority.
