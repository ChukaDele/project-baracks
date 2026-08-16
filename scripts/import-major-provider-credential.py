#!/usr/bin/env python3
"""Root-only guest-side placement of one already-staged host credential into
Major's canonical provider-auth store. Never invoked directly by a user —
scripts/import-major-provider-credential.sh stages the file and calls this.
Distinct from scripts/manage-major-provider-state.py (which materializes an
already-staged credential into an EPHEMERAL per-run home); this script is the
one place a credential is written INTO the persistent, root-owned store from
outside that store, and only from a fixed, freshly-staged temp path — never
an arbitrary caller-supplied source.
"""

from __future__ import annotations

import grp
import os
import pathlib
import shutil
import stat
import sys

PROVIDERS = {
    "claude": ".claude/.credentials.json",
    "codex": ".codex/auth.json",
    "cursor": ".config/cursor/auth.json",
    "antigravity": ".gemini/antigravity-cli/antigravity-oauth-token",
}

STAGED_PATH = pathlib.Path("/tmp/major-credential-import/staged")


def fail(message: str) -> None:
    raise SystemExit(message)


def main() -> None:
    if os.geteuid() != 0 or sys.platform != "linux":
        fail("credential import broker must run as root inside Linux")
    if len(sys.argv) != 2 or sys.argv[1] not in PROVIDERS:
        fail(f"usage: import-major-provider-credential.py <{'|'.join(PROVIDERS)}>")
    provider = sys.argv[1]
    relative = PROVIDERS[provider]

    staged_info = STAGED_PATH.lstat() if STAGED_PATH.exists() else None
    if (
        staged_info is None
        or not stat.S_ISREG(staged_info.st_mode)
        or stat.S_ISLNK(staged_info.st_mode)
        or staged_info.st_nlink != 1
    ):
        fail(f"unsafe or missing staged credential copy: {STAGED_PATH}")

    target = pathlib.Path("/var/lib/major/provider-auth") / provider / relative
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    group = grp.getgrnam(f"major-{provider}").gr_gid

    staging = target.with_name(target.name + ".next")
    shutil.copyfile(STAGED_PATH, staging, follow_symlinks=False)
    os.chown(staging, 0, group)
    os.chmod(staging, 0o440)
    staging.replace(target)

    STAGED_PATH.unlink()

    final_info = target.lstat()
    if (
        not stat.S_ISREG(final_info.st_mode)
        or stat.S_ISLNK(final_info.st_mode)
        or final_info.st_nlink != 1
        or oct(stat.S_IMODE(final_info.st_mode)) != oct(0o440)
        or final_info.st_uid != 0
        or final_info.st_gid != group
    ):
        fail(f"imported credential failed destination validation: {target}")

    print(f"imported {provider} credential -> {target}")


if __name__ == "__main__":
    main()
