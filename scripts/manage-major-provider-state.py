#!/usr/bin/env python3
"""Root-only broker between persistent auth, project state and an ephemeral run home."""

from __future__ import annotations

import os
import pathlib
import shutil
import stat
import sys
import tempfile


PROVIDERS = {
    "claude": ("major-claude", ".claude/.credentials.json"),
    "codex": ("major-codex", ".codex/auth.json"),
    "cursor": ("major-cursor", ".config/cursor/auth.json"),
    "antigravity": (
        "major-antigravity",
        ".gemini/antigravity-cli/antigravity-oauth-token",
    ),
}


def fail(message: str) -> None:
    raise SystemExit(message)


def safe_tree(root: pathlib.Path, excluded: set[pathlib.Path] | None = None) -> None:
    if not root.exists():
        return
    root_info = root.lstat()
    if not stat.S_ISDIR(root_info.st_mode) or stat.S_ISLNK(root_info.st_mode):
        fail(f"unsafe provider state root: {root}")
    for parent, dirs, files in os.walk(root, followlinks=False):
        for name in [*dirs, *files]:
            path = pathlib.Path(parent) / name
            if excluded is not None and path.relative_to(root) in excluded:
                continue
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode) or not (
                stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)
            ):
                fail(f"unsafe provider state entry: {path}")
            if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
                fail(f"hard-linked provider state entry: {path}")


def copy_tree(source: pathlib.Path, destination: pathlib.Path, excluded: set[pathlib.Path] | None = None) -> None:
    safe_tree(source, excluded)
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    for parent, dirs, files in os.walk(source, followlinks=False):
        relative = pathlib.Path(parent).relative_to(source)
        target_parent = destination / relative
        target_parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        for name in dirs:
            if excluded is not None and (relative / name) in excluded:
                continue
            (target_parent / name).mkdir(mode=0o700, exist_ok=True)
        for name in files:
            item = pathlib.Path(parent) / name
            if excluded is not None and item.relative_to(source) in excluded:
                continue
            shutil.copyfile(item, target_parent / name, follow_symlinks=False)
            os.chmod(target_parent / name, 0o600)


def roots() -> tuple[pathlib.Path, pathlib.Path, int, int]:
    testing = os.environ.get("MAJOR_PROVIDER_STATE_TESTING") == "1"
    if testing:
        if os.geteuid() == 0:
            fail("test root override is forbidden for root")
        root = pathlib.Path(os.environ["MAJOR_PROVIDER_STATE_TEST_ROOT"]).resolve()
        return root / "provider-auth", root / "projects", os.getuid(), os.getgid()
    if os.geteuid() != 0 or sys.platform != "linux":
        fail("Major provider state broker must run as root inside Linux")
    import grp
    import pwd

    provider = sys.argv[2]
    user = PROVIDERS[provider][0]
    account = pwd.getpwnam(user)
    return pathlib.Path("/var/lib/major/provider-auth"), pathlib.Path("/var/lib/major/projects"), account.pw_uid, grp.getgrnam(user).gr_gid


def validate(provider: str, project_hash: str, run_home: pathlib.Path) -> pathlib.Path:
    if provider not in PROVIDERS:
        fail("unsupported provider")
    if len(project_hash) != 64 or any(char not in "0123456789abcdef" for char in project_hash):
        fail("invalid project hash")
    if os.environ.get("MAJOR_PROVIDER_STATE_TESTING") != "1":
        prefix = f"/var/lib/major/runs/{provider}/"
        parts = str(run_home).split("/")
        if not str(run_home).startswith(prefix) or len(parts) != 8 or parts[-1] != "home":
            fail("invalid provider run home")
    return pathlib.Path(PROVIDERS[provider][1])


