#!/usr/bin/env python3
"""Fail-closed *metadata* audit for a reference-engineering project.

This checks the consistency and completeness of the evidence ledger. It does
NOT independently verify screenshots, app behaviour, tests, or source claims.
Uses only Python's standard library and makes no network requests.
"""

from __future__ import annotations

import argparse
import csv
import json
import ipaddress
import posixpath
import re
import socket
import subprocess
import unicodedata
from urllib.parse import unquote, urlsplit
import sys
from datetime import datetime, timezone
from pathlib import Path

COLUMNS = {
    "evidence": ("evidence_id", "status", "source_uri", "captured_at", "screen_or_state", "confidentiality", "revision", "notes"),
    "screens": ("screen_id", "route", "role", "auth_tier", "state", "viewport", "source_status", "source_evidence_id", "target_status", "target_evidence_id", "notes"),
    "flows": ("flow_id", "description", "screen_ids", "priority", "source_status", "source_evidence_id", "target_status", "target_evidence_id", "test_id", "notes"),
    "features": ("feature_id", "description", "priority", "source_status", "source_evidence_id", "target_status", "target_evidence_id", "test_id", "notes"),
    "controls": ("control_id", "screen_id", "role", "auth_tier", "interaction_state", "label", "source_status", "source_evidence_id", "target_status", "target_evidence_id", "backend_dependency", "data_dependency", "test_id", "notes"),
    "data": ("dataset_id", "description", "required", "rights", "rights_evidence_id", "expected_count", "actual_count", "status", "source_evidence_id", "target_evidence_id", "refresh_strategy", "notes"),
    "findings": ("finding_id", "severity", "status", "description", "evidence_id", "notes"),
    "tests": ("test_id", "requirement_id", "result", "command", "ran_at", "revision", "evidence_id", "notes"),
    "visual_checks": ("check_id", "screen_id", "viewport", "state", "source_evidence_id", "target_evidence_id", "metric", "score", "result", "notes"),
}
ID = {"screens": "screen_id", "flows": "flow_id", "evidence": "evidence_id", "features": "feature_id", "controls": "control_id", "data": "dataset_id", "findings": "finding_id", "tests": "test_id", "visual_checks": "check_id"}
SOURCE = {"observed", "documented", "inferred", "blocked"}
TARGET = {"pass", "partial", "missing", "blocked", "not_started", "out_of_scope"}
PRIORITY = {"must", "should", "could"}
RIGHTS = {"owned", "licensed", "public-permitted", "synthetic", "unknown", "restricted"}
SEVERITY = {"critical", "high", "medium", "low", "p0", "p1", "p2", "p3"}
FINDING_STATUS = {"open", "closed", "accepted"}
BLOCKING = {"critical", "high", "medium", "p0", "p1", "p2"}


def read_csv(root: Path, name: str, errors: list[str]) -> list[dict]:
    path = root / (name + ".csv")
    if not path.is_file():
        errors.append(f"Missing {name}.csv")
        return []
    try:
        with path.open("r", newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            missing = set(COLUMNS[name]) - set(reader.fieldnames or ())
            if missing:
                errors.append(f"{name}.csv missing columns: {', '.join(sorted(missing))}")
                return []
            raw_rows = list(reader)
            rows = [{k: (v or "").strip() for k, v in row.items() if k is not None} for row in raw_rows]
            for lineno, raw in enumerate(raw_rows, 2):
                if None in raw or any(value is None for value in raw.values()):
                    errors.append(f"{name}.csv row {lineno} has too many or too few fields")
    except (OSError, UnicodeError, csv.Error) as exc:
        errors.append(f"Unable to read {name}.csv: {type(exc).__name__}")
        return []
    seen = set()
    for line, row in enumerate(rows, 2):
        key = row[ID[name]]
        if not key:
            errors.append(f"{name}.csv row {line} has no {ID[name]}")
        elif key in seen:
            errors.append(f"{name}.csv duplicate {ID[name]}: {key}")
        seen.add(key)
        if any(col not in row for col in COLUMNS[name]):
            errors.append(f"{name}.csv row {line} is malformed")
    return rows


def normalized_date(s: str):
    if not s:
        return None
    try:
        v = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc)
    except ValueError:
        return None


def _canonical_hostname(raw: str) -> str:
    """Normalize Unicode dot variants and IDN hostnames without doing DNS."""
    host = unicodedata.normalize("NFKC", unquote(raw)).translate(
        str.maketrans({"。": ".", "．": ".", "｡": "."})
    ).lower().rstrip(".")
    try:
        return host.encode("idna").decode("ascii")
    except UnicodeError:
        return host


def normalized_artifact_uri(raw: str) -> str:
    """Conservatively collapse equivalent artifact locators and URI fragments."""
    raw = (raw or "").strip().replace("\\", "/")
    try:
        parsed = urlsplit(raw)
        path = posixpath.normpath(unquote(parsed.path or "/").replace("\\", "/")).casefold()
        if not parsed.scheme:
            return posixpath.normpath(unquote(raw.split("#", 1)[0].split("?", 1)[0])).casefold()
        scheme = parsed.scheme.lower()
        if not parsed.netloc:
            return scheme + ":" + path
        host = _canonical_hostname(parsed.hostname or "")
        port = parsed.port
        if (scheme, port) in {("https", 443), ("http", 80)}:
            port = None
        authority = host + (":" + str(port) if port else "")
        return scheme + "://" + authority + path
    except ValueError:
        return raw.casefold()


def source_matches_origin(source_uri: str, origin: str) -> bool:
    candidate, expected = normalized_artifact_uri(source_uri), normalized_artifact_uri(origin)
    if not expected:
        return False
    return candidate == expected or candidate.startswith(expected.rstrip("/") + "/")


