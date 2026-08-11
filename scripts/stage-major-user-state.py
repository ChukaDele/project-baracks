#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path

MANAGED_START = "<!-- MAJOR-GLOBAL-START -->"
MANAGED_END = "<!-- MAJOR-GLOBAL-END -->"
OLD_START = "<!-- MAJOR-COMMUNICATION-START -->"
OLD_END = "<!-- MAJOR-COMMUNICATION-END -->"


def read_text(path: Path) -> str:
    if not path.exists():
        return ""
    try:
        return path.read_text()
    except UnicodeDecodeError as exc:
        raise SystemExit(f"refusing to replace non-UTF-8 user file: {path}") from exc


def write_stage_file(stage: Path, name: str, content: str) -> Path:
    path = stage / "files" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return path


def managed_block(text: str, rules: str) -> str:
    if OLD_START in text and OLD_END in text:
        before, rest = text.split(OLD_START, 1)
        _, after = rest.split(OLD_END, 1)
        text = before.rstrip() + "\n\n" + after.lstrip()

    block = f"{MANAGED_START}\n{rules.strip()}\n{MANAGED_END}"
    if MANAGED_START in text and MANAGED_END in text:
        before, rest = text.split(MANAGED_START, 1)
        _, after = rest.split(MANAGED_END, 1)
        parts = [before.rstrip(), block, after.lstrip()]
        return "\n\n".join(part for part in parts if part).rstrip() + "\n"
    return (text.rstrip() + "\n\n" + block).lstrip().rstrip() + "\n"


def claude_root(text: str) -> str:
    text = text.replace(
        "\n# Major global communication style\n@~/.claude/major-communication.md\n",
        "\n",
    )
    text = text.replace("@~/.claude/major-communication.md\n", "")
    if "@~/.claude/major-global.md" not in text:
        text = text.rstrip() + "\n\n# Major global worker rules\n@~/.claude/major-global.md\n"
    return text.rstrip() + "\n"


def claude_settings(path: Path, major_bin: str) -> str:
    raw = read_text(path)
    if not raw.strip():
        data = {}
    else:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"refusing to overwrite malformed Claude settings JSON: {path}") from exc

    if not isinstance(data, dict):
        raise SystemExit(f"Claude settings root must be a JSON object: {path}")

    hooks = data.get("hooks")
    if hooks is None:
        hooks = {}
        data["hooks"] = hooks
    elif not isinstance(hooks, dict):
        raise SystemExit(f"Claude settings hooks must be a JSON object: {path}")

    session = hooks.get("SessionStart")
    if session is None:
        session = []
    elif not isinstance(session, list):
        raise SystemExit(f"Claude settings hooks.SessionStart must be a JSON array: {path}")

    command = f'"{major_bin}" session hook --host claude'
    entry = {
        "matcher": "startup|resume|clear|compact",
        "hooks": [{"type": "command", "command": command}],
    }
    filtered = []
    for item in session:
        item_text = json.dumps(item, sort_keys=True)
        if ("major" in item_text and "session" in item_text and "attach" in item_text) or (
            "session hook --host claude" in item_text
        ):
            continue
        filtered.append(item)
    filtered.append(entry)
    hooks["SessionStart"] = filtered
    return json.dumps(data, indent=2) + "\n"


def zshrc_with_path(text: str) -> str:
    line = 'export PATH="$HOME/.local/bin:$PATH"'
    if line in text:
        return text if text.endswith("\n") or not text else text + "\n"
    return text.rstrip() + "\n\n# Major global CLI\n" + line + "\n"


def add_file(entries: list[dict[str, str]], source: Path, target: Path) -> None:
    entries.append({"type": "file", "source": str(source), "target": str(target)})


def add_absent(entries: list[dict[str, str]], target: Path) -> None:
    entries.append({"type": "absent", "target": str(target)})


def learning_project_path(root: Path, project: str) -> Path:
    key = hashlib.sha256(project.encode()).hexdigest()[:24]
    return root / "projects" / f"{key}.json"


def read_learning_store(path: Path, version: int) -> dict:
    if not path.exists():
        return {"version": version, "candidates": []}
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"refusing to migrate malformed Major learning store: {path}") from exc
    if not isinstance(data, dict) or data.get("version") != version or not isinstance(data.get("candidates"), list):
        raise SystemExit(f"unsupported Major learning store schema: {path}")
    return data


