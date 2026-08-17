#!/usr/bin/env python3
"""Atomically rewrites installed-release.json's releaseGate field in place.

Used by install-major-runtime.sh when post-install verification fails AFTER
activation has already committed and written the record with
releaseGate: "passed" — that record must be corrected to reflect the real
outcome, not left claiming success for a release the installer itself just
refused to vouch for. Read-modify-write via a same-directory temp file plus
an atomic rename, so a concurrent reader (e.g. `major support-bundle`) never
observes a half-written record.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: mark-major-release-gate.py <installed-release.json> <reason>")
    path = Path(sys.argv[1])
    reason = sys.argv[2]
    record = json.loads(path.read_text())
    record["releaseGate"] = reason
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(record, indent=2) + "\n")
    tmp.replace(path)


if __name__ == "__main__":
    main()
