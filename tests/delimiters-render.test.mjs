// The first render (Lua) and later redraws (JS) must normalize math delimiters
// identically; escaped dollars stay literal.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const quarto = process.env.QUARTO_BIN || 'quarto';
const available = !spawnSync(quarto, ['--version']).error;
const source = readFileSync(new URL('../_extensions/math-exercise/math-exercise.js', import.meta.url), 'utf8');

test('Lua and JS normalize task delimiters the same way', { skip: available ? false : 'Quarto required' }, () => {
  const task = String.raw`Price \$5 or \$7, solve $x+1=2$, show $$a$$ and $unclosed: _[1]`;
  const dir = mkdtempSync(join(tmpdir(), 'math-delimiters-'));
  try {
    cpSync(fileURLToPath(new URL('../_extensions/math-exercise', import.meta.url)), join(dir, '_extensions/math-exercise'), { recursive: true });
    writeFileSync(join(dir, 'page.qmd'), '---\nformat: html\nfilters: [math-exercise]\nmath-exercise: {feedback: false}\n---\n\n```{math-exercise}\n#| label: d\n' + task + '\n```\n');
    const r = spawnSync(quarto, ['render', 'page.qmd'], { cwd: dir, encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, r.stderr);
    const html = readFileSync(join(dir, 'page.html'), 'utf8');
    const context = vm.createContext({ console, document: { addEventListener() {} }, window: { __mathExerciseConfig: { lang: 'en' }, __mathExerciseTestMode: true } });
    vm.runInContext(source, context);
    const expected = context.window.__mathExerciseTestApi.normalizeTaskMathDelimiters(task.replace(/: _\[1\]$/, ''));
    assert.equal(expected, String.raw`Price \$5 or \$7, solve \(x+1=2\), show \[a\] and $unclosed`);
    assert.ok(html.includes('>' + expected + ': <input'), 'Lua rendering differs from the JS normalization');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
