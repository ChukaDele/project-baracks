#!/usr/bin/env python3
"""Configure the user-scoped Magnific MCP for Major's supported agent hosts.

This script writes only public endpoint configuration. OAuth remains owned by each
client and is completed on first use. Existing unrelated MCP entries are preserved.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
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


def atomic_write_json(path: Path, data: dict, dry_run: bool) -> None:
    if dry_run:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    previous_mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(data, handle, indent=2)
            handle.write("\n")
        os.chmod(tmp_name, previous_mode)
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


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


def configure_codex(dry_run: bool) -> str:
    if shutil.which("codex") is None:
        return "skipped (codex CLI not installed)"
    if dry_run:
        return "would configure streamable HTTP MCP"

    listed = run(["codex", "mcp", "list"], dry_run=False)
    assert listed is not None
    combined = listed.stdout + listed.stderr
    if listed.returncode == 0 and MAGNIFIC_NAME in combined and MAGNIFIC_URL in combined:
        return "already configured"
    if listed.returncode == 0 and MAGNIFIC_NAME in combined:
        return "manual review required (existing Magnific entry uses another endpoint)"

    added = run(["codex", "mcp", "add", MAGNIFIC_NAME, "--url", MAGNIFIC_URL], dry_run=False)
    assert added is not None
    if added.returncode != 0:
        detail = (added.stderr or added.stdout).strip().splitlines()
        suffix = f": {detail[-1]}" if detail else ""
        return f"failed{suffix}"
    return "configured"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--skip-native-clis",
        action="store_true",
        help="configure JSON-based hosts only; intended for tests or staged setup",
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

    # Claude and Codex have native MCP config CLIs; use them rather than guessing
    # internal config formats. Both calls are idempotent for the canonical URL.
    if args.skip_native_clis:
        results.append(("Claude Code", "skipped by flag"))
        results.append(("Codex", "skipped by flag"))
    else:
        results.append(("Claude Code", configure_claude(args.dry_run)))
        results.append(("Codex", configure_codex(args.dry_run)))

    print("Magnific MCP configuration")
    for host, status in results:
        print(f"- {host}: {status}")
    print(f"- endpoint: {MAGNIFIC_URL}")
    print("- OAuth: complete the Magnific sign-in once in each host when first prompted")
    print("- Openverse fallback: no connector install required; Major uses its public image/audio API")


if __name__ == "__main__":
    main()
