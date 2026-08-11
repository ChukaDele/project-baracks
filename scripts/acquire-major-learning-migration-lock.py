#!/usr/bin/env python3
import errno
import os
import sys
import time
from pathlib import Path


STALE_AFTER_SECONDS = 30


def owner_is_live(text: str) -> bool:
    if not text.isdigit() or int(text) <= 0:
        return False
    try:
        os.kill(int(text), 0)
        return True
    except PermissionError:
        return True
    except ProcessLookupError:
        return False


def acquire(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(2):
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as handle:
                handle.write(f"{os.getppid()}\n")
            return
        except FileExistsError:
            try:
                before = path.stat()
            except FileNotFoundError:
                continue
            if time.time() - before.st_mtime <= STALE_AFTER_SECONDS:
                break
            try:
                owner = path.read_text().strip()
            except FileNotFoundError:
                continue
            if owner_is_live(owner):
                break
            try:
                after = path.stat()
            except FileNotFoundError:
                continue
            if (before.st_dev, before.st_ino, before.st_mtime_ns) != (
                after.st_dev,
                after.st_ino,
                after.st_mtime_ns,
            ):
                continue
            try:
                path.unlink()
            except FileNotFoundError:
                pass
    raise SystemExit(
        "ERROR: refusing to install Major while another learning migration is active."
    )


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: acquire-major-learning-migration-lock.py <lock-path>")
    try:
        acquire(Path(sys.argv[1]).expanduser().resolve())
    except OSError as error:
        if error.errno == errno.EEXIST:
            raise SystemExit(
                "ERROR: refusing to install Major while another learning migration is active."
            ) from error
        raise


if __name__ == "__main__":
    main()
