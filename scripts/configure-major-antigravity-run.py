#!/usr/bin/env python3
import json
import pathlib
import re
import sys


workspace = sys.argv[1] if len(sys.argv) == 2 else ""
if not re.fullmatch(
    r"/var/lib/major/runs/antigravity/[a-f0-9-]{36}/workspace", workspace
):
    raise SystemExit("invalid Major Antigravity workspace")

settings_path = pathlib.Path.home() / ".gemini" / "antigravity-cli" / "settings.json"
settings_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
settings = json.loads(settings_path.read_text()) if settings_path.exists() else {}
settings.pop("permissions", None)
settings["enableTelemetry"] = False
settings["toolPermission"] = "proceed-in-sandbox"
settings["trustedWorkspaces"] = [workspace]
settings_path.write_text(json.dumps(settings, indent=2, sort_keys=True) + "\n")
settings_path.chmod(0o600)
