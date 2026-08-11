#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import signal
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Optional


class ActivationInterrupted(RuntimeError):
    pass


INSTALL_SIGNALS = {signal.SIGINT, signal.SIGTERM, signal.SIGHUP}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    return parser.parse_args()


def remove_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)


def load_manifest(path: Path) -> list[dict[str, str]]:
    try:
        manifest: Any = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"invalid Major install manifest: {path}: {exc}") from exc

    if not isinstance(manifest, dict) or manifest.get("version") != 1:
        raise SystemExit("Major install manifest version must be 1")
    entries = manifest.get("entries")
    if not isinstance(entries, list) or not entries:
        raise SystemExit("Major install manifest entries must be a non-empty array")

    validated: list[dict[str, str]] = []
    targets: set[str] = set()
    for index, raw in enumerate(entries):
        if not isinstance(raw, dict):
            raise SystemExit(f"Major install manifest entry {index} must be an object")
        entry_type = raw.get("type")
        target_raw = raw.get("target")
        if entry_type not in {"file", "directory", "absent"}:
            raise SystemExit(f"unsupported Major install entry type at {index}: {entry_type}")
        if not isinstance(target_raw, str) or not Path(target_raw).is_absolute():
            raise SystemExit(f"Major install target must be absolute at entry {index}")
        target = str(Path(target_raw))
        if target in targets:
            raise SystemExit(f"duplicate Major install target: {target}")
        targets.add(target)

        entry = {"type": entry_type, "target": target}
        if entry_type != "absent":
            source_raw = raw.get("source")
            if not isinstance(source_raw, str):
                raise SystemExit(f"Major install source missing at entry {index}")
            source = Path(source_raw)
            expected = source.is_file() if entry_type == "file" else source.is_dir()
            if not expected or source.is_symlink():
                raise SystemExit(f"invalid staged {entry_type} source: {source}")
            entry["source"] = str(source)
        validated.append(entry)
    return validated


def install_source(entry: dict[str, str], temporary: Path) -> None:
    source = Path(entry["source"])
    if entry["type"] == "file":
        shutil.copy2(source, temporary)
    else:
        shutil.copytree(source, temporary)


def activate(entries: list[dict[str, str]]) -> None:
    transaction = uuid.uuid4().hex
    fail_raw = os.environ.get("MAJOR_INSTALL_FAIL_AFTER", "")
    pause_raw = os.environ.get("MAJOR_INSTALL_PAUSE_AFTER", "")
    try:
        fail_after = int(fail_raw) if fail_raw else None
        pause_after = int(pause_raw) if pause_raw else None
    except ValueError as exc:
        raise SystemExit("Major install failure/pause controls must be integers") from exc
    if any(value is not None and value < 0 for value in (fail_after, pause_after)):
        raise SystemExit("Major install failure/pause controls must not be negative")

    touched: list[tuple[Path, Optional[Path]]] = []
    created_parents: list[Path] = []
    temporaries: set[Path] = set()

    def interrupted(signum: int, _frame: object) -> None:
        raise ActivationInterrupted(f"received signal {signum}")

    previous_handlers = {
        signum: signal.signal(signum, interrupted)
        for signum in INSTALL_SIGNALS
    }

    try:
        if fail_after == 0:
            raise RuntimeError("injected Major install failure before activation")
        for index, entry in enumerate(entries):
            target = Path(entry["target"])
            missing_parents: list[Path] = []
            parent = target.parent
            while not parent.exists():
                missing_parents.append(parent)
                parent = parent.parent
            target.parent.mkdir(parents=True, exist_ok=True)
            created_parents.extend(reversed(missing_parents))

            backup: Optional[Path] = None
            previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, INSTALL_SIGNALS)
            try:
                if target.exists() or target.is_symlink():
                    backup = target.parent / f".{target.name}.major-rollback-{transaction}-{index}"
                    os.replace(target, backup)
                touched.append((target, backup))
            finally:
                signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)

            if pause_after is not None and len(touched) == pause_after:
                time.sleep(30)

            if entry["type"] != "absent":
                temporary = target.parent / f".{target.name}.major-install-{transaction}-{index}"
                temporaries.add(temporary)
                install_source(entry, temporary)
                os.replace(temporary, target)
                temporaries.remove(temporary)

            if fail_after is not None and len(touched) == fail_after:
                raise RuntimeError(f"injected Major install failure after {fail_after} targets")
    except BaseException:
        for signum in previous_handlers:
            signal.signal(signum, signal.SIG_IGN)
        rollback_errors: list[str] = []
        for target, backup in reversed(touched):
            try:
                remove_path(target)
                if backup is not None and (backup.exists() or backup.is_symlink()):
                    os.replace(backup, target)
            except OSError as exc:
                rollback_errors.append(f"{target}: {exc}")
        for parent in reversed(created_parents):
            try:
                parent.rmdir()
            except OSError:
                pass
        for temporary in temporaries:
            try:
                remove_path(temporary)
            except OSError as exc:
                rollback_errors.append(f"{temporary}: {exc}")
        if rollback_errors:
            print("CRITICAL: Major install rollback was incomplete:", file=sys.stderr)
            print("\n".join(rollback_errors), file=sys.stderr)
        raise
    else:
        for signum in previous_handlers:
            signal.signal(signum, signal.SIG_IGN)
        for _, backup in touched:
            if backup is not None:
                try:
                    remove_path(backup)
                except OSError as exc:
                    print(f"WARN: committed Major install left rollback backup {backup}: {exc}", file=sys.stderr)
    finally:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)


def main() -> None:
    manifest = Path(parse_args().manifest).expanduser().resolve()
    entries = load_manifest(manifest)
    try:
        activate(entries)
    except ActivationInterrupted as exc:
        raise SystemExit(f"Major install interrupted; live state restored: {exc}") from exc
    except RuntimeError as exc:
        raise SystemExit(f"Major install failed; live state restored: {exc}") from exc


if __name__ == "__main__":
    main()
