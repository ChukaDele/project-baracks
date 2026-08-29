#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

MANAGED_START = "<!-- MAJOR-GLOBAL-START -->"
MANAGED_END = "<!-- MAJOR-GLOBAL-END -->"
OLD_START = "<!-- MAJOR-COMMUNICATION-START -->"
OLD_END = "<!-- MAJOR-COMMUNICATION-END -->"
CANONICAL_SKILL_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def validate_catalog_skills(catalog: dict) -> list[dict]:
    skills = catalog.get("entries")
    if not isinstance(skills, list):
        raise SystemExit("invalid generated skill catalogue entries")
    owners: dict[str, str] = {}
    for skill in skills:
        skill_id = skill.get("id") if isinstance(skill, dict) else None
        aliases = skill.get("aliases", []) if isinstance(skill, dict) else None
        if not isinstance(skill_id, str) or not CANONICAL_SKILL_SLUG.fullmatch(skill_id):
            raise SystemExit("invalid generated skill catalogue id: safe canonical slug required")
        if not isinstance(aliases, list):
            raise SystemExit(f"invalid generated skill catalogue aliases: {skill_id}")
        for slug in [skill_id, *aliases]:
            if not isinstance(slug, str) or not CANONICAL_SKILL_SLUG.fullmatch(slug):
                raise SystemExit(f"invalid generated skill catalogue alias: {skill_id}")
            if slug in owners and owners[slug] != skill_id:
                raise SystemExit(f"duplicate generated skill id or alias: {slug}")
            owners[slug] = skill_id
    return skills


def contained_command_path(root: Path, skill_id: str, suffix: str) -> Path:
    if not CANONICAL_SKILL_SLUG.fullmatch(skill_id):
        raise SystemExit("generated command id must be a safe canonical slug")
    target = (root / "major" / f"{skill_id}{suffix}").resolve()
    command_root = (root / "major").resolve()
    if command_root not in target.parents:
        raise SystemExit("generated command path escapes its root")
    return target


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


def _merge_command_hook(
    path: Path,
    *,
    versioned: bool,
    event: str,
    matcher: str | None,
    command: str,
    marker: str,
    extra_handler_fields: dict | None = None,
) -> str:
    raw = read_text(path)
    if not raw.strip():
        data: dict = {}
    else:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"refusing to overwrite malformed hooks JSON: {path}") from exc
    if not isinstance(data, dict):
        raise SystemExit(f"hooks root must be a JSON object: {path}")

    if versioned:
        data.setdefault("version", 1)
    hooks_root = data.setdefault("hooks", {})
    if not isinstance(hooks_root, dict):
        raise SystemExit(f"hooks.{event} container must be a JSON object: {path}")

    existing = hooks_root.get(event)
    if existing is None:
        existing = []
    elif not isinstance(existing, list):
        raise SystemExit(f"hooks.{event} must be a JSON array: {path}")

    filtered = [item for item in existing if marker not in json.dumps(item, sort_keys=True)]
    handler = {"type": "command", "command": command, **(extra_handler_fields or {})}
    entry = {"matcher": matcher, "hooks": [handler]} if matcher is not None else handler
    filtered.append(entry)
    hooks_root[event] = filtered
    return json.dumps(data, indent=2) + "\n"


def codex_hooks(path: Path, major_bin: str) -> str:
    command = f'"{major_bin}" session hook --host codex --envelope codex-session-start'
    return _merge_command_hook(
        path,
        versioned=False,
        event="SessionStart",
        matcher="startup|resume|clear|compact",
        command=command,
        marker="session hook --host codex",
        # Default additionalContextLimit is 2500 tokens; Major's banner
        # (goal state, learnings, resolved skills, resource guard) regularly
        # exceeds that and would otherwise be silently truncated.
        extra_handler_fields={"additionalContextLimit": 8000},
    )


def cursor_hooks(path: Path, major_bin: str) -> str:
    command = f'"{major_bin}" session hook --host cursor --envelope cursor-session-start'
    return _merge_command_hook(
        path,
        versioned=True,
        event="sessionStart",
        matcher=None,
        command=command,
        marker="session hook --host cursor",
    )


def antigravity_plugin_hooks(major_bin: str) -> str:
    command = f'"{major_bin}" session hook --host antigravity --envelope antigravity-pre-invocation'
    data = {
        "major-attach": {
            "PreInvocation": [{"type": "command", "command": command, "timeout": 10}],
        }
    }
    return json.dumps(data, indent=2) + "\n"


def cursor_mdc_rule(rules: str) -> str:
    return (
        "---\n"
        "description: Major global worker rules\n"
        "alwaysApply: true\n"
        "---\n\n" + rules.strip() + "\n"
    )


