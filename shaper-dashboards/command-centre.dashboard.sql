-- shaperid:majorcommandcentre20260828

SELECT 'Major Command Centre'::SECTION;

SELECT 'Current task and recent run status'::LABEL;
SELECT
  status::XAXIS,
  metric::CATEGORY,
  count::BARCHART_STACKED
FROM read_csv_auto('major-command-centre.csv', header = true)
ORDER BY 1, 2;

SELECT 'Recent Major Run Outcomes'::LABEL;
SELECT
  day::XAXIS,
  result_status::CATEGORY,
  count()::BARCHART_STACKED
FROM read_csv_auto('major-run-telemetry.csv', header = true)
GROUP BY ALL
ORDER BY 1, 2;

SELECT 'Provider Performance'::SECTION;

SELECT 'Runs by provider and account'::LABEL;
SELECT
  (provider || ' / ' || coalesce(provider_account, 'unavailable'))::XAXIS,
  result_status::CATEGORY,
  count()::BARCHART_STACKED
FROM read_csv_auto('major-run-telemetry.csv', header = true)
GROUP BY ALL
ORDER BY 1, 2;

SELECT 'Average duration by provider'::LABEL;
SELECT
  provider::XAXIS,
  avg(try_cast(duration_seconds AS DOUBLE))::BARCHART
FROM read_csv_auto('major-run-telemetry.csv', header = true)
WHERE try_cast(duration_seconds AS DOUBLE) IS NOT NULL
GROUP BY provider
ORDER BY provider;

SELECT 'Token Economics'::SECTION;

SELECT 'Tokens by project and run purpose'::LABEL;
SELECT
  project::XAXIS,
  run_purpose::CATEGORY,
  sum(try_cast(total_tokens AS DOUBLE))::BARCHART_STACKED
FROM read_csv_auto('major-run-telemetry.csv', header = true)
WHERE try_cast(total_tokens AS DOUBLE) IS NOT NULL
GROUP BY ALL
ORDER BY 1, 2;

SELECT 'Estimated cost by project and provider'::LABEL;
SELECT
  project::XAXIS,
  provider::CATEGORY,
  sum(try_cast(estimated_cost AS DOUBLE))::BARCHART_STACKED
FROM read_csv_auto('major-run-telemetry.csv', header = true)
WHERE try_cast(estimated_cost AS DOUBLE) IS NOT NULL
GROUP BY ALL
ORDER BY 1, 2;

SELECT 'Worker Performance'::SECTION;

SELECT 'Runs by worker and provider'::LABEL;
SELECT
  coalesce(worker, 'unavailable')::XAXIS,
  provider::CATEGORY,
  count()::BARCHART_STACKED
FROM read_csv_auto('major-run-telemetry.csv', header = true)
GROUP BY ALL
ORDER BY 1, 2;

SELECT 'Average duration by worker'::LABEL;
SELECT
  coalesce(worker, 'unavailable')::XAXIS,
  avg(try_cast(duration_seconds AS DOUBLE))::BARCHART
FROM read_csv_auto('major-run-telemetry.csv', header = true)
WHERE try_cast(duration_seconds AS DOUBLE) IS NOT NULL
GROUP BY worker
ORDER BY 1;

SELECT 'Project Activity'::SECTION;

SELECT 'Runs by project over time'::LABEL;
SELECT
  day::XAXIS,
  project::CATEGORY,
  count()::BARCHART_STACKED
FROM read_csv_auto('major-run-telemetry.csv', header = true)
GROUP BY ALL
ORDER BY 1, 2;

SELECT 'Failure Analysis'::SECTION;

SELECT 'Observed run and CI failures'::LABEL;
SELECT
  result_status::XAXIS,
  ci_test_outcome::CATEGORY,
  count()::BARCHART_STACKED
FROM read_csv_auto('major-run-telemetry.csv', header = true)
WHERE result_status IN ('failed', 'cancelled', 'timed_out')
   OR ci_test_outcome = 'failed'
GROUP BY ALL
ORDER BY 1, 2;

SELECT 'Classified failure causes (empty means unavailable)'::LABEL;
SELECT
  failure_reason::XAXIS,
  result_status::CATEGORY,
  count()::BARCHART_STACKED
FROM read_csv_auto('major-run-telemetry.csv', header = true)
WHERE failure_reason IS NOT NULL
GROUP BY ALL
ORDER BY 1, 2;
