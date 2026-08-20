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
import re
import stat
import sys

PROVIDERS = {
    "claude": ".claude/.credentials.json",
    "codex": ".codex/auth.json",
    "cursor": ".config/cursor/auth.json",
    "antigravity": ".gemini/antigravity-cli/antigravity-oauth-token",
}

ACCOUNT_LABEL_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,31}$")

# Overridable only for tests exercising open_verified_source/
# write_verified_staging directly as a module import (main()'s root/linux
# gate makes the real path impossible to exercise outside the guest) — never
# read from anywhere else in production.
STAGED_PATH = pathlib.Path(
    os.environ.get("MAJOR_CREDENTIAL_IMPORT_STAGED_PATH", "/tmp/major-credential-import/staged")
)
AUTH_ROOT = pathlib.Path("/var/lib/major/provider-auth")
COPY_CHUNK = 1 << 16


def fail(message: str) -> None:
    raise SystemExit(message)


def assert_account_label(account: str) -> str:
    if account == "default":
        return account
    if ACCOUNT_LABEL_PATTERN.fullmatch(account) is None or account == "accounts":
        fail(f"invalid account label: {account}")
    return account


def auth_store_path(provider: str, relative: str, account: str) -> pathlib.Path:
    base = AUTH_ROOT / provider
    if account == "default":
        return base / relative
    return base / "accounts" / account / relative


def named_auth_store_parent_dirs(provider: str, account: str, relative: str) -> list[pathlib.Path]:
    """Ordered root-owned 0700 directories for a named account credential."""
    if account == "default":
        fail("named auth store parents apply only to non-default accounts")
    base = AUTH_ROOT / provider
    rel_parent = pathlib.Path(relative).parent
    return [
        base,
        base / "accounts",
        base / "accounts" / account,
        base / "accounts" / account / rel_parent,
    ]


def _ensure_directory_chain(root: pathlib.Path, components: tuple[str, ...]) -> None:
    """Create one directory chain using verified directory descriptors only."""
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    try:
        parent_fd = os.open(str(root), flags)
    except OSError as exc:
        fail(f"unsafe or missing provider auth root: {root}: {exc}")
    try:
        for component in components:
            if component in {"", ".", ".."}:
                fail(f"unsafe auth store component: {component!r}")
            try:
                os.mkdir(component, 0o700, dir_fd=parent_fd)
            except FileExistsError:
                pass
            except OSError as exc:
                fail(f"could not create auth store directory {component}: {exc}")
            try:
                child_fd = os.open(component, flags, dir_fd=parent_fd)
            except OSError as exc:
                fail(f"unsafe auth store directory {component}: {exc}")
            info = os.fstat(child_fd)
            if not stat.S_ISDIR(info.st_mode):
                os.close(child_fd)
                fail(f"unsafe auth store directory: {component}")
            if os.geteuid() == 0:
                os.fchown(child_fd, 0, 0)
            os.fchmod(child_fd, 0o700)
            os.close(parent_fd)
            parent_fd = child_fd
    finally:
        os.close(parent_fd)


def ensure_auth_store_parents(provider: str, relative: str, account: str) -> pathlib.Path:
    target = auth_store_path(provider, relative, account)
    try:
        components = target.parent.relative_to(AUTH_ROOT).parts
    except ValueError:
        fail(f"credential target escaped auth root: {target}")
    _ensure_directory_chain(AUTH_ROOT, components)
    return target


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
    # Refuse rather than deleting or reusing anything already at this fixed
    # root-only path. O_EXCL is the atomic check-and-create operation.
    try:
        dst_fd = os.open(
            str(staging),
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
        )
    except OSError as exc:
        fail(f"refusing unsafe or pre-existing credential staging path: {staging}: {exc}")
    try:
        while True:
            chunk = os.read(src_fd, COPY_CHUNK)
            if not chunk:
                break
            view = memoryview(chunk)
            while view:
                written = os.write(dst_fd, view)
                if written <= 0:
                    fail(f"could not write credential staging file: {staging}")
                view = view[written:]
        os.fsync(dst_fd)
    finally:
        os.close(dst_fd)


def main() -> None:
    if os.geteuid() != 0 or sys.platform != "linux":
        fail("credential import broker must run as root inside Linux")
    if len(sys.argv) not in {2, 3} or sys.argv[1] not in PROVIDERS:
        fail(f"usage: import-major-provider-credential.py <{'|'.join(PROVIDERS)}> [account-label]")
    provider = sys.argv[1]
    account = assert_account_label(sys.argv[2]) if len(sys.argv) == 3 else "default"
    relative = PROVIDERS[provider]

    src_fd = open_verified_source()
    try:
        target = ensure_auth_store_parents(provider, relative, account)
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
