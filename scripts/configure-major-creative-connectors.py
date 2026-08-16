#!/usr/bin/env python3
"""Configure the user-scoped Magnific MCP for Major's supported agent hosts.

This script writes only public endpoint configuration. OAuth remains owned by each
client and is completed on first use. Existing unrelated MCP entries are preserved.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
import tomllib
from pathlib import Path

MAGNIFIC_NAME = "magnific"
MAGNIFIC_URL = "https://mcp.magnific.com"


def load_json_object(path: Path) -> dict:
    if not path.exists():
        return {}
    if path.is_symlink():
        raise SystemExit(f"refusing to modify symlinked MCP config: {path}")
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f"refusing to overwrite malformed JSON config: {path}") from exc
    if not isinstance(data, dict):
        raise SystemExit(f"MCP config root must be a JSON object: {path}")
    return data


def atomic_write_text(path: Path, content: str, dry_run: bool) -> None:
    if dry_run:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    previous_mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(content)
        os.chmod(tmp_name, previous_mode)
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def atomic_write_json(path: Path, data: dict, dry_run: bool) -> None:
    atomic_write_text(path, json.dumps(data, indent=2) + "\n", dry_run)


def merge_server(path: Path, server: dict, dry_run: bool) -> str:
    data = load_json_object(path)
    servers = data.get("mcpServers")
    if servers is None:
        servers = {}
        data["mcpServers"] = servers
    if not isinstance(servers, dict):
        raise SystemExit(f"mcpServers must be a JSON object: {path}")

    previous = servers.get(MAGNIFIC_NAME)
    if previous == server:
        return "already configured"
    if previous is not None:
        return "manual review required (existing Magnific entry differs)"

    servers[MAGNIFIC_NAME] = server
    atomic_write_json(path, data, dry_run)
    return "would configure" if dry_run else "configured"


def run(command: list[str], dry_run: bool) -> subprocess.CompletedProcess[str] | None:
    if dry_run:
        return None
    return subprocess.run(command, text=True, capture_output=True, check=False)


def configure_claude(dry_run: bool) -> str:
    if shutil.which("claude") is None:
        return "skipped (claude CLI not installed)"
    if dry_run:
        return "would configure user-scoped HTTP MCP"

    current = run(["claude", "mcp", "get", MAGNIFIC_NAME], dry_run=False)
    assert current is not None
    if current.returncode == 0 and MAGNIFIC_URL in (current.stdout + current.stderr):
        return "already configured"
    if current.returncode == 0:
        return "manual review required (existing Magnific entry uses another endpoint)"

    added = run(
        [
            "claude",
            "mcp",
            "add",
            "--transport",
            "http",
            "--scope",
            "user",
            MAGNIFIC_NAME,
            MAGNIFIC_URL,
        ],
        dry_run=False,
    )
    assert added is not None
    if added.returncode != 0:
        detail = (added.stderr or added.stdout).strip().splitlines()
        suffix = f": {detail[-1]}" if detail else ""
        return f"failed{suffix}"
    return "configured"


def load_codex_toml(path: Path) -> tuple[str, dict]:
    if not path.exists():
        return "", {}
    if path.is_symlink():
        raise SystemExit(f"refusing to modify symlinked MCP config: {path}")
    raw = path.read_text()
    try:
        parsed = tomllib.loads(raw) if raw.strip() else {}
    except tomllib.TOMLDecodeError as exc:
        raise SystemExit(f"refusing to overwrite malformed Codex TOML config: {path}") from exc
    if not isinstance(parsed, dict):
        raise SystemExit(f"Codex config root must be a TOML table: {path}")
    return raw, parsed


def codex_config_status(parsed: dict) -> str:
    servers = parsed.get("mcp_servers")
    if servers is None:
        return "missing"
    if not isinstance(servers, dict):
        return "manual review required (mcp_servers is not a table)"
    previous = servers.get(MAGNIFIC_NAME)
    if previous is None:
        return "missing"
    if isinstance(previous, dict) and previous.get("url") == MAGNIFIC_URL:
        return "already configured"
    return "manual review required (existing Magnific entry differs)"


def verify_codex_runtime() -> bool | None:
    if shutil.which("codex") is None:
        return None
    checked = subprocess.run(
        ["codex", "mcp", "get", MAGNIFIC_NAME, "--json"],
        text=True,
        capture_output=True,
        check=False,
    )
    return checked.returncode == 0 and MAGNIFIC_URL in (checked.stdout + checked.stderr)


def configure_codex(home: Path, dry_run: bool) -> str:
    """Safely add the global Codex MCP table and prove the parser accepts it.

    We write the minimal URL table directly instead of invoking `codex mcp add
    --url`, because current Codex releases have an open upstream regression where
    that command can emit a config its own loader rejects. A failed runtime check
    rolls the write back immediately.
    """

    path = home / ".codex" / "config.toml"
    raw, parsed = load_codex_toml(path)
    status = codex_config_status(parsed)
    if status != "missing":
        if status == "already configured" and not dry_run:
            runtime_ok = verify_codex_runtime()
            if runtime_ok is False:
                return "configured but Codex runtime verification failed"
        return status

    # TOML inline tables cannot be extended by a later table header. Refuse the
    # uncommon shape rather than risk corrupting the user's global Codex config.
    if re.search(r"(?m)^\s*mcp_servers\s*=", raw):
        return "manual review required (inline mcp_servers table cannot be extended safely)"

    entry = f'[mcp_servers.{MAGNIFIC_NAME}]\nurl = "{MAGNIFIC_URL}"\n'
    prefix = raw
    if prefix and not prefix.endswith("\n"):
        prefix += "\n"
    if prefix.strip():
        prefix += "\n"
    updated = prefix + entry

    if dry_run:
        return "would configure"

    existed = path.exists()
    previous_mode = path.stat().st_mode & 0o777 if existed else None
    atomic_write_text(path, updated, dry_run=False)
    runtime_ok = verify_codex_runtime()
    if runtime_ok is False:
        if existed:
            atomic_write_text(path, raw, dry_run=False)
            if previous_mode is not None:
                os.chmod(path, previous_mode)
        else:
            path.unlink(missing_ok=True)
        return "failed runtime verification; rolled back Codex config"
    if runtime_ok is None:
        return "configured (Codex CLI unavailable for runtime verification)"
    return "configured and parser-verified"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--skip-claude-cli",
        action="store_true",
        help="skip the native Claude CLI call; intended for tests or staged setup",
    )
    args = parser.parse_args()

    home = args.home.expanduser().resolve()
    results: list[tuple[str, str]] = []

    # Cursor: Magnific's documented global MCP JSON shape.
    results.append(
        (
            "Cursor",
            merge_server(
                home / ".cursor" / "mcp.json",
                {"url": MAGNIFIC_URL},
                args.dry_run,
            ),
        )
    )

    # Gemini CLI: streamable HTTP uses httpUrl in user settings.
    results.append(
        (
            "Gemini CLI",
            merge_server(
                home / ".gemini" / "settings.json",
                {"httpUrl": MAGNIFIC_URL},
                args.dry_run,
            ),
        )
    )

    # Antigravity 2.0: remote servers use serverUrl in the global MCP profile.
    results.append(
        (
            "Antigravity",
            merge_server(
                home / ".gemini" / "config" / "mcp_config.json",
                {"serverUrl": MAGNIFIC_URL},
                args.dry_run,
            ),
        )
    )

    # Codex uses a global ~/.codex/config.toml MCP table. The helper validates
    # the existing TOML, writes only a new Magnific subtable, and rolls back if
    # an installed Codex CLI cannot parse/resolve the new entry.
    results.append(("Codex", configure_codex(home, args.dry_run)))

    if args.skip_claude_cli:
        results.append(("Claude Code", "skipped by flag"))
    else:
        results.append(("Claude Code", configure_claude(args.dry_run)))

    print("Magnific MCP configuration")
    for host, status in results:
        print(f"- {host}: {status}")
    print(f"- endpoint: {MAGNIFIC_URL}")
    print("- OAuth: complete the Magnific sign-in once in each host when first prompted")
    print("- Openverse fallback: no connector install required; Major uses its public image/audio API")


if __name__ == "__main__":
    main()