def gemini_plugins_json(path: Path, plugin_path: str) -> str:
    raw = read_text(path)
    if not raw.strip():
        data: dict = {}
    else:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"refusing to overwrite malformed Antigravity plugins JSON: {path}") from exc
    if not isinstance(data, dict):
        raise SystemExit(f"Antigravity plugins.json root must be a JSON object: {path}")

    entries = data.get("entries")
    if entries is None:
        entries = []
    elif not isinstance(entries, list):
        raise SystemExit(f"Antigravity plugins.json entries must be a JSON array: {path}")

    filtered = [
        item
        for item in entries
        if not (isinstance(item, dict) and item.get("path") == plugin_path)
    ]
    filtered.append({"path": plugin_path})
    data["entries"] = filtered
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


def stage_skill_commands(
    stage: Path, home: Path, codex_home: Path, catalog: dict, entries: list[dict[str, str]]
) -> None:
    skills = validate_catalog_skills(catalog)
    discovery = (
        "Use Major's installed canonical catalogue. Run `major skill search --query \"$ARGUMENTS\"` "
        "for discovery, or `major skill resolve --task \"$ARGUMENTS\" --json` for automatic routing.\n"
    )
    command_roots = (
        ("claude", home / ".claude" / "commands", ".md"),
        ("codex", codex_home / "prompts", ".md"),
        ("cursor", home / ".cursor" / "commands", ".md"),
    )
    for host, target_root, suffix in command_roots:
        add_file(entries, write_stage_file(stage, f"{host}-major{suffix}", discovery), target_root / f"major{suffix}")
        for skill in skills:
            skill_id = skill.get("id") if isinstance(skill, dict) else None
            if not isinstance(skill_id, str):
                raise SystemExit("invalid generated skill catalogue id")
            body = f'Run `major skill resolve --task "$ARGUMENTS" --skill {skill_id} --json`; the named skill is mandatory.\n'
            add_file(
                entries,
                write_stage_file(stage, f"{host}-major-{skill_id}{suffix}", body),
                contained_command_path(target_root, skill_id, suffix),
            )
    add_file(
        entries,
        write_stage_file(
            stage,
            "gemini-major.toml",
            'description = "Discover or automatically resolve Major skills"\nprompt = "Run `major skill search --query {{args}}` and report the installed matches."\n',
        ),
        home / ".gemini" / "commands" / "major.toml",
    )
    for skill in skills:
        skill_id = skill["id"]
        add_file(
            entries,
            write_stage_file(
                stage,
                f"gemini-major-{skill_id}.toml",
                f'description = "Invoke Major skill {skill_id}"\nprompt = "Run `major skill resolve --task {{{{args}}}} --skill {skill_id} --json`; the named skill is mandatory."\n',
            ),
            contained_command_path(home / ".gemini" / "commands", skill_id, ".toml"),
        )


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


