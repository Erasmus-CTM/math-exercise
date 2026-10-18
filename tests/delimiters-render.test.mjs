// The first render (Lua) and later redraws (JS) must normalize math delimiters
// identically; escaped dollars stay literal, also for KaTeX auto-render.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const quarto = process.env.QUARTO_BIN || 'quarto';
const available = !spawnSync(quarto, ['--version']).error;
const source = readFileSync(new URL('../_extensions/math-exercise/math-exercise.js', import.meta.url), 'utf8');
const task = String.raw`Price \$5 or \$7, solve $x+1=2$, show $$a$$ and $unclosed: _[1]`;
const dollar = '<span class="math-literal-dollar">$</span>';
const expected = 'Price ' + dollar + '5 or ' + dollar + String.raw`7, solve \(x+1=2\), show \[a\] and $unclosed: `;

function api() {
  const context = vm.createContext({ console, document: { addEventListener() {} }, window: { __mathExerciseConfig: { lang: 'en' }, __mathExerciseTestMode: true } });
  vm.runInContext(source, context);
  return context.window.__mathExerciseTestApi;
}

test('Lua and JS render task delimiters the same way', { skip: available ? false : 'Quarto required' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'math-delimiters-'));
  try {
    cpSync(fileURLToPath(new URL('../_extensions/math-exercise', import.meta.url)), join(dir, '_extensions/math-exercise'), { recursive: true });
    writeFileSync(join(dir, 'page.qmd'), '---\nformat: html\nfilters: [math-exercise]\nmath-exercise: {feedback: false}\n---\n\n```{math-exercise}\n#| label: d\n' + task + '\n```\n');
    const r = spawnSync(quarto, ['render', 'page.qmd'], { cwd: dir, encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(readFileSync(join(dir, 'page.html'), 'utf8').includes('>' + expected + '<input'), 'Lua rendering');
    assert.ok(api().renderTaskText(task, 'x', '', 'col', 'equivalent', false).html.startsWith(expected), 'JS rendering');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('KaTeX auto-render typesets the math and keeps escaped dollars literal', () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="q">' + api().renderTaskText(task, 'x', '', 'col', 'equivalent', false).html + '</div>');
  global.Node = dom.window.Node; global.document = dom.window.document;
  try {
    const renderMathInElement = require('katex/dist/contrib/auto-render.js').default || require('katex/dist/contrib/auto-render.js');
    const el = dom.window.document.getElementById('q');
    renderMathInElement(el, { delimiters: [
      { left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false },
      { left: '\\(', right: '\\)', display: false }, { left: '\\[', right: '\\]', display: true }], throwOnError: false });
    assert.equal(el.querySelectorAll('.katex').length, 2);
    assert.match(el.textContent, /^Price \$5 or \$7, solve /);
  } finally { delete global.Node; delete global.document; dom.window.close(); }
});

test('an escaped dollar inside an answer marker stays part of the answer', { skip: available ? false : 'Quarto required' }, () => {
  const marked = String.raw`Cost \$6: _[\$6]`;
  const dir = mkdtempSync(join(tmpdir(), 'math-delimiters-'));
  try {
    cpSync(fileURLToPath(new URL('../_extensions/math-exercise', import.meta.url)), join(dir, '_extensions/math-exercise'), { recursive: true });
    writeFileSync(join(dir, 'page.qmd'), '---\nformat: html\nfilters: [math-exercise]\nmath-exercise: {feedback: false}\n---\n\n```{math-exercise}\n#| label: d\n#| mode: string\n' + marked + '\n```\n');
    const r = spawnSync(quarto, ['render', 'page.qmd'], { cwd: dir, encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, r.stderr);
    const lua = readFileSync(join(dir, 'page.html'), 'utf8');
    const js = api().renderTaskText(marked, 'x', '', 'col', 'string', false).html;
    for (const [name, html] of [['Lua', lua], ['JS', js]]) {
      assert.match(html, /data-answer="\\\$6"/, name);
      assert.ok(html.includes('Cost ' + dollar + '6: '), name);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
