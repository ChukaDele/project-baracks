#!/usr/bin/env python3
"""Fail when a skill has more than one canonical source across host skill directories.

Canonical homes:
  - Major-owned skills: this repository's skills/internal/<name>.
  - Shared/personal skills: ~/.agents/skills/<name>.
Every other host entry (~/.claude/skills, ~/.codex/skills) must be a symlink that
resolves to the same directory. A copy can drift; a symlink cannot.

Exception: a vendor bundle that installs and manages its own per-host copies
(gstack: ~/.claude/skills/gstack-*, ~/.codex/skills/gstack-* -> .../gstack/.agents/skills/*)
counts as one source, as long as every copy stays inside a host skill directory.

Usage: check-skill-drift.py [--repo PATH] [--home PATH] | --self-test
Skips (exit 0) when no host skill directory exists, such as in CI.
"""
import argparse
import os
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

HOST_DIRS = ('.agents/skills', '.claude/skills', '.codex/skills')
# Vendor bundle name -> skill-name prefixes that the bundle owns.
VENDOR_BUNDLES = {'gstack': ('gstack-', '_gstack-')}


def host_entries(home: Path):
    for rel in HOST_DIRS:
        root = home / rel
        if not root.is_dir():
            continue
        for entry in sorted(root.iterdir()):
            if entry.name.startswith('.') or not (entry / 'SKILL.md').is_file():
                continue
            yield rel, entry


def major_roots(repo: Path, home: Path) -> set:
    main = Path(os.environ.get('MAJOR_REPO', home / 'Projects' / 'project-baracks'))
    return {(r / 'skills' / 'internal').resolve() for r in (repo, main)} | {(home / '.major' / 'skills' / 'internal').resolve()}


def vendor_managed(name: str, reals: set, home: Path) -> bool:
    """True when every copy of a vendor-bundle skill lives in a host dir or its bundle root."""
    for bundle, prefixes in VENDOR_BUNDLES.items():
        if name != bundle and not name.startswith(prefixes):
            continue
        allowed = [(home / rel).resolve() for rel in HOST_DIRS]
        bundle_roots = [root / bundle for root in allowed]
        return all(real.parent in allowed or any(root in real.parents for root in bundle_roots) for real in reals)
    return False


def check(home: Path, repo: Path) -> list[str]:
    major_owned = {p.name for p in (repo / 'skills' / 'internal').iterdir() if (p / 'SKILL.md').is_file()}
    by_name = defaultdict(list)
    for rel, entry in host_entries(home):
        by_name[entry.name].append((rel, entry, entry.resolve()))
    roots = major_roots(repo, home)
    errors = []
    for name, rows in sorted(by_name.items()):
        reals = {real for _, _, real in rows}
        if len(reals) > 1 and not (name not in major_owned and vendor_managed(name, reals, home)):
            where = ', '.join(f"{rel}{' (symlink)' if e.is_symlink() else ' (copy)'} -> {real}" for rel, e, real in rows)
            errors.append(f'{name}: {len(reals)} different sources: {where}')
            continue
        real = next(iter(reals))
        if len(reals) > 1:
            continue
        if name in major_owned and real.parent not in roots:
            errors.append(f'{name}: Major-owned skill must symlink to skills/internal/{name}, found {real}')
    return errors


def self_test() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home, repo = Path(tmp) / 'home', Path(tmp) / 'repo'

        def skill(path: Path, body: str = 'x') -> Path:
            path.mkdir(parents=True)
            (path / 'SKILL.md').write_text(body)
            return path

        skill(repo / 'skills/internal/owned')
        for rel in HOST_DIRS:
            (home / rel).mkdir(parents=True)
        shared = skill(home / '.agents/skills/shared')
        os.symlink(shared, home / '.claude/skills/shared')
        os.symlink(repo / 'skills/internal/owned', home / '.agents/skills/owned')
        os.symlink(home / '.agents/skills/owned', home / '.claude/skills/owned')
        assert check(home, repo) == [], check(home, repo)
        skill(home / '.codex/skills/shared', 'drifted')
        skill(home / '.claude/skills/solo')  # a single-host skill is allowed
        skill(home / '.agents/skills/owned2')
        os.rename(repo / 'skills/internal/owned', repo / 'skills/internal/owned-moved')
        skill(repo / 'skills/internal/owned2')
        # gstack layout: per-host copies plus Codex links into the bundle's .agents/skills.
        bundle = home / '.claude/skills/gstack'
        skill(bundle)
        skill(home / '.codex/skills/gstack', 'codex copy')
        skill(home / '.claude/skills/gstack-review')
        os.symlink(skill(bundle / '.agents/skills/gstack-review', 'bundle'), home / '.codex/skills/gstack-review')
        outside = skill(Path(tmp) / 'elsewhere/gstack-ship')
        skill(home / '.claude/skills/gstack-ship')
        os.symlink(outside, home / '.codex/skills/gstack-ship')
        skill(home / '.claude/skills/gstackish')
        skill(home / '.codex/skills/gstackish', 'drifted')
        errors = check(home, repo)
        assert not any(e.startswith(('gstack:', 'gstack-review')) for e in errors), errors
        assert any(e.startswith('gstack-ship: 2 different sources') for e in errors), errors
        assert any(e.startswith('gstackish: 2 different sources') for e in errors), errors
        assert any(e.startswith('shared: 2 different sources') for e in errors), errors
        assert not any(e.startswith('solo') for e in errors), errors
        assert any(e.startswith('owned2: Major-owned skill must symlink') for e in errors), errors
    print('check-skill-drift self-test passed')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument('--home', default=os.environ.get('HOME', '~'))
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    home = Path(args.home).expanduser()
    if not any((home / rel).is_dir() for rel in HOST_DIRS):
        print('skill drift check skipped: no host skill directories')
        return 0
    errors = check(home, Path(args.repo))
    for error in errors:
        print(f'SKILL DRIFT: {error}', file=sys.stderr)
    if errors:
        print('Fix: keep one canonical home (repo skills/internal or ~/.agents/skills) and replace other copies with symlinks; see docs/skills-canonicalization.md.', file=sys.stderr)
        return 1
    print(f'skill drift check passed: {sum(1 for _ in host_entries(home))} host entries, one source each')
    return 0


if __name__ == '__main__':
    sys.exit(main())