_NUMERIC_HOST = re.compile(r"(?:0x[0-9a-f]+|[0-9]+)(?:\.(?:0x[0-9a-f]+|[0-9]+)){0,3}", re.I)
_INTERNAL_SUFFIXES = (".local", ".localhost", ".internal", ".corp", ".lan", ".home")
_URL_PATTERN = re.compile(r"[a-z][a-z0-9+.-]*://[^\s\"'<>()]+", re.I)


def _is_public_hostname(hostname: str) -> bool:
    host = _canonical_hostname(hostname)
    if not host or host in {"localhost", "host.docker.internal"} or host.endswith(_INTERNAL_SUFFIXES):
        return False
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        if _NUMERIC_HOST.fullmatch(host):
            try:
                address = ipaddress.IPv4Address(socket.inet_aton(host))
            except (OSError, ValueError):
                return False
        else:
            # A public hostname must be qualified. DNS itself is not queried here.
            return "." in host and not host.startswith(".") and ".." not in host
    return address.is_global


def is_private_or_insecure_url(raw: str, require_https: bool = False) -> bool:
    """Screen for unsafe network endpoints without performing DNS or network I/O."""
    if not isinstance(raw, str):
        return True
    urls = _URL_PATTERN.findall(raw)
    if require_https and (not raw.strip().lower().startswith("https://") or len(urls) != 1):
        return True
    for candidate in urls:
        try:
            url = urlsplit(candidate)
            if url.scheme.lower() != "https" or not _is_public_hostname(url.hostname or ""):
                return True
            _ = url.port  # invalid ports must fail closed
        except (ValueError, OverflowError):
            return True
    # Catch scheme-less endpoints in source_uri and shell commands such as
    # BASE_URL=localhost:3000, --base-url=127.1 and 127.0.0.1/snapshot.png.
    normalized = unicodedata.normalize("NFKC", unquote(raw)).translate(
        str.maketrans({"。": ".", "．": ".", "｡": "."})
    )
    for match in re.finditer(r"(?:^|[\s=])([^\s\"'<>;]+)", normalized):
        token = match.group(1).strip("()[];,").rsplit("=", 1)[-1]
        if "://" in token:
            continue
        host = token.split("/", 1)[0].split(":", 1)[0].lower()
        host_like = (
            host in {"localhost", "host.docker.internal"}
            or host.endswith(_INTERNAL_SUFFIXES)
            or bool(_NUMERIC_HOST.fullmatch(host))
        )
        if host_like and not _is_public_hostname(host):
            return True
    return False


