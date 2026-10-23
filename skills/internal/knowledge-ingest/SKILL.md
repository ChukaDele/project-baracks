---
name: knowledge-ingest
description: Use to dispatch notes, pasted text, documents, transcripts, URLs, research or repositories into the maintained Notion Knowledge Library or Major learning with provenance, identity resolution, dedupe and notability filtering.
---

# Knowledge ingest

This is a dispatcher, not a store. Raw sources remain raw. Durable, distilled cross-topic knowledge goes to the maintained Notion Knowledge Library. Live project state stays in repository files. Corrections go to Major learning. GBrain is optional and on demand: write a pointer or a hand-written entity page there only when the owner explicitly asks.

1. Classify the input and use `source-ingestion` for faithful acquisition. Record source locator, author/publisher when known, retrieval method, observed time and licence/sensitivity constraints.
2. Separate quoted/paraphrased source claims from user conclusions and Major-derived conclusions. Every derived statement backlinks to its inputs.
3. Resolve project, entity and alias identity before dedupe. Do not merge solely on embeddings or similar wording.
4. Compare canonical fingerprints and meaning: duplicate, related, contradictory or distinct. Preserve conflicting and minority evidence.
5. Apply notability: retain decisions, reusable mechanisms, material evidence, changed facts, risks or commitments; leave transient chatter, repetitions and unsupported speculation out.
6. Attach `valid_from`, `valid_until`, `observed_at` and `supersedes` when supported by evidence. Unknown dates remain unknown.
7. Route only valuable durable meaning to the Notion Knowledge Library (with owner authorization for write-back) or to Major learning for corrections. Use GBrain only when explicitly requested. Emit a bounded receipt of accepted, linked, rejected-as-noise and unresolved items; ingestion failure never blocks productive work unless it prevents an imminent known failure.

Never create another queue, scheduler, resolver, vector authority or knowledge store.

