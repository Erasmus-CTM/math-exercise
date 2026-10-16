import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { readdirSync } from 'node:fs';

test('the tests authored beside every custom example pass', () => {
  const root = new URL('../', import.meta.url).pathname;
  const files = readdirSync(`${root}_includes`).filter(p => p.endsWith('.qmd')).map(p => `${root}_includes/${p}`);
  files.push(`${root}examples.qmd`, `${root}dynamic-matrix-tests.qmd`);
  for (const name of ['reference.md', 'assess-basis.md', 'graph-editor.md', 'question-tests.md']) files.push(`${root}docs/${name}`);
  const result = spawnSync(process.env.PYTHON || 'python3', [`${root}_extensions/math-exercise/question-tests.py`, ...files], {
    cwd: root, encoding: 'utf8', timeout: 60000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /40 authored question tests passed; 0 custom questions without tests/);
});
