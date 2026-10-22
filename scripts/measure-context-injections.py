#!/usr/bin/env python3
"""Read-only: measure always-on injections in recent Claude Code transcripts.

Usage: python3 -I scripts/measure-context-injections.py [days]  (see docs/speed-and-tokens.md)
"""
import json, os, sys, glob, statistics, time, re
from collections import defaultdict
ROOT = os.path.expanduser('~/.claude/projects')
days = float(sys.argv[1]) if len(sys.argv) > 1 else 14
cut = time.time() - days * 86400
def label(a):
    cmd = a.get('command') or ''
    hn = a.get('hookName') or a.get('hookEvent') or ''
    c = str(a.get('content') or '')
    if 'ponytail' in cmd.lower() or 'PONYTAIL' in c[:200]: return 'ponytail'
    if 'major' in cmd and 'session hook' in cmd or c.startswith('MAJOR CONTROL PLANE'): return 'major-banner'
    if hn.startswith('SubagentStart') and ('Ponytail' in c[:400] or 'ponytail' in c[:400].lower()): return 'ponytail'
    if hn.startswith('UserPromptSubmit'):
        parts=[]
        if 'Local specialist routing' in c: parts.append('skill-dispatch')
        if 'retrieval candidate' in c or 'GBrain' in c: parts.append('gbrain-hint')
        return '+'.join(parts) or 'ups-other'
    return 'other:' + (cmd or hn)[:50]
stats = defaultdict(lambda: defaultdict(list))  # kind -> event -> sizes
sessions = {'main': 0, 'sub': 0}; seen = defaultdict(set)
instr = defaultdict(list); skills = {'main': [], 'sub': []}; persisted = defaultdict(list)
for f in glob.glob(ROOT + '/**/*.jsonl', recursive=True):
    if os.path.getmtime(f) < cut: continue
    kind = 'sub' if '/subagents/' in f else 'main'
    sessions[kind] += 1
    pend = {}
    for line in open(f, errors='ignore'):
        try: d = json.loads(line)
        except Exception: continue
        if d.get('type') != 'attachment': continue
        a = d['attachment']; t = a.get('type')
        if t in ('hook_success', 'hook_additional_context'):
            c = str(a.get('content') or '')
            if not c.strip(): continue
            ev = (a.get('hookEvent') or a.get('hookName') or '').split(':')[0]
            if t=='hook_additional_context' and a.get('hookName','').startswith('SubagentStart'): ev='SubagentStart'
            lab = label(a)
            m = re.search(r'Output too large \(([\d.]+)KB\)', c[:200])
            if m:
                persisted[(kind, ev, lab)].append(float(m.group(1))*1024)
            # hook_success content duplicates hook stdout; count each once per (event,label,content)
            key=(ev,lab,len(c))
            if key in pend: continue
            pend[key]=1
            stats[kind][(ev, lab)].append(len(c)); seen[(kind, ev, lab)].add(f)
        elif t == 'instructions':
            for x in a.get('files') or []:
                p = re.sub(r'/projects/[^/]+/', '/projects/*/', x.get('path',''))
                instr[(kind, p)].append(len(x.get('content') or ''))
        elif t == 'skill_listing':
            skills[kind].append(len(a.get('content') or ''))
print(f'window: {days}d  main sessions: {sessions["main"]}  subagent transcripts: {sessions["sub"]}')
print(f'{"where":5} {"event":18} {"injection":28} {"files":>6} {"n":>5} {"med chars":>9} {"~tok":>6} {"max tok":>7}')
for kind in ('main', 'sub'):
    for (ev, lab), v in sorted(stats[kind].items(), key=lambda kv: -sum(kv[1])):
        if len(seen[(kind, ev, lab)]) < 2: continue
        m = statistics.median(v)
        print(f'{kind:5} {ev:18} {lab:28} {len(seen[(kind,ev,lab)]):6} {len(v):5} {m:9.0f} {m/4:6.0f} {max(v)/4:7.0f}')
print('\nhook output over the inline limit (model sees only a ~2KB preview; full size):')
for k,v in persisted.items(): print(f'  {k}: n={len(v)} median {statistics.median(v):.0f} chars ~{statistics.median(v)/4:.0f}t')
print('\ninstruction files (median chars, ~tokens):')
for (kind, p), v in sorted(instr.items(), key=lambda kv: -statistics.median(kv[1])):
    if len(v) < 3: continue
    m = statistics.median(v); print(f'  {kind:5} {p:70} n={len(v):4} {m:7.0f} ~{m/4:5.0f}t')
for k, v in skills.items():
    if v: print(f'skill_listing {k}: n={len(v)} median {statistics.median(v):.0f} chars ~{statistics.median(v)/4:.0f}t')