def audit(root: Path, stage: str) -> dict:
    errors, warnings = [], []
    root = root.resolve()
    project_file = root / "project.json"
    try:
        project = json.loads(project_file.read_text(encoding="utf-8"))
        if not isinstance(project, dict):
            raise ValueError("expected object")
    except (OSError, ValueError, json.JSONDecodeError):
        errors.append("Missing or invalid project.json")
        project = {}
    if not isinstance(project.get("mode"), str) or project.get("mode") not in {"owned", "authorized", "public-competitor", "research-only"}:
        errors.append("project.json mode must be owned, authorized, public-competitor, or research-only")
    goal = project.get("parity_goal")
    if not isinstance(goal, str) or goal not in {"full", "mvp"}:
        errors.append("project.json parity_goal must be full or mvp")
    if not str(project.get("scope", "")).strip():
        errors.append("project.json must have a non-empty scope")
    if not isinstance(project.get("interactive"), bool):
        errors.append("project.json interactive must be boolean")
    if not isinstance(project.get("data_in_scope"), bool):
        errors.append("project.json data_in_scope must be boolean")
    if not isinstance(project.get("visual_in_scope"), bool):
        errors.append("project.json visual_in_scope must be boolean")
    if not isinstance(project.get("source_types"), list):
        errors.append("project.json source_types must be a list")
    elif project.get("interactive") is False and any(v in {"website", "app"} for v in project["source_types"]):
        if not str(project.get("noninteractive_rationale", "")).strip():
            errors.append("Website/app declared noninteractive requires noninteractive_rationale")
    web_types = {"website", "web", "web-app", "app"}
    if stage == "release" and any(x in web_types for x in (project.get("source_types") if isinstance(project.get("source_types"), list) else [])):
        preview = str(project.get("remote_preview_url") or "")
        if (not preview.startswith("https://") or is_private_or_insecure_url(preview, require_https=True)) and not str(project.get("local_testing_exception", "")).strip():
            errors.append("Web reconstruction release needs a public HTTPS remote_preview_url or owner-approved isolated local_testing_exception")
    if stage == "release" and project.get("interactive") is False and not project.get("scope_approval_evidence_id"):
        errors.append("Disabling interactive scope requires SCOPE approval")
    if stage == "release" and project.get("data_in_scope") is False and not project.get("scope_approval_evidence_id"):
        errors.append("Excluding datasets requires SCOPE approval")
    if stage == "release" and project.get("visual_in_scope") is False and not project.get("scope_approval_evidence_id"):
        errors.append("Excluding visual QA requires SCOPE approval")
    if stage == "release" and project.get("mode") == "research-only":
        errors.append("research-only is read-only: release of an implementation is prohibited")
    if stage == "release" and project.get("mode") == "public-competitor" and goal == "full" and not str(project.get("differentiation_scope", "")).strip():
        errors.append("Public-competitor full parity requires differentiation_scope and clean-room permissions")
    if project.get("mode") == "authorized" and not str(project.get("authorization_evidence_id", "")).strip():
        errors.append("Authorized project requires authorization_evidence_id at recon and release")
    if project.get("mode") == "owned" and not str(project.get("ownership_evidence_id", "")).strip():
        errors.append("Owned project requires ownership_evidence_id at recon and release")
    revision = project.get("target_revision")
    if stage == "release" and (not isinstance(revision, str) or not revision.strip()):
        errors.append("Release requires a non-empty target_revision")
    origin = project.get("source_origin")
    if stage == "release" and (not isinstance(origin, str) or not origin.strip()):
        errors.append("Release requires source_origin to bind source evidence to a reference")
    min_visual_score = project.get("min_visual_score", 85)
    if not isinstance(min_visual_score, (int, float)) or isinstance(min_visual_score, bool) or not 0 <= min_visual_score <= 100:
        errors.append("min_visual_score must be within 0..100")
        min_visual_score = 0
    if stage == "release" and project.get("visual_in_scope") and min_visual_score < 75 and not project.get("scope_approval_evidence_id"):
        errors.append("Visual threshold below 75 requires documented SCOPE approval")
    freshness_days = project.get("freshness_policy_days")
    if not isinstance(freshness_days, int) or isinstance(freshness_days, bool) or freshness_days < 0:
        errors.append("project.json freshness_policy_days must be a nonnegative integer")
        freshness_days = None

    if stage == "release" and freshness_days is not None and freshness_days > 30 and not project.get("scope_approval_evidence_id"):
        errors.append("Freshness policy longer than 30 days requires SCOPE approval")
    for key in ("approved_source_origins", "approved_artifact_origins"):
        if not isinstance(project.get(key, []), list) or any(not isinstance(x, str) or not x.strip() for x in project.get(key, [])):
            errors.append(f"project.json {key} must be a list of nonempty origins")
    tables = {name: read_csv(root, name, errors) for name in COLUMNS}
    all_ids = {}
    reserved = {"OWN", "AUTH", "SCOPE", "RIGHTS", "MVP", "DATA", "LOCAL", "LONG_FRESHNESS", "LOW_VISUAL", "NO_INTERACTIONS", "NO_VISUAL", "NO_DATA"}
    for name in COLUMNS:
        for row in tables[name]:
            key = row.get(ID[name], "")
            if key in reserved:
                errors.append(f"Reserved scope tag cannot be used as record ID: {key}")
            if key in all_ids and key:
                errors.append(f"Globally ambiguous ID {key}: {name} conflicts with {all_ids[key]}")
            elif key:
                all_ids[key] = name
    evidence = {r["evidence_id"]: r for r in tables["evidence"] if r.get("evidence_id")}
    tests = {r["test_id"]: r for r in tables["tests"] if r.get("test_id")}
    now = datetime.now(timezone.utc)
    for mode, field, tag in (
        ("owned", "ownership_evidence_id", "OWN"),
        ("authorized", "authorization_evidence_id", "AUTH"),
    ):
        if project.get("mode") != mode:
            continue
        ref = str(project.get(field) or "")
        proof = evidence.get(ref)
        if (
            not proof or proof["status"] not in {"observed", "documented"}
            or set(proof["screen_or_state"].split(";")) != {tag}
            or proof["confidentiality"] == "public"
            or not proof["source_uri"]
        ):
            errors.append(f"{mode}: {field} must reference internal or private {tag}-tagged provenance")
        elif freshness_days is not None:
            date = normalized_date(proof["captured_at"])
            if date is None or (now - date).total_seconds() > freshness_days * 86400:
                errors.append(f"{mode}: {field} evidence stale or invalid")
    scope_waived = (project.get("interactive") is False or project.get("visual_in_scope") is False
        or project.get("data_in_scope") is False or goal == "mvp"
        or (freshness_days is not None and freshness_days > 30)
        or (project.get("visual_in_scope") and min_visual_score < 75)) or bool(str(project.get("data_waiver") or "").strip()) or bool(str(project.get("local_testing_exception") or "").strip()) or any(
        row.get("target_status") == "out_of_scope"
        for name in ("screens", "flows", "features", "controls")
        for row in tables[name]
    ) or any(d["required"] == "no" for d in tables["data"])
    if stage == "release" and scope_waived:
        ref = str(project.get("scope_approval_evidence_id") or "")
        approval = evidence.get(ref)
        if (not approval or approval["status"] not in {"observed", "documented"}
            or "SCOPE" not in approval["screen_or_state"].split(";")
            or approval["confidentiality"] == "public"
            or ref in {str(project.get("ownership_evidence_id") or ""), str(project.get("authorization_evidence_id") or "")}):
            errors.append("Scope waiver/exclusion requires separate internal owner-approved SCOPE evidence")
        else:
            approved = set(approval["screen_or_state"].split(";"))
            excluded_ids = {
                row[ID[name]]
                for name in ("screens", "flows", "features", "controls")
                for row in tables[name]
                if row.get("target_status") == "out_of_scope"
            }
            excluded_ids.update(d["dataset_id"] for d in tables["data"] if d["required"] == "no")
            for field, tag in (
                ("data_waiver", "DATA"), ("local_testing_exception", "LOCAL"),
            ):
                if project.get(field):
                    excluded_ids.add(tag)
            for flag, tag in (
                ("interactive", "NO_INTERACTIONS"), ("visual_in_scope", "NO_VISUAL"),
                ("data_in_scope", "NO_DATA"),
            ):
                if project.get(flag) is False:
                    excluded_ids.add(tag)
            if goal == "mvp":
                excluded_ids.add("MVP")
            if freshness_days is not None and freshness_days > 30:
                excluded_ids.add("LONG_FRESHNESS")
            if project.get("visual_in_scope") and min_visual_score < 75:
                excluded_ids.add("LOW_VISUAL")
            for key in sorted(excluded_ids - approved):
                errors.append(f"Scope approval evidence missing explicit exception tag {key}")
            if freshness_days is not None:
                date = normalized_date(approval["captured_at"])
                if date is None or (now - date).total_seconds() > freshness_days * 86400:
                    errors.append("Scope waiver/exclusion SCOPE approval is stale or invalid")
    for e in tables["evidence"]:
        key = e.get("evidence_id", "unknown")
        if e["status"] not in SOURCE:
            errors.append(f"Evidence {key}: invalid status '{e['status']}'")
        if not e["source_uri"]:
            errors.append(f"Evidence {key}: source_uri is required")
        date = normalized_date(e["captured_at"])
        if not date:
            errors.append(f"Evidence {key}: captured_at must be ISO 8601")
        elif date > now:
            errors.append(f"Evidence {key}: captured_at is in the future")
        if e["confidentiality"] not in {"public", "internal", "private", "restricted"}:
            errors.append(f"Evidence {key}: invalid confidentiality")
        if stage == "release" and e["status"] in {"inferred", "blocked"}:
            warnings.append(f"Evidence {key} remains {e['status']}; verify that no in-scope item depends on it")

    target_claim_refs = {}
    target_claim_uris = {}
    referenced_target_evidence = set()
    def check_claim_proof(kind: str, key: str, source_ref: str, target_ref: str, tag: str = ""):
        """Structural audit only: prevents one generic artifact attesting every claim."""
        if not target_ref:
            return
        referenced_target_evidence.add(target_ref)
        used = target_claim_refs.get(target_ref)
        if used is not None and used != (kind, key):
            errors.append(f"{kind} {key}: target evidence {target_ref} reused for independent claim {used[0]} {used[1]}")
        target_claim_refs[target_ref] = (kind, key)
        a, b = evidence.get(source_ref), evidence.get(target_ref)
        if b:
            uri = normalized_artifact_uri(b["source_uri"])
            if uri in target_claim_uris and target_claim_uris[uri] != (kind, key):
                errors.append(f"{kind} {key}: target artifact URI reused by {target_claim_uris[uri][0]} {target_claim_uris[uri][1]}")
            target_claim_uris[uri] = (kind, key)
        if a and key not in a["screen_or_state"].split(";") and tag not in a["screen_or_state"].split(";"):
            errors.append(f"{kind} {key}: source evidence {source_ref} lacks scope tag")
        if a and b and normalized_artifact_uri(a["source_uri"]) == normalized_artifact_uri(b["source_uri"]):
            errors.append(f"{kind} {key}: source and target evidence point to identical URI")
        if b and key not in b["screen_or_state"].split(";") and tag not in b["screen_or_state"].split(";"):
            errors.append(f"{kind} {key}: target evidence {target_ref} lacks scope tag")

    def check_ref(row_type: str, key: str, ref: str, expected: str | None = None):
        if not ref:
            errors.append(f"{row_type} {key}: evidence ID is missing")
            return
        item = evidence.get(ref)
        if item is None:
            errors.append(f"{row_type} {key}: evidence ID {ref} not found")
        elif expected is not None and item["status"] != expected:
            errors.append(f"{row_type} {key}: evidence {ref} is '{item['status']}', expected '{expected}'")

    screen_ids = {row["screen_id"] for row in tables["screens"] if row.get("screen_id")}
    for s in tables["screens"]:
        key = s["screen_id"]
        for field in ("route", "role", "auth_tier", "state", "viewport"):
            if not s[field]:
                errors.append(f"Screen {key}: missing {field}; use 'none' where inapplicable")
        if s["source_status"] not in SOURCE or s["target_status"] not in TARGET:
            errors.append(f"Screen {key}: invalid source or target status")
        check_ref("Screen source", key, s["source_evidence_id"], s["source_status"] if s["source_status"] in SOURCE else None)
        if s["target_status"] == "pass":
            check_ref("Screen target", key, s["target_evidence_id"], "observed")
            if s["source_evidence_id"] == s["target_evidence_id"]:
                errors.append(f"Screen {key}: source and target require distinct evidence")
            if stage == "release":
                check_claim_proof("Screen", key, s["source_evidence_id"], s["target_evidence_id"], key)
        if stage == "release":
            if s["target_status"] != "pass" and not s["notes"]:
                errors.append(f"Screen {key}: incomplete/omitted status requires a rationale")
            if project.get("interactive") and s["source_status"] != "observed":
                errors.append(f"Screen {key}: interactive source state not directly observed")
            if goal == "full" and s["target_status"] != "pass":
                errors.append(f"Screen {key}: target is {s['target_status']} in full parity")
            elif s["target_status"] != "pass":
                warnings.append(f"Screen {key}: {s['target_status']} in MVP")

    for fl in tables["flows"]:
        key = fl["flow_id"]
        if fl["priority"] not in PRIORITY:
            errors.append(f"Flow {key}: invalid priority")
        if fl["source_status"] not in SOURCE or fl["target_status"] not in TARGET:
            errors.append(f"Flow {key}: invalid source or target status")
        check_ref("Flow source", key, fl["source_evidence_id"], fl["source_status"] if fl["source_status"] in SOURCE else None)
        linked = [v.strip() for v in fl["screen_ids"].split(";") if v.strip()]
        if not linked:
            errors.append(f"Flow {key}: requires at least one screen ID")
        for sid in linked:
            if sid not in screen_ids:
                errors.append(f"Flow {key}: references unknown screen {sid}")
        if fl["target_status"] == "pass":
            check_ref("Flow target", key, fl["target_evidence_id"], "observed")
            if fl["source_evidence_id"] == fl["target_evidence_id"]:
                errors.append(f"Flow {key}: source and target require distinct evidence")
            if stage == "release":
                check_claim_proof("Flow", key, fl["source_evidence_id"], fl["target_evidence_id"], key)
            t = tests.get(fl["test_id"])
            if not t or t["requirement_id"] != key or t["result"] != "pass":
                errors.append(f"Flow {key}: pass requires a passing flow-specific test")
        if stage == "release":
            if fl["target_status"] != "pass" and not fl["notes"]:
                errors.append(f"Flow {key}: incomplete/omitted status requires a rationale")
            if project.get("interactive") and fl["source_status"] != "observed":
                errors.append(f"Flow {key}: interactive behaviour not directly observed")
            if fl["source_status"] in {"blocked", "inferred"}:
                errors.append(f"Flow {key}: source unverified or blocked")
            if fl["priority"] == "must" and fl["target_status"] != "pass":
                errors.append(f"Must-have flow {key} is {fl['target_status']}")
            elif goal == "full" and fl["target_status"] != "pass" and fl["target_status"] != "out_of_scope":
                errors.append(f"Full-scope flow {key} is {fl['target_status']}")
            elif fl["target_status"] != "pass":
                warnings.append(f"Flow {key}: explicitly excluded or deferred as {fl['target_status']}")

    for f in tables["features"]:
        key = f["feature_id"]
        if f["priority"] not in PRIORITY:
            errors.append(f"Feature {key}: invalid priority")
        if f["source_status"] not in SOURCE:
            errors.append(f"Feature {key}: invalid source_status")
        if f["target_status"] not in TARGET:
            errors.append(f"Feature {key}: invalid target_status")
        check_ref("Feature source", key, f["source_evidence_id"], f["source_status"] if f["source_status"] in SOURCE else None)
        if f["target_status"] == "pass":
            if not f["test_id"]:
                errors.append(f"Feature {key}: pass requires a test_id")
            else:
                t = tests.get(f["test_id"])
                if t is None:
                    errors.append(f"Feature {key}: test_id {f['test_id']} absent from tests.csv")
                elif t["result"] != "pass" or t["requirement_id"] != key:
                    errors.append(f"Feature {key}: referenced test is not a passing test for this requirement")
            check_ref("Feature target", key, f["target_evidence_id"], "observed")
            if f["source_evidence_id"] == f["target_evidence_id"]:
                errors.append(f"Feature {key}: source and target require distinct evidence")
            if stage == "release":
                check_claim_proof("Feature", key, f["source_evidence_id"], f["target_evidence_id"], key)
        elif f["target_evidence_id"] and f["target_evidence_id"] not in evidence:
            errors.append(f"Feature {key}: target evidence ID not found")
        if f["target_status"] == "out_of_scope" and not f["notes"]:
            errors.append(f"Feature {key}: out_of_scope requires rationale in notes")
        if stage == "release":
            if f["target_status"] != "pass" and not f["notes"]:
                errors.append(f"Feature {key}: incomplete/omitted status requires a rationale")
            if f["priority"] == "must" and f["target_status"] != "pass":
                errors.append(f"MUST feature {key} is {f['target_status']}")
            elif goal == "full" and f["target_status"] not in {"pass", "out_of_scope"}:
                errors.append(f"FULL scope feature {key} is {f['target_status']}")
            elif f["target_status"] != "pass":
                warnings.append(f"Feature {key} ({f['priority']}) is {f['target_status']} in MVP or explicit full-scope exclusion")
            if f["source_status"] in {"inferred", "blocked"}:
                errors.append(f"Feature {key} has unverified/blocked source evidence")

    for c in tables["controls"]:
        key = c["control_id"]
        if c["screen_id"] and c["screen_id"] not in screen_ids:
            errors.append(f"Control {key}: references unknown screen {c['screen_id']}")
        for field in ("screen_id", "role", "auth_tier", "interaction_state", "backend_dependency", "data_dependency"):
            if not c[field]:
                errors.append(f"Control {key}: missing {field}; use 'none' for intentionally absent dependencies")
        if c["source_status"] not in SOURCE:
            errors.append(f"Control {key}: invalid source_status")
        if c["target_status"] not in TARGET:
            errors.append(f"Control {key}: invalid target_status")
        check_ref("Control source", key, c["source_evidence_id"], c["source_status"] if c["source_status"] in SOURCE else None)
        if c["target_status"] == "pass":
            if not c["test_id"]:
                errors.append(f"Control {key}: pass requires test_id")
            else:
                t = tests.get(c["test_id"])
                if t is None or t["result"] != "pass" or t["requirement_id"] != key:
                    errors.append(f"Control {key}: requires a passing interaction test for this control")
            check_ref("Control target", key, c["target_evidence_id"], "observed")
            if c["source_evidence_id"] == c["target_evidence_id"]:
                errors.append(f"Control {key}: source and target require distinct evidence")
            if stage == "release":
                check_claim_proof("Control", key, c["source_evidence_id"], c["target_evidence_id"], key)
        elif c["target_evidence_id"] and c["target_evidence_id"] not in evidence:
            errors.append(f"Control {key}: target evidence ID not found")
        if c["target_status"] == "out_of_scope" and not c["notes"]:
            errors.append(f"Control {key}: out_of_scope requires rationale")
        if stage == "release":
            if c["target_status"] != "pass" and not c["notes"]:
                errors.append(f"Control {key}: incomplete/omitted status requires a rationale")
            if c["source_status"] != "observed":
                errors.append(f"Control {key}: source action never safely observed")
            if goal == "full" and c["target_status"] != "pass":
                errors.append(f"Control {key}: target is {c['target_status']} in full parity")
            elif goal == "mvp" and c["target_status"] != "pass":
                warnings.append(f"Control {key}: {c['target_status']} in MVP")

    for d in tables["data"]:
        key = d["dataset_id"]
        if d["required"] not in {"yes", "no"}:
            errors.append(f"Dataset {key}: required must be yes or no")
        if d["rights"] not in RIGHTS:
            errors.append(f"Dataset {key}: invalid rights")
        rights_ev = evidence.get(d["rights_evidence_id"])
        if d["required"] == "yes" and stage == "release":
            tags = set(rights_ev["screen_or_state"].split(";")) if rights_ev else set()
            if not rights_ev or rights_ev["status"] not in {"observed", "documented"} or not {"RIGHTS", key}.issubset(tags):
                errors.append(f"Dataset {key}: required data needs {key}-tagged RIGHTS evidence")
            if d["rights_evidence_id"] in {str(project.get("scope_approval_evidence_id") or ""), str(project.get("ownership_evidence_id") or ""), str(project.get("authorization_evidence_id") or "")}:
                errors.append(f"Dataset {key}: RIGHTS evidence must be distinct from owner/auth/scope approvals")
            if rights_ev and freshness_days is not None:
                when = normalized_date(rights_ev["captured_at"])
                if when is None or (now - when).total_seconds() > 86400 * freshness_days:
                    errors.append(f"Dataset {key}: RIGHTS evidence stale or invalid")
        if d["status"] not in {"verified", "partial", "missing", "blocked", "not_started", "not_applicable"}:
            errors.append(f"Dataset {key}: invalid status")
        check_ref("Dataset source", key, d["source_evidence_id"])
        if d["required"] == "yes" and evidence.get(d["source_evidence_id"], {}).get("status") in {"blocked", "inferred"} and stage == "release":
            errors.append(f"Dataset {key}: required data source unverified or blocked")
        if d["status"] == "verified":
            check_ref("Dataset target", key, d["target_evidence_id"], "observed")
            if d["source_evidence_id"] == d["target_evidence_id"]:
                errors.append(f"Dataset {key}: source and target require distinct evidence")
            if stage == "release":
                check_claim_proof("Dataset", key, d["source_evidence_id"], d["target_evidence_id"], key)
        elif d["target_evidence_id"] and d["target_evidence_id"] not in evidence:
            errors.append(f"Dataset {key}: target evidence ID not found")
        expected, actual = d["expected_count"], d["actual_count"]
        for val, title in ((expected, "expected_count"), (actual, "actual_count")):
            if val and (not val.isdecimal()):
                errors.append(f"Dataset {key}: {title} must be nonnegative integer or blank")
        if expected and actual and expected.isdecimal() and actual.isdecimal() and int(expected) != int(actual):
            errors.append(f"Dataset {key}: count mismatch (expected {expected}, actual {actual})")
        if d["status"] == "verified" and not expected:
            if not d["refresh_strategy"] or not any(x in d["notes"].lower() for x in ("dynamic", "unbounded")):
                errors.append(f"Dataset {key}: unknown full count needs a refresh_strategy and dynamic/unbounded justification")
        if stage == "release" and d["required"] == "no" and not d["notes"]:
            errors.append(f"Dataset {key}: excluded data requires rationale")
        if stage == "release" and d["required"] == "yes":
            if project.get("mode") == "public-competitor" and d["rights"] in {"owned", "licensed"}:
                errors.append(f"Public-competitor dataset {key}: ownership/license must be independently established")
            if d["status"] != "verified":
                errors.append(f"Required dataset {key} is {d['status']}")
            if d["rights"] not in {"owned", "licensed", "public-permitted"}:
                errors.append(f"Required dataset {key} has unverified or disallowed use rights: {d['rights']}")
            if expected and not actual:
                errors.append(f"Required dataset {key}: actual_count not recorded")

    for f in tables["findings"]:
        key = f["finding_id"]
        sev = f["severity"].lower()
        if sev not in SEVERITY:
            errors.append(f"Finding {key}: invalid severity")
        if f["status"] not in FINDING_STATUS:
            errors.append(f"Finding {key}: invalid status")
        if f["evidence_id"]:
            check_ref("Finding", key, f["evidence_id"])
        if stage == "release" and sev in BLOCKING and f["status"] != "closed":
            errors.append(f"Release-blocking finding {key} ({sev}) is {f['status']}")

    for t in tables["tests"]:
        key = t["test_id"]
        if t["result"] not in {"pass", "fail", "skip", "blocked"}:
            errors.append(f"Test {key}: invalid result")
        if not t["command"]:
            errors.append(f"Test {key}: missing command")
        when = normalized_date(t["ran_at"])
        if not when:
            errors.append(f"Test {key}: invalid or missing ran_at")
        elif when > now:
            errors.append(f"Test {key}: ran_at is in the future")
        elif stage == "release" and freshness_days is not None and (now - when).total_seconds() > 86400 * freshness_days:
            errors.append(f"Test {key}: stale pass / ran_at older than {freshness_days} days")
        if stage == "release" and t["result"] == "pass" and t["revision"] != revision:
            errors.append(f"Test {key}: test revision does not match target_revision")
        check_ref("Test", key, t["evidence_id"], "observed" if t["result"] == "pass" else None)
        if stage == "release" and t["result"] == "pass":
            requirements = {
                row[id_field]: row
                for name, id_field in (("features", "feature_id"), ("flows", "flow_id"), ("controls", "control_id"))
                for row in tables[name]
            }
            req = requirements.get(t["requirement_id"])
            if not req or req.get("target_evidence_id") != t["evidence_id"] or req.get("test_id") != key:
                errors.append(f"Test {key}: passing test evidence must match its requirement's target evidence and test_id")
        if stage == "release" and t["result"] in {"fail", "blocked"}:
            errors.append(f"In-scope test {key} is {t['result']}")
        elif stage == "release" and t["result"] == "skip":
            warnings.append(f"Test {key} was skipped; independent reviewer must validate scope")

    for v in tables["visual_checks"]:
        key = v["check_id"]
        if v["screen_id"] not in screen_ids:
            errors.append(f"Visual check {key}: references unknown screen {v['screen_id']}")
        if v["result"] not in {"pass", "fail", "blocked", "not_started", "not_applicable"}:
            errors.append(f"Visual check {key}: invalid result")
        if not v["viewport"] or not v["state"] or not v["metric"]:
            errors.append(f"Visual check {key}: requires viewport, state and metric")
        check_ref("Visual source", key, v["source_evidence_id"], "observed")
        if v["result"] == "pass":
            check_ref("Visual target", key, v["target_evidence_id"], "observed")
            if v["source_evidence_id"] == v["target_evidence_id"]:
                errors.append(f"Visual check {key}: source and target must be distinct")
            if stage == "release":
                check_claim_proof("Visual", key, v["source_evidence_id"], v["target_evidence_id"], v["screen_id"])
        if v["score"]:
            try:
                score = float(v["score"])
                if not 0 <= score <= 100:
                    raise ValueError("out of range")
            except ValueError:
                errors.append(f"Visual check {key}: score must be between 0 and 100")
        if stage == "release" and project.get("visual_in_scope") and v["result"] != "pass":
            errors.append(f"Visual check {key} is {v['result']}")
        if stage == "release" and v["result"] == "pass" and v["score"] and v["score"].replace(".", "", 1).isdigit():
            if float(v["score"]) < min_visual_score:
                errors.append(f"Visual check {key} below minimum visual score {min_visual_score}")
        elif stage == "release" and v["result"] == "pass" and project.get("visual_in_scope"):
            errors.append(f"Visual check {key}: passing visual check requires numeric score to enforce min_visual_score")

    if stage == "release" and project.get("visual_in_scope"):
        for row in tables["screens"]:
            if row["target_status"] == "pass" and not any(
                v["screen_id"] == row["screen_id"] and v["viewport"] == row["viewport"] and v["state"] == row["state"] and v["result"] == "pass"
                for v in tables["visual_checks"]
            ):
                errors.append(f"Screen {row['screen_id']}: missing matching passed viewport/state visual check")
        if not tables["visual_checks"]:
            errors.append("Visual scope declared but no visual_checks.csv rows")
    if stage == "release" and project.get("interactive"):
        for row in tables["screens"]:
            if row["target_status"] == "pass" and not any(c["screen_id"] == row["screen_id"] for c in tables["controls"]):
                if "no interactive controls" not in row["notes"].lower():
                    errors.append(f"Interactive screen {row['screen_id']} requires a control or documented 'no interactive controls' rationale")

    if not tables["features"]:
        errors.append("features.csv lists no features: empty scope cannot pass")
    if (project.get("interactive") or project.get("visual_in_scope")) and not tables["screens"]:
        errors.append("Project lacks screen/state inventory")
    if project.get("interactive") and not tables["flows"]:
        errors.append("Interactive project lacks a flow inventory")
    if project.get("interactive") and not tables["controls"]:
        errors.append("Interactive project lacks an enumerated control inventory")
    if project.get("data_in_scope") and not tables["data"]:
        errors.append("Project declares data in scope but data.csv is empty")
    if stage == "release" and project.get("data_in_scope") and not any(d["required"] == "yes" for d in tables["data"]):
        if not str(project.get("data_waiver", "")).strip():
            errors.append("Data declared in scope but no required dataset; explicit data_waiver required")
    if stage == "release" and freshness_days is not None:
        for ref in sorted(referenced_target_evidence):
            ev = evidence.get(ref)
            if ev is None:
                continue
            when = normalized_date(ev["captured_at"])
            if when is None or (now - when).total_seconds() > 86400 * freshness_days:
                errors.append(f"Referenced target evidence {ref} stale (> {freshness_days} days)")
            if ev["revision"] != revision:
                errors.append(f"Referenced target evidence {ref} revision does not match target_revision")
        for e in tables["evidence"]:
            if e["revision"] and e["revision"] != revision and e["evidence_id"] in referenced_target_evidence:
                errors.append(f"Target evidence {e['evidence_id']}: stale revision")
    if stage == "release" and freshness_days is not None:
        referenced = {row["source_evidence_id"] for name in ("screens", "flows", "controls", "features", "data", "visual_checks") for row in tables[name] if row["source_evidence_id"]}
        for ref in sorted(referenced):
            ev = evidence.get(ref)
            when = normalized_date(ev["captured_at"]) if ev else None
            if when is None or (now - when).total_seconds() > 86400 * freshness_days:
                errors.append(f"Referenced source evidence {ref} is stale or invalid (> {freshness_days} days)")
    if stage == "release" and (project.get("interactive") or project.get("visual_in_scope")):
        at = normalized_date(str(project.get("source_last_checked_at") or ""))
        if not at:
            errors.append("Visual or interactive release requires source_last_checked_at (ISO date)")
        elif at > now:
            errors.append("source_last_checked_at is in the future")
        elif freshness_days is not None and (now - at).total_seconds() > 86400 * freshness_days:
            errors.append(f"Source capture stale: older than {freshness_days} days")

    if stage == "release":
        local_exception = str(project.get("local_testing_exception") or "").strip()
        if local_exception and not str(project.get("scope_approval_evidence_id") or "").strip():
            errors.append("Local testing exception requires scope_approval_evidence_id")
        source_refs = {
            row["source_evidence_id"]
            for name in ("screens", "flows", "controls", "features", "data", "visual_checks")
            for row in tables[name] if row["source_evidence_id"]
        }
        source_uris = {evidence[ref]["source_uri"] for ref in source_refs if ref in evidence}
        normalized_source_uris = {normalized_artifact_uri(uri) for uri in source_uris}
        source_roots = [origin] + project.get("approved_source_origins", [])
        if isinstance(origin, str) and origin and not any(source_matches_origin(uri, origin) for uri in source_uris):
            errors.append("No in-scope source evidence binds to source_origin")
        for source_uri in source_uris:
            parsed = urlsplit(source_uri)
            if parsed.scheme and parsed.netloc and not any(
                source_matches_origin(source_uri, allowed)
                for allowed in source_roots if isinstance(allowed, str) and allowed
            ):
                errors.append(f"Source evidence outside declared source origins: {source_uri}")
        artifact_roots = [project.get("remote_preview_url")] + project.get("approved_artifact_origins", [])
        for ref in referenced_target_evidence:
            ev = evidence.get(ref)
            if not ev:
                continue
            uri = ev["source_uri"]
            if normalized_artifact_uri(uri) in normalized_source_uris:
                errors.append(f"Target evidence {ref}: artifact URI also used as source evidence")
            if is_private_or_insecure_url(uri) and not local_exception:
                errors.append(f"Target evidence {ref}: insecure/local URI needs approved local_testing_exception")
            parsed = urlsplit(uri)
            if parsed.scheme in {"http", "https"} and not any(
                source_matches_origin(uri, allowed)
                for allowed in artifact_roots if isinstance(allowed, str) and allowed
            ):
                errors.append(f"Target evidence {ref}: external artifact outside approved target/artifact origins")
        for test in tables["tests"]:
            if test["result"] == "pass" and is_private_or_insecure_url(test["command"]) and not local_exception:
                errors.append(f"Test {test['test_id']}: local/insecure browser address needs approved local_testing_exception")
    # When the target is a Git repository, a release manifest cannot claim a
    # revision other than the exact current Git HEAD. Temp/standalone fixtures
    # remain supported, with explicit metadata-only limitations.
    if stage == "release":
        try:
            git = ["git", "-c", "core.fsmonitor=", "-c", "core.hooksPath=/dev/null"]
            head = subprocess.run(git + ["rev-parse", "HEAD"], cwd=root, capture_output=True, text=True, timeout=3)
            if head.returncode == 0 and head.stdout.strip() and isinstance(revision, str) and revision != head.stdout.strip():
                errors.append("target_revision does not match actual Git HEAD")
            elif head.returncode != 0:
                warnings.append("No Git HEAD available to independently bind target_revision; verify build identity manually")
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            warnings.append("Unable to resolve target Git HEAD; verify build identity manually")

    private_dir = root / "evidence-private"
    if private_dir.exists():
        # check raw evidence is in Git ignore rules if the project is a worktree
        try:
            cwd = root.parent
            git = ["git", "-c", "core.fsmonitor=", "-c", "core.hooksPath=/dev/null"]
            inside = subprocess.run(git + ["rev-parse", "--is-inside-work-tree"], cwd=cwd, capture_output=True, text=True, timeout=3)
            if inside.returncode == 0 and inside.stdout.strip() == "true":
                tracked = subprocess.run(git + ["ls-files", "--", str(private_dir)], cwd=cwd, capture_output=True, text=True, timeout=3)
                if tracked.returncode == 0 and tracked.stdout.strip():
                    errors.append("Raw evidence-private directory contains Git-tracked files")
                check = subprocess.run(git + ["check-ignore", "-q", str(private_dir / "dummy-proof.txt")], cwd=cwd, capture_output=True, timeout=3)
                if check.returncode != 0:
                    errors.append("Raw evidence-private directory exists but is not Git-ignored")
            else:
                (errors if stage == "release" else warnings).append("Git repository not detected: raw evidence Git-ignore status unverified")
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            (errors if stage == "release" else warnings).append("Could not verify Git exclusion of raw evidence")

    exclusions = {name: sum(row.get("target_status") == "out_of_scope" for row in tables[name]) for name in ("screens", "flows", "features", "controls")}
    exclusions["data"] = sum(d["required"] == "no" for d in tables["data"])
    fpass = sum(f["target_status"] == "pass" for f in tables["features"])
    must = [f for f in tables["features"] if f["priority"] == "must"]
    cpass = sum(c["target_status"] == "pass" and c["source_status"] == "observed" for c in tables["controls"])
    spass = sum(s["target_status"] == "pass" for s in tables["screens"])
    flow_pass = sum(f["target_status"] == "pass" for f in tables["flows"])
    required_data = [d for d in tables["data"] if d["required"] == "yes"]
    vpass = sum(v["result"] == "pass" for v in tables["visual_checks"])
    dpass = sum(d["status"] == "verified" and d["rights"] in {"owned", "licensed", "public-permitted"} for d in required_data)
    return {
        "stage": stage,
        "passed": not errors,
        "scope": project.get("scope", ""),
        "parity_goal": goal,
        "excluded": exclusions,
        "features": {"verified": fpass, "total": len(tables["features"]), "must_verified": sum(f["target_status"] == "pass" for f in must), "must_total": len(must)},
        "controls": {"verified": cpass, "total": len(tables["controls"])},
        "screens": {"verified": spass, "total": len(tables["screens"])},
        "flows": {"verified": flow_pass, "total": len(tables["flows"])},
        "required_data": {"verified": dpass, "total": len(required_data)},
        "visual_checks": {"verified": vpass, "total": len(tables["visual_checks"])},
        "tests": {"passed": sum(t["result"] == "pass" for t in tables["tests"]), "total": len(tables["tests"])},
        "errors": errors,
        "warnings": warnings,
        "notice": "Metadata gate only: real tests, browser evidence, rights and provenance must be verified independently. Recon-stage passing does not mean release-ready."
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dir", default="./reference", type=Path, help="Path containing project.json and inventory CSVs")
    ap.add_argument("--stage", choices=["recon", "release"], default="release")
    ap.add_argument("--format", choices=["text", "json"], default="text")
    args = ap.parse_args()
    result = audit(args.dir, args.stage)
    if args.format == "json":
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"{'PASS' if result['passed'] else 'FAIL'} [{args.stage.upper()} METADATA] | parity goal={result['parity_goal']}")
        for key in ("features", "screens", "flows", "controls", "required_data", "visual_checks"):
            x = result[key]
            print(f"  {key}: {x['verified']}/{x['total']} verified" + (f" (must {x['must_verified']}/{x['must_total']})" if key == "features" else ""))
        for e in result["errors"]:
            print(f"  ERROR: {e}")
        for w in result["warnings"]:
            print(f"  WARNING: {w}")
        print(result["notice"])
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