def prepare(auth_root: pathlib.Path, projects_root: pathlib.Path, provider: str, project_hash: str, run_home: pathlib.Path, uid: int, gid: int, auth_relative: pathlib.Path) -> None:
    if run_home.exists():
        fail("refusing to overwrite provider run home")
    project_home = projects_root / project_hash / provider / "home"
    copy_tree(project_home, run_home)
    for parent, dirs, files in os.walk(run_home):
        os.chown(parent, uid, gid)
        for name in [*dirs, *files]:
            os.chown(pathlib.Path(parent) / name, uid, gid)
    auth_source = auth_root / provider / auth_relative
    source_info = auth_source.lstat() if auth_source.exists() else None
    if source_info is None or not stat.S_ISREG(source_info.st_mode) or source_info.st_nlink != 1:
        fail(f"provider authentication is unavailable: {provider}")
    auth_target = run_home / auth_relative
    auth_target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    parent = auth_target.parent
    while parent != run_home:
        os.chown(parent, uid, gid)
        os.chmod(parent, 0o700)
        parent = parent.parent
    shutil.copyfile(auth_source, auth_target, follow_symlinks=False)
    os.chown(auth_target, uid, gid)
    os.chmod(auth_target, 0o600)


def finalize(auth_root: pathlib.Path, projects_root: pathlib.Path, provider: str, project_hash: str, run_home: pathlib.Path, uid: int, gid: int, auth_relative: pathlib.Path) -> None:
    volatile: set[pathlib.Path] = set()
    if provider == "antigravity":
        volatile.add(pathlib.Path(".gemini/antigravity-cli/cli.log"))
    elif provider == "cursor":
        for entry in run_home.glob("tmp/cursor-agent-logs-[0-9]*/latest.log"):
            volatile.add(entry.relative_to(run_home))
    safe_tree(run_home, volatile)
    refreshed_auth = run_home / auth_relative
    refreshed_info = refreshed_auth.lstat()
    if not stat.S_ISREG(refreshed_info.st_mode) or refreshed_info.st_nlink != 1:
        fail("provider authentication refresh is not a regular file")
    auth_destination = auth_root / provider / auth_relative
    auth_destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    auth_stage = auth_destination.with_name(auth_destination.name + ".next")
    shutil.copyfile(refreshed_auth, auth_stage, follow_symlinks=False)
    os.chown(auth_stage, 0 if os.environ.get("MAJOR_PROVIDER_STATE_TESTING") != "1" else uid, gid)
    os.chmod(auth_stage, 0o440)
    auth_stage.replace(auth_destination)
    project_parent = projects_root / project_hash / provider
    project_parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    stage = pathlib.Path(tempfile.mkdtemp(prefix="home.next-", dir=project_parent))
    try:
        copy_tree(run_home, stage, {auth_relative, *volatile})
        archive_owner = uid if os.environ.get("MAJOR_PROVIDER_STATE_TESTING") == "1" else 0
        archive_group = gid if os.environ.get("MAJOR_PROVIDER_STATE_TESTING") == "1" else 0
        for parent, dirs, files in os.walk(stage):
            os.chown(parent, archive_owner, archive_group)
            for name in [*dirs, *files]:
                os.chown(pathlib.Path(parent) / name, archive_owner, archive_group)
        destination = project_parent / "home"
        old = project_parent / "home.old"
        if old.exists():
            shutil.rmtree(old)
        if destination.exists():
            destination.rename(old)
        stage.rename(destination)
        if old.exists():
            shutil.rmtree(old)
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def main() -> None:
    if len(sys.argv) != 5 or sys.argv[1] not in {"prepare", "finalize", "reset"}:
        fail("usage: manage-major-provider-state.py <prepare|finalize|reset> <provider> <project-hash> <run-home>")
    action, provider, project_hash = sys.argv[1:4]
    run_home = pathlib.Path(sys.argv[4])
    auth_relative = validate(provider, project_hash, run_home)
    auth_root, projects_root, uid, gid = roots()
    if action == "prepare":
        prepare(auth_root, projects_root, provider, project_hash, run_home, uid, gid, auth_relative)
    elif action == "finalize":
        finalize(auth_root, projects_root, provider, project_hash, run_home, uid, gid, auth_relative)
    else:
        target = projects_root / project_hash / provider
        if target.exists():
            shutil.rmtree(target)


if __name__ == "__main__":
    main()
