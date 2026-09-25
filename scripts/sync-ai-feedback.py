#!/usr/bin/env python3
"""Refresh the standalone fallback from an explicitly selected ai-feedback checkout."""
import argparse, hashlib, json, subprocess, re
from pathlib import Path
parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
args = parser.parse_args()
source = args.source / '_extensions' / 'ai-feedback'
target = Path(__file__).resolve().parents[1] / '_extensions' / 'math-exercise' / 'ai-feedback'
target.mkdir(exist_ok=True)
hashes = {}
for name in ('feedback-core.js', 'feedback-dom.js', 'ai-feedback.js', 'ai-feedback.css'):
    data = (source / name).read_bytes()
    (target / name).write_bytes(data)
    hashes[name] = hashlib.sha256(data).hexdigest()
(target / 'provenance.json').write_text(json.dumps({'repository': 'Erasmus-CTM/ai-feedback', 'version': re.search(r'^version:\s*(\S+)', (source / '_extension.yml').read_text(), re.M).group(1), 'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=args.source, text=True).strip(), 'source_dirty': bool(subprocess.check_output(['git', 'status', '--porcelain', '--', '_extensions/ai-feedback'], cwd=args.source, text=True).strip()), 'files': hashes}, indent=2) + '\n')
