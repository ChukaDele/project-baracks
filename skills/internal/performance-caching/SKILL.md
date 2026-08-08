---
name: performance-caching
description: Use when a real workflow, page, query, build or integration is measurably slow. Find the dominant bottleneck and apply the simplest high-leverage performance fix before rewriting architecture.
---

# Performance and Caching

1. Measure the slow user-visible path and establish a baseline.
2. Identify the dominant source: network/provider latency, repeated computation, database/query shape, rendering, bundle size, sequential work or unnecessary re-fetching.
3. Prefer the simplest suitable fix:
   - cache stable/reusable results;
   - deduplicate requests/work;
   - batch independent operations;
   - parallelise safe independent work;
   - add the right index/query constraint;
   - paginate/lazy-load/virtualise large data;
   - prefetch only when likely useful;
   - move expensive work out of the critical interaction path.
4. Define cache ownership, key, invalidation/TTL and stale behavior explicitly; do not add caching without an invalidation model.
5. Do not optimise theoretical future scale before measuring a real bottleneck.
6. Re-measure the same path after the change.
7. Keep the fix only when it improves the target without unacceptable correctness/staleness cost.