LEARNING_SECRET_PATTERNS = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
    re.compile(r"\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{16,}"),
]
LEARNING_KEY_VALUE = re.compile(
    r"""([A-Za-z0-9_-]*(?:password|passwd|secret|token|api[_-]?key|apikey|private[_-]?key|client[_-]?secret|credential)s?[A-Za-z0-9_-]*["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"',;}]+)""",
    re.IGNORECASE,
)
GLOBAL_PII_PATTERNS = [
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    re.compile(r"\b(?:\+?\d[\d\s().-]{7,}\d)\b"),
    re.compile(r"\b(?:https?://|git@|ssh://)", re.IGNORECASE),
    re.compile(r"""(?:^|[\s("'])(?:/(?:Users|home|private|tmp|etc|opt|var)/|[A-Za-z]:\\)""", re.IGNORECASE),
    re.compile(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b"),
    re.compile(r"\b(?:Ltd|Limited|LLC|Inc|Corp|Corporation|PLC)\b", re.IGNORECASE),
]


def redact_learning_text(value: str) -> str:
    out = value
    for pattern in LEARNING_SECRET_PATTERNS:
        out = pattern.sub("[REDACTED]", out)
    out = LEARNING_KEY_VALUE.sub(lambda match: match.group(1) + "[REDACTED]", out)
    return out


def global_summary_is_safe(value: str) -> bool:
    return redact_learning_text(value) == value and not any(
        pattern.search(value) for pattern in GLOBAL_PII_PATTERNS
    )


def sanitize_staged_learning(staged: Path) -> None:
    for path in staged.rglob("*.json"):
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        candidates = data.get("candidates") if isinstance(data, dict) else None
        if not isinstance(candidates, list):
            continue
        sanitized = []
        for raw in candidates:
            if not isinstance(raw, dict):
                continue
            candidate = dict(raw)
            raw_summary = str(candidate.get("summary", ""))
            candidate["summary"] = redact_learning_text(raw_summary)
            evidence = candidate.get("evidence", [])
            candidate["evidence"] = [
                redact_learning_text(str(item)) for item in evidence if isinstance(item, str)
            ]
            if path.name == "global.json":
                promoted_safe = (
                    candidate.get("scope") == "global"
                    and candidate.get("status") == "promoted"
                    and not any(
                        key in candidate
                        for key in ("key", "project", "repoPath", "promotedToGlobalId")
                    )
                    and global_summary_is_safe(raw_summary)
                    and candidate["evidence"]
                    and all(
                        re.fullmatch(r"promotion-evidence-sha256:[a-f0-9]{64}", item)
                        for item in candidate["evidence"]
                    )
                )
                dismissed_safe = (
                    candidate.get("scope") == "global"
                    and candidate.get("status") == "dismissed"
                    and candidate.get("summary") == "Retracted global learning."
                    and candidate.get("occurrences") == 0
                    and len(candidate["evidence"]) == 1
                    and re.fullmatch(
                        r"dismissal-reason-sha256:[a-f0-9]{64}",
                        candidate["evidence"][0],
                    )
                )
                if not promoted_safe and not dismissed_safe:
                    record_id = str(candidate.get("id", "unknown"))
                    raise SystemExit(
                        f"refusing to migrate unsafe or malformed global Major learning record: {record_id}"
                    )
            sanitized.append(candidate)
        data["candidates"] = sanitized
        path.write_text(json.dumps(data, indent=2) + "\n")
        path.chmod(0o600)
    for directory in [staged, *[path for path in staged.rglob("*") if path.is_dir()]]:
        directory.chmod(0o700)


def stage_learning_state(stage: Path, home: Path, entries: list[dict[str, str]]) -> None:
    target = home / ".major" / "learning"
    legacy = home / ".major" / "learning-candidates.json"
    if not target.exists() and not legacy.exists():
        return

    staged = stage / "learning"
    if target.exists():
        if not target.is_dir() or target.is_symlink():
            raise SystemExit(f"Major learning root is not a safe directory: {target}")
        # Installers create .migration.lock before invoking this stager. New
        # writers therefore wait. Drain writers that acquired a per-store
        # lock just before the migration lock appeared before taking the
        # snapshot that activation will install.
        deadline = time.monotonic() + 10
        while True:
            active_locks = [
                path
                for path in target.rglob("*.lock")
                if path.name != ".migration.lock"
            ]
            if not active_locks:
                break
            if time.monotonic() >= deadline:
                names = ", ".join(str(path) for path in active_locks[:3])
                raise SystemExit(
                    f"refusing to migrate Major learning while writers remain active: {names}"
                )
            time.sleep(0.01)
        symlink = next((path for path in target.rglob("*") if path.is_symlink()), None)
        if symlink is not None:
            raise SystemExit(f"refusing to migrate symlinked Major learning state: {symlink}")
        shutil.copytree(target, staged)
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

    sanitize_staged_learning(staged)
    entries.append({"type": "directory", "source": str(staged), "target": str(target)})
    # Preserve the legacy source until a later, verified cleanup. An old
    # foreground 0.5.0 process does not honour the new migration lock, so
    # deleting this file during activation could discard a concurrent write.


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--major-bin")
    parser.add_argument("--wrapper")
    parser.add_argument("--record")
    parser.add_argument("--global-rules-record")
    parser.add_argument("--legacy-plist")
    parser.add_argument("--execution-path", choices=("host", "lima"))
    parser.add_argument("--execution-config")
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
    catalog_src = root / "guidance" / "skills.catalog.json"
    adapters_src = root / "adapters" / "skills"
    for required in (global_base, stability, skills_src, catalog_src, adapters_src):
        if not required.exists():
            raise SystemExit(f"required Major source missing: {required}")

    rules = global_base.read_text().rstrip() + "\n\n" + stability.read_text().strip() + "\n"
    entries: list[dict[str, str]] = []

    if args.execution_path == "lima" and not args.execution_config:
        raise SystemExit("Lima execution path requires an execution config")
    if args.execution_path == "host" and args.execution_config:
        raise SystemExit("host execution path must not stage a Lima execution config")

    stage_learning_state(stage, home, entries)

    global_rules = write_stage_file(stage, "global-worker-rules.md", rules)
    add_file(entries, global_rules, home / ".major" / "global-worker-rules.md")
    catalog_stage = write_stage_file(stage, "skills.catalog.json", catalog_src.read_text())
    add_file(entries, catalog_stage, home / ".major" / "skills.catalog.json")
    catalog = json.loads(catalog_src.read_text())
    stage_skill_commands(stage, home, codex_home, catalog, entries)

    skills_stage = stage / "skills" / "internal"
    shutil.copytree(skills_src, skills_stage)
    entries.append(
        {
            "type": "directory",
            "source": str(skills_stage),
            "target": str(home / ".major" / "skills" / "internal"),
        }
    )

    claude_rule = write_stage_file(
        stage, "claude-major-global.md", rules + "\n" + (adapters_src / "CLAUDE.md").read_text()
    )
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
        managed_block(
            read_text(codex_home / "AGENTS.md"),
            rules + "\n" + (adapters_src / "CODEX.md").read_text(),
        ),
    )
    add_file(entries, codex_stage, codex_home / "AGENTS.md")

    gemini_stage = write_stage_file(
        stage,
        "gemini.md",
        managed_block(
            read_text(home / ".gemini" / "GEMINI.md"),
            rules + "\n" + (adapters_src / "GEMINI.md").read_text(),
        ),
    )
    add_file(entries, gemini_stage, home / ".gemini" / "GEMINI.md")

    # Cursor rules require the .mdc extension with YAML frontmatter
    # (description/globs/alwaysApply); a bare .md file is silently not
    # loaded. Clean up the earlier, incorrectly-formatted file on upgrade.
    cursor_stage = write_stage_file(
        stage,
        "cursor-rule.mdc",
        cursor_mdc_rule(rules + "\n" + (adapters_src / "RULE.mdc").read_text()),
    )
    add_file(
        entries,
        cursor_stage,
        home / ".cursor" / "rules" / "major-global" / "RULE.mdc",
    )
    add_absent(entries, home / ".cursor" / "rules" / "major-global" / "RULE.md")

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

        # Only Claude has an automatic SessionStart hook out of the box.
        # Codex and Cursor both have real, documented, user-level (global)
        # hook mechanisms of their own -- close the gap the same way.
        codex_hooks_stage = write_stage_file(
            stage,
            "codex-hooks.json",
            codex_hooks(codex_home / "hooks.json", args.major_bin),
        )
        add_file(entries, codex_hooks_stage, codex_home / "hooks.json")

        cursor_hooks_stage = write_stage_file(
            stage,
            "cursor-hooks.json",
            cursor_hooks(home / ".cursor" / "hooks.json", args.major_bin),
        )
        add_file(entries, cursor_hooks_stage, home / ".cursor" / "hooks.json")

        # Antigravity has no global markdown-rule mechanism at all -- rules
        # are only discovered by walking from cwd up to a repo root, and its
        # documented global location (~/.gemini/config/) is for skills.json
        # /plugins.json, not GEMINI.md. A globally-registered plugin bundling
        # a rule and a PreInvocation hook is the real, documented mechanism
        # that reaches every project on this machine.
        plugin_root = home / ".major" / "gemini-plugin"
        add_file(
            entries,
            write_stage_file(stage, "gemini-plugin-manifest.json", json.dumps({"name": "major-global"}, indent=2) + "\n"),
            plugin_root / "plugin.json",
        )
        add_file(
            entries,
            write_stage_file(
                stage,
                "gemini-plugin-rule.md",
                rules + "\n" + (adapters_src / "GEMINI.md").read_text(),
            ),
            plugin_root / "rules" / "major-global.md",
        )
        add_file(
            entries,
            write_stage_file(stage, "gemini-plugin-hooks.json", antigravity_plugin_hooks(args.major_bin)),
            plugin_root / "hooks.json",
        )
        add_file(
            entries,
            write_stage_file(
                stage,
                "gemini-plugins-registry.json",
                gemini_plugins_json(
                    home / ".gemini" / "config" / "plugins.json", str(plugin_root)
                ),
            ),
            home / ".gemini" / "config" / "plugins.json",
        )

    if args.execution_path:
        execution_path_stage = write_stage_file(
            stage,
            "execution-path.json",
            json.dumps(
                {
                    "version": 1,
                    "path": args.execution_path,
                    "configuredAt": datetime.now(timezone.utc).isoformat(),
                },
                indent=2,
            )
            + "\n",
        )
        add_file(entries, execution_path_stage, home / ".major" / "execution-path.json")
        if args.execution_path == "host":
            # The host path does not consult Lima configuration. Remove a
            # stale config during the same atomic swap so diagnostics and
            # future rollback logic cannot mistake it for the active path.
            add_absent(entries, home / ".major" / "execution.json")

    for label, source_arg, target in (
        ("execution-config", args.execution_config, home / ".major" / "execution.json"),
        ("record", args.record, home / ".major" / "installed-release.json"),
        (
            "global-rules-record",
            args.global_rules_record,
            home / ".major" / "installed-global-rules.json",
        ),
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
