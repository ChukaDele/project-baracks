#!/usr/bin/env python3
"""Root-only guest-side placement of one already-staged host credential into
Major's canonical provider-auth store. Never invoked directly by a user —
scripts/import-major-provider-credential.sh stages the file and calls this.
Distinct from scripts/manage-major-provider-state.py (which materializes an
already-staged credential into an EPHEMERAL per-run home); this script is the
one place a credential is written INTO the persistent, root-owned store from
outside that store, and only from a fixed, freshly-staged temp path — never
an arbitrary caller-supplied source.

The staged source is opened with O_NOFOLLOW and validated via fstat on the
resulting file descriptor, not via a separate lstat-then-open — a check on
the PATH followed by a later operation on the same path is a TOCTOU race: the
staged file could be swapped for a symlink to an arbitrary file in the gap
between the check and the use, and shutil.copyfile(..., follow_symlinks=False)
would silently create a symlink at the destination rather than a real copy,
which os.chown/os.chmod then dereference and mutate as root. Operating only
on the opened file descriptor closes that gap: the fstat and the read see
the exact same inode, no matter what the path is later swapped to.
"""

from __future__ import annotations

import grp
import os
import pathlib
import stat
import sys

PROVIDERS = {
    "claude": ".claude/.credentials.json",
    "codex": ".codex/auth.json",
    "cursor": ".config/cursor/auth.json",
    "antigravity": ".gemini/antigravity-cli/antigravity-oauth-token",
}

# Overridable only for tests exercising open_verified_source/
# write_verified_staging directly as a module import (main()'s root/linux
# gate makes the real path impossible to exercise outside the guest) — never
# read from anywhere else in production.
STAGED_PATH = pathlib.Path(
    os.environ.get("MAJOR_CREDENTIAL_IMPORT_STAGED_PATH", "/tmp/major-credential-import/staged")
)
COPY_CHUNK = 1 << 16


def fail(message: str) -> None:
    raise SystemExit(message)


def open_verified_source() -> int:
    try:
        fd = os.open(str(STAGED_PATH), os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        fail(f"unsafe or missing staged credential copy: {STAGED_PATH}")
    except OSError as exc:
        fail(f"unsafe or missing staged credential copy: {STAGED_PATH}: {exc}")
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        os.close(fd)
        fail(f"unsafe or missing staged credential copy: {STAGED_PATH}")
    return fd


def write_verified_staging(src_fd: int, staging: pathlib.Path) -> None:
    # O_EXCL: this path is fixed and lives in a root-only (0700) directory,
    # but refuse rather than silently reuse anything already there — a
    # leftover from an interrupted prior run must be inspected, not trusted.
    if staging.exists():
        staging.unlink()
    dst_fd = os.open(str(staging), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        while True:
            chunk = os.read(src_fd, COPY_CHUNK)
            if not chunk:
                break
            os.write(dst_fd, chunk)
    finally:
        os.close(dst_fd)


def main() -> None:
    if os.geteuid() != 0 or sys.platform != "linux":
        fail("credential import broker must run as root inside Linux")
    if len(sys.argv) != 2 or sys.argv[1] not in PROVIDERS:
        fail(f"usage: import-major-provider-credential.py <{'|'.join(PROVIDERS)}>")
    provider = sys.argv[1]
    relative = PROVIDERS[provider]

    src_fd = open_verified_source()
    try:
        target = pathlib.Path("/var/lib/major/provider-auth") / provider / relative
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        group = grp.getgrnam(f"major-{provider}").gr_gid

        staging = target.with_name(target.name + ".next")
        write_verified_staging(src_fd, staging)
    finally:
        os.close(src_fd)

    # staging was just created fresh by this process via O_CREAT|O_EXCL, so
    # it is provably a real regular file, not something a race could have
    # substituted — safe to chown/chmod by path from here on.
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
