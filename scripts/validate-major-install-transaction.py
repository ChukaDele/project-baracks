#!/usr/bin/env python3
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Optional


ROOT = Path(__file__).resolve().parent.parent
STAGER = ROOT / "scripts" / "stage-major-user-state.py"
ACTIVATOR = ROOT / "scripts" / "activate-major-user-state.py"


def write(path: Path, content: str, mode: Optional[int] = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    if mode is not None:
        path.chmod(mode)


def snapshot(root: Path) -> dict[str, tuple[str, int, str]]:
    result: dict[str, tuple[str, int, str]] = {}
    if not root.exists():
        return result
    for path in sorted(root.rglob("*")):
        relative = str(path.relative_to(root))
        mode = stat.S_IMODE(path.lstat().st_mode)
        if path.is_symlink():
            result[relative] = ("symlink", mode, os.readlink(path))
        elif path.is_dir():
            result[relative] = ("directory", mode, "")
        else:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            result[relative] = ("file", mode, digest)
    return result


def run(
    args: list[str], env: dict[str, str], expect_success: bool = True
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, env=env, text=True, capture_output=True, check=False)
    if expect_success and result.returncode != 0:
        raise AssertionError(f"command failed: {' '.join(args)}\n{result.stderr}")
    if not expect_success and result.returncode == 0:
        raise AssertionError(f"command unexpectedly succeeded: {' '.join(args)}")
    return result


def stage(
    stage_dir: Path,
    home: Path,
    env: dict[str, str],
    wrapper: Path,
    record: Path,
) -> Path:
    legacy = home / "Library" / "LaunchAgents" / "com.chuka.major-supervisor.plist"
    result = run(
        [
            sys.executable,
            str(STAGER),
            "--root",
            str(ROOT),
            "--stage",
            str(stage_dir),
            "--major-bin",
            str(home / ".local" / "bin" / "major"),
            "--wrapper",
            str(wrapper),
            "--record",
            str(record),
            "--legacy-plist",
            str(legacy),
        ],
        env,
    )
    return Path(result.stdout.strip())


def assert_invalid_settings_are_safe(temp: Path, env: dict[str, str]) -> None:
    home = temp / "invalid-home"
    settings = home / ".claude" / "settings.json"
    write(settings, "{not-json\n")
    before = snapshot(home)
    result = run(
        [
            sys.executable,
            str(STAGER),
            "--root",
            str(ROOT),
            "--stage",
            str(temp / "invalid-stage"),
            "--major-bin",
            str(home / ".local" / "bin" / "major"),
        ],
        {**env, "HOME": str(home), "CODEX_HOME": str(home / ".codex")},
        expect_success=False,
    )
    assert "malformed Claude settings" in result.stderr
    assert snapshot(home) == before, "staging malformed settings changed live state"


def assert_installer_preflight_is_safe(temp: Path, env: dict[str, str]) -> None:
    remote = temp / "origin.git"
    seed = temp / "seed"
    checkout = temp / "checkout"
    run(["git", "init", "--bare", "--initial-branch=main", str(remote)], env)
    run(["git", "init", "--initial-branch=main", str(seed)], env)
    run(["git", "-C", str(seed), "config", "user.name", "Major Validation"], env)
    run(["git", "-C", str(seed), "config", "user.email", "major-validation@example.invalid"], env)
    (seed / "scripts").mkdir()
    shutil.copy2(ROOT / "scripts" / "install-major-runtime.sh", seed / "scripts")
    write(seed / "package.json", '{"version":"0.5.1"}\n')
    run(["git", "-C", str(seed), "add", "."], env)
    run(["git", "-C", str(seed), "commit", "-m", "first"], env)
    run(["git", "-C", str(seed), "remote", "add", "origin", str(remote)], env)
    run(["git", "-C", str(seed), "push", "-u", "origin", "main"], env)
    run(["git", "clone", str(remote), str(checkout)], env)

    fake_home = temp / "preflight-home"
    installer_env = {**env, "HOME": str(fake_home)}
    write(checkout / "dirty", "uncommitted\n")
    before = snapshot(fake_home)
    dirty = run(
        ["bash", str(checkout / "scripts" / "install-major-runtime.sh")],
        installer_env,
        expect_success=False,
    )
    assert "dirty checkout" in dirty.stderr
    assert snapshot(fake_home) == before, "dirty-checkout rejection changed user state"
    (checkout / "dirty").unlink()

    write(seed / "remote-advance", "new origin main\n")
    run(["git", "-C", str(seed), "add", "remote-advance"], env)
    run(["git", "-C", str(seed), "commit", "-m", "advance"], env)
    run(["git", "-C", str(seed), "push", "origin", "main"], env)
    mismatch = run(
        ["bash", str(checkout / "scripts" / "install-major-runtime.sh")],
        installer_env,
        expect_success=False,
    )
    assert "local HEAD is not the current origin/main" in mismatch.stderr
    assert snapshot(fake_home) == before, "origin/main rejection changed user state"


def seed_home(home: Path, codex_home: Path) -> None:
    write(home / ".major" / "global-worker-rules.md", "old global rules\n")
    write(home / ".major" / "skills" / "internal" / "old-skill" / "SKILL.md", "old\n")
    write(home / ".major" / "installed-release.json", '{"sha":"old"}\n')
    write(
        home / ".major" / "learning-candidates.json",
        json.dumps(
            {
                "version": 1,
                "candidates": [
                    {
                        "id": "legacy-project-global",
                        "project": "private-client",
                        "repoPath": "/private/client",
                        "source": "user-correction",
                        "summary": "Private client evidence must remain local. API_KEY=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA",
                        "scope": "global",
                        "occurrences": 2,
                        "evidence": ["candidate@example.com Bearer eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"],
                        "status": "promoted",
                        "createdAt": "2026-01-01T00:00:00.000Z",
                        "updatedAt": "2026-01-01T00:00:00.000Z",
                    },
                    {
                        "id": "legacy-unowned",
                        "source": "manual",
                        "summary": "Unknown legacy ownership.",
                        "scope": "global",
                        "occurrences": 1,
                        "evidence": [],
                        "status": "candidate",
                        "createdAt": "2026-01-01T00:00:00.000Z",
                        "updatedAt": "2026-01-01T00:00:00.000Z",
                    },
                ],
            },
            indent=2,
        )
        + "\n",
    )
    write(home / ".claude" / "major-global.md", "old claude rules\n")
    write(home / ".claude" / "major-communication.md", "obsolete but recoverable\n")
    write(home / ".claude" / "CLAUDE.md", "user claude rule\n")
    write(
        home / ".claude" / "settings.json",
        json.dumps(
            {
                "permissions": {"allow": ["Read"]},
                "hooks": {
                    "SessionStart": [
                        {"matcher": "startup", "hooks": [{"type": "command", "command": "keep-me"}]}
                    ]
                },
            },
            indent=2,
        )
        + "\n",
    )
    write(codex_home / "AGENTS.md", "user codex rule\n")
    write(home / ".cursor" / "rules" / "major-global" / "RULE.md", "old cursor rule\n")
    write(home / ".zshrc", "# user shell\n")
    write(home / ".local" / "bin" / "major", "#!/bin/sh\necho old-major\n", 0o755)
    write(
        home / "Library" / "LaunchAgents" / "com.chuka.major-supervisor.plist",
        "old daemon definition\n",
    )


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="major-install-transaction-") as raw_temp:
        temp = Path(raw_temp)
        base_env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
        assert_installer_preflight_is_safe(temp, base_env)
        assert_invalid_settings_are_safe(temp, base_env)

        home = temp / "home"
        codex_home = home / ".codex-custom"
        env = {**base_env, "HOME": str(home), "CODEX_HOME": str(codex_home)}
        seed_home(home, codex_home)
        wrapper = temp / "new-major"
        record = temp / "new-release.json"
        write(wrapper, "#!/bin/sh\necho new-major\n", 0o755)
        write(record, '{"sha":"new","runtimeImmutableSnapshot":true}\n')

        before = snapshot(home)
        manifest = stage(temp / "stage-failure", home, env, wrapper, record)
        assert snapshot(home) == before, "staging changed live user state"

        entry_count = len(json.loads(manifest.read_text())["entries"])
        for fail_after in sorted({1, 7, entry_count}):
            failed_env = {**env, "MAJOR_INSTALL_FAIL_AFTER": str(fail_after)}
            result = run(
                [sys.executable, str(ACTIVATOR), "--manifest", str(manifest)],
                failed_env,
                expect_success=False,
            )
            assert "live state restored" in result.stderr
            assert snapshot(home) == before, (
                f"failed activation after target {fail_after} did not restore live state exactly"
            )
            assert not any(
                "major-rollback" in path or "major-install" in path for path in snapshot(home)
            )

        signal_process = subprocess.Popen(
            [sys.executable, str(ACTIVATOR), "--manifest", str(manifest)],
            env={**env, "MAJOR_INSTALL_PAUSE_AFTER": "1"},
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and not any(home.rglob("*.major-rollback-*")):
            if signal_process.poll() is not None:
                break
            time.sleep(0.01)
        assert signal_process.poll() is None, "signal probe exited before its rollback point"
        signal_process.terminate()
        _, signal_stderr = signal_process.communicate(timeout=5)
        assert signal_process.returncode != 0
        assert "live state restored" in signal_stderr
        assert snapshot(home) == before, "interrupted activation did not restore live state exactly"

        run([sys.executable, str(ACTIVATOR), "--manifest", str(manifest)], env)
        after_success = snapshot(home)
        assert (home / ".local" / "bin" / "major").read_text() == wrapper.read_text()
        assert stat.S_IMODE((home / ".local" / "bin" / "major").stat().st_mode) == 0o755
        assert json.loads((home / ".major" / "installed-release.json").read_text())["sha"] == "new"
        settings = json.loads((home / ".claude" / "settings.json").read_text())
        assert settings["permissions"] == {"allow": ["Read"]}
        assert any(
            hook.get("hooks", [{}])[0].get("command") == "keep-me"
            for hook in settings["hooks"]["SessionStart"]
        )
        assert "session hook --host claude" in json.dumps(settings)
        assert not (home / ".claude" / "major-communication.md").exists()
        assert not (home / "Library" / "LaunchAgents" / "com.chuka.major-supervisor.plist").exists()
        assert 'export PATH="$HOME/.local/bin:$PATH"' in (home / ".zshrc").read_text()
        assert (home / ".major" / "skills" / "internal" / "skill-resolver" / "SKILL.md").is_file()
        learning_root = home / ".major" / "learning"
        assert not (learning_root / "global.json").exists()
        project_files = list((learning_root / "projects").glob("*.json"))
        assert len(project_files) == 1
        migrated = json.loads(project_files[0].read_text())["candidates"][0]
        assert migrated["id"] == "legacy-project-global"
        assert migrated["scope"] == "project"
        assert migrated["status"] == "candidate"
        assert "sk-ant-api03" not in json.dumps(migrated)
        assert "e" * 32 not in json.dumps(migrated)
        assert "[REDACTED]" in json.dumps(migrated)
        assert json.loads((learning_root / "legacy-quarantine.json").read_text())["candidates"][0]["id"] == "legacy-unowned"
        assert not (home / ".major" / "learning-candidates.json").exists()

        second_manifest = stage(temp / "stage-idempotent", home, env, wrapper, record)
        run([sys.executable, str(ACTIVATOR), "--manifest", str(second_manifest)], env)
        assert snapshot(home) == after_success, "successful activation is not idempotent"

    print("Major install transaction validation passed.")


if __name__ == "__main__":
    main()
