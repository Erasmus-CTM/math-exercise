"""Build the exam/no-AI/default-off fixtures used by browser tests."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='ctm-similar-profiles-') as folder:
    project = Path(folder)
    shutil.copytree(ROOT / '_extensions', project / '_extensions')
    source = (ROOT / 'similar-problems.qmd').read_text()
    shutil.copy2(ROOT / 'similar-problems-policy.yml', project)
    (project / '_quarto.yml').write_text('project:\n  type: default\n  render: [similar-problems.qmd]\n')
    (project / '_quarto-exam.yml').write_text('ai-feedback:\n  enabled: false\n  without-ai: text\n')
    for profile in ('exam', 'without-ai', 'default-off', 'exercise-off'):
        page = source.replace('  similar: true\n', '', 1) if profile == 'default-off' else source
        if profile == 'exercise-off':
            page = page.replace('#| label: similar-derivative\n', '#| label: similar-derivative\n#| similar: false\n')
        (project / 'similar-problems.qmd').write_text(page)
        env = dict(os.environ, CTM_COMPONENT_DEV='1')
        if profile == 'without-ai': env['CTM_FEEDBACK'] = 'off'
        command = ['quarto', 'render', 'similar-problems.qmd', '--output-dir', str(ROOT / '_site' / ('similar-' + profile))]
        if profile == 'exam': command += ['--profile', 'exam']
        subprocess.run(command, cwd=project, env=env, check=True)

# Freeze the two mathematical wheels used by the real-browser Pyodide case.
import hashlib
import json
import urllib.request
runtime = ROOT / 'node_modules' / 'pyodide'
lock = json.loads((runtime / 'pyodide-lock.json').read_text())
cache = ROOT / 'test-results' / 'similar-runtime'
cache.mkdir(parents=True, exist_ok=True)
for name in ('mpmath', 'sympy'):
    entry = lock['packages'][name]
    target = cache / entry['file_name']
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != entry['sha256']:
        with urllib.request.urlopen('https://cdn.jsdelivr.net/pyodide/v0.28.3/full/' + target.name) as response:
            target.write_bytes(response.read())
    if hashlib.sha256(target.read_bytes()).hexdigest() != entry['sha256']:
        raise RuntimeError('Pyodide wheel digest mismatch: ' + name)
