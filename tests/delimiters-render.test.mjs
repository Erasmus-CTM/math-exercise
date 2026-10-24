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
import { install, LOCALE, RUNTIME, renderEnv, runInContext } from './helpers/ctm-libs.mjs';

const require = createRequire(import.meta.url);
const quarto = process.env.QUARTO_BIN || 'quarto';
const available = !spawnSync(quarto, ['--version']).error;
const source = readFileSync(new URL('../_extensions/math-exercise/math-exercise.js', import.meta.url), 'utf8');
const task = String.raw`Price \$5 or \$7, solve $x+1=2$, show $$a$$ and $unclosed: _[1]`;
const dollar = '<span class="math-literal-dollar">$</span>';
const expected = 'Price ' + dollar + '5 or ' + dollar + String.raw`7, solve \(x+1=2\), show \[a\] and $unclosed: `;

function api() {
  const context = vm.createContext({ console, document: { addEventListener() {} }, window: { addEventListener() {}, __mathExerciseConfig: { lang: 'en' }, __mathExerciseTestMode: true } });
  context.addEventListener = () => {};
  runInContext(context, RUNTIME);
  runInContext(context, LOCALE);
  vm.runInContext(source, context);
  return context.window.__mathExerciseTestApi;
}

test('Lua and JS render task delimiters the same way', { skip: available ? false : 'Quarto required' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'math-delimiters-'));
  try {
    cpSync(fileURLToPath(new URL('../_extensions/math-exercise', import.meta.url)), join(dir, '_extensions/math-exercise'), { recursive: true });
    install(dir);
    writeFileSync(join(dir, 'page.qmd'), '---\nformat: html\nfilters: [math-exercise]\nmath-exercise: {feedback: false}\n---\n\n```{math-exercise}\n#| label: d\n' + task + '\n```\n');
    const r = spawnSync(quarto, ['render', 'page.qmd'], { cwd: dir, env: renderEnv, encoding: 'utf8', timeout: 120000 });
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

test('an escaped dollar inside an answer marker is a plain dollar in the answer', { skip: available ? false : 'Quarto required' }, () => {
  const marked = String.raw`Cost \$6: _[\$6]`;
  const dir = mkdtempSync(join(tmpdir(), 'math-delimiters-'));
  try {
    cpSync(fileURLToPath(new URL('../_extensions/math-exercise', import.meta.url)), join(dir, '_extensions/math-exercise'), { recursive: true });
    install(dir);
    writeFileSync(join(dir, 'page.qmd'), '---\nformat: html\nfilters: [math-exercise]\nmath-exercise: {feedback: false}\n---\n\n```{math-exercise}\n#| label: d\n#| mode: string\n' + marked + '\n```\n');
    const r = spawnSync(quarto, ['render', 'page.qmd'], { cwd: dir, env: renderEnv, encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, r.stderr);
    const lua = readFileSync(join(dir, 'page.html'), 'utf8');
    const js = api().renderTaskText(marked, 'x', '', 'col', 'string', false).html;
    for (const [name, html] of [['Lua', lua], ['JS', js]]) {
      assert.match(html, /data-answer="\$6"/, name);
      assert.ok(html.includes('Cost ' + dollar + '6: '), name);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Exercise text allows a small inline Markdown subset outside math and shows
// HTML as text; math (also with * or <) is untouched. Lua and JS agree.
const markdownCases = [
  [String.raw`**1. Tittel.** La $a<b<c$, *x* er ` + '`kode`' + String.raw`; \*ikke\* <b>tag</b> & mer: _[1]`,
   String.raw`<strong>1. Tittel.</strong> La \(a&lt;b&lt;c\), <em>x</em> er <code>kode</code>; *ikke* &lt;b&gt;tag&lt;/b&gt; &amp; mer: `],
  [String.raw`$a*b*c$ og $$x**2$$, 2*3*4 og x * y, **fet *kursiv* inni**: _[1]`,
   String.raw`\(a*b*c\) og \[x**2\], 2*3*4 og x * y, <strong>fet <em>kursiv</em> inni</strong>: `],
  ['Linje\\\nny linje: _[1]', 'Linje<br>\nny linje: '],
  [String.raw`*Hint: skriv 2 \* x* _[1]`, String.raw`<em>Hint: skriv 2 * x</em> `],
  [String.raw`**Del $a$:** finn x og *La $x>0$.* _[1]`, String.raw`<strong>Del \(a\):</strong> finn x og <em>La \(x&gt;0\).</em> `],
  ['Kjør `echo $HOME` og `echo $PATH`: _[1]', 'Kjør <code>echo $HOME</code> og <code>echo $PATH</code>: '],
  ['***viktig*** nå: _[1]', '<em><strong>viktig</strong></em> nå: '],
  ['* '.repeat(4000) + '_[1]', '* '.repeat(4000)],
  [String.raw`** ikke fet** og *ikke kursiv * og ` + '``' + String.raw` tom: _[1]`,
   String.raw`** ikke fet** og *ikke kursiv * og ` + '``' + String.raw` tom: `],
];

test('Lua and JS format inline Markdown in exercise text the same way', { skip: available ? false : 'Quarto required' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'math-markdown-'));
  try {
    cpSync(fileURLToPath(new URL('../_extensions/math-exercise', import.meta.url)), join(dir, '_extensions/math-exercise'), { recursive: true });
    install(dir);
    const blocks = markdownCases.map(([task], i) => '```{math-exercise}\n#| label: m' + i + '\n' + task + '\n```\n').join('\n');
    writeFileSync(join(dir, 'page.qmd'), '---\nformat: html\nfilters: [math-exercise]\nmath-exercise: {feedback: false}\n---\n\n' + blocks);
    const r = spawnSync(quarto, ['render', 'page.qmd'], { cwd: dir, env: renderEnv, encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, r.stderr);
    const lua = readFileSync(join(dir, 'page.html'), 'utf8');
    for (const [task, expected] of markdownCases) {
      assert.ok(lua.includes('>' + expected + '<input'), 'Lua: ' + expected);
      assert.ok(api().renderTaskText(task, 'x', '', 'col', 'equivalent', false).html.startsWith(expected), 'JS: ' + expected);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('"{{" before formatted text does not start a Quarto shortcode', { skip: available ? false : 'Quarto required' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'math-shortcode-'));
  try {
    cpSync(fileURLToPath(new URL('../_extensions/math-exercise', import.meta.url)), join(dir, '_extensions/math-exercise'), { recursive: true });
    install(dir);
    // "{{" before markup or at a line end; the second exercise must survive too.
    writeFileSync(join(dir, 'page.qmd'), '---\nformat: html\nfilters: [math-exercise]\nmath-exercise: {feedback: false}\n---\n\n```{math-exercise}\n#| label: s\na {{*x* b _[1]\n```\n\n```{math-exercise}\n#| label: t\nc {{\nd _[2]\n```\n\n```{math-exercise}\n#| label: u\nlast _[3]\n```\n');
    const r = spawnSync(quarto, ['render', 'page.qmd'], { cwd: dir, env: renderEnv, encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, r.stderr);
    const html = readFileSync(join(dir, 'page.html'), 'utf8');
    assert.ok(html.includes('>a {{<em>x</em> b <input'), 'the field after "{{" survives');
    assert.equal((html.match(/class="math-exercise-cell/g) || []).length, 3, 'no exercise swallowed');
    assert.equal((html.match(/math-check-btn"/g) || []).length, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