def stage_learning_state(stage: Path, home: Path, entries: list[dict[str, str]]) -> None:
    target = home / ".major" / "learning"
    legacy = home / ".major" / "learning-candidates.json"
    if not target.exists() and not legacy.exists():
        return

    staged = stage / "learning"
    if target.exists():
        if not target.is_dir() or target.is_symlink():
            raise SystemExit(f"Major learning root is not a safe directory: {target}")
        symlink = next((path for path in target.rglob("*") if path.is_symlink()), None)
        if symlink is not None:
            raise SystemExit(f"refusing to migrate symlinked Major learning state: {symlink}")
        shutil.copytree(target, staged, ignore=shutil.ignore_patterns(".migration.lock"))
    else:
        staged.mkdir(parents=True)

    if legacy.exists():
        if legacy.is_symlink():
            raise SystemExit(f"refusing to migrate symlinked Major learning store: {legacy}")
        legacy_store = read_learning_store(legacy, 1)
        quarantine = []
        for raw in legacy_store["candidates"]:
            if not isinstance(raw, dict):
                raise SystemExit(f"invalid legacy Major learning candidate in {legacy}")
            candidate = dict(raw)
            project = candidate.get("project")
            if not isinstance(project, str) or not project.strip():
                quarantine.append(candidate)
                continue
            # Old direct-global capture was not sanitization-safe. Preserve it
            # only in its originating project and require a fresh review.
            candidate["project"] = project
            candidate["scope"] = "project" if candidate.get("scope") == "global" else candidate.get("scope", "undecided")
            if candidate.get("status") == "promoted" and raw.get("scope") == "global":
                candidate["status"] = "candidate"
            path = learning_project_path(staged, project)
            store = read_learning_store(path, 2)
            if not any(item.get("id") == candidate.get("id") for item in store["candidates"] if isinstance(item, dict)):
                store["candidates"].append(candidate)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(store, indent=2) + "\n")
        if quarantine:
            (staged / "legacy-quarantine.json").write_text(
                json.dumps({"version": 1, "candidates": quarantine}, indent=2) + "\n"
            )

    entries.append({"type": "directory", "source": str(staged), "target": str(target)})
    if legacy.exists():
        add_absent(entries, legacy)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--major-bin")
    parser.add_argument("--wrapper")
    parser.add_argument("--record")
    parser.add_argument("--legacy-plist")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    stage = Path(args.stage).expanduser().resolve()
    home = Path.home()
    codex_home = Path(os.environ.get("CODEX_HOME", str(home / ".codex"))).expanduser()

    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)

    global_base = root / "guidance" / "global-worker-rules.md"
    stability = root / "guidance" / "stability-invariants.md"
    skills_src = root / "skills" / "internal"
    for required in (global_base, stability, skills_src):
        if not required.exists():
            raise SystemExit(f"required Major source missing: {required}")

    rules = global_base.read_text().rstrip() + "\n\n" + stability.read_text().strip() + "\n"
    entries: list[dict[str, str]] = []

    stage_learning_state(stage, home, entries)

    global_rules = write_stage_file(stage, "global-worker-rules.md", rules)
    add_file(entries, global_rules, home / ".major" / "global-worker-rules.md")

    skills_stage = stage / "skills" / "internal"
    shutil.copytree(skills_src, skills_stage)
    entries.append(
        {
            "type": "directory",
            "source": str(skills_stage),
            "target": str(home / ".major" / "skills" / "internal"),
        }
    )

    claude_rule = write_stage_file(stage, "claude-major-global.md", rules)
    add_file(entries, claude_rule, home / ".claude" / "major-global.md")

    claude_root_stage = write_stage_file(
        stage,
        "claude-root.md",
        claude_root(read_text(home / ".claude" / "CLAUDE.md")),
    )
    add_file(entries, claude_root_stage, home / ".claude" / "CLAUDE.md")
    add_absent(entries, home / ".claude" / "major-communication.md")

    codex_stage = write_stage_file(
        stage,
        "codex-agents.md",
        managed_block(read_text(codex_home / "AGENTS.md"), rules),
    )
    add_file(entries, codex_stage, codex_home / "AGENTS.md")

    gemini_stage = write_stage_file(
        stage,
        "gemini.md",
        managed_block(read_text(home / ".gemini" / "GEMINI.md"), rules),
    )
    add_file(entries, gemini_stage, home / ".gemini" / "GEMINI.md")

    cursor_stage = write_stage_file(stage, "cursor-rule.md", rules)
    add_file(
        entries,
        cursor_stage,
        home / ".cursor" / "rules" / "major-global" / "RULE.md",
    )

    if args.major_bin:
        settings_stage = write_stage_file(
            stage,
            "claude-settings.json",
            claude_settings(home / ".claude" / "settings.json", args.major_bin),
        )
        add_file(entries, settings_stage, home / ".claude" / "settings.json")

        zsh_stage = write_stage_file(
            stage,
            "zshrc",
            zshrc_with_path(read_text(home / ".zshrc")),
        )
        add_file(entries, zsh_stage, home / ".zshrc")

    for label, source_arg, target in (
        ("record", args.record, home / ".major" / "installed-release.json"),
        ("wrapper", args.wrapper, Path(args.major_bin) if args.major_bin else None),
    ):
        if not source_arg:
            continue
        if target is None:
            raise SystemExit(f"{label} target is unavailable")
        source = Path(source_arg).expanduser().resolve()
        if not source.is_file():
            raise SystemExit(f"staged {label} missing: {source}")
        staged = stage / "files" / f"release-{label}"
        shutil.copy2(source, staged)
        add_file(entries, staged, target)

    if args.legacy_plist:
        add_absent(entries, Path(args.legacy_plist).expanduser().resolve())

    targets = [entry["target"] for entry in entries]
    if len(targets) != len(set(targets)):
        raise SystemExit("duplicate target in Major install manifest")

    manifest = {"version": 1, "entries": entries}
    (stage / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(stage / "manifest.json")


if __name__ == "__main__":
    main()
