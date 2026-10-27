// Line breaks inside math and bare \begin{..}..\end{..} environments (both
// common in AI-generated similar problems, especially matrices) must reach
// KaTeX's auto-render as one delimited text run, identically in the first
// render (Lua) and in later redraws and generated problems (JS).
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

// Each task has one formula before its single answer field.
const tasks = {
  'display math over several lines': 'Invert\n$$\nA=\\begin{pmatrix}2&1\\\\\n1&1\\end{pmatrix}\n$$\n_[1]',
  'inline math with a line break': 'Invert $A=\\begin{pmatrix}2&1\\\\\n1&1\\end{pmatrix}$ now. _[1]',
  'bracket display over several lines': 'Invert\n\\[\nA=\\begin{pmatrix}2&1\\\\ 1&1\\end{pmatrix}\n\\]\n_[1]',
  'bare matrix environment': String.raw`Invert A = \begin{pmatrix}2&1\\1&1\end{pmatrix} now. _[1]`,
  'bare display environment': 'Solve\n\\begin{align}x+y&=1\\\\\nx-y&=0\\end{align}\n_[1]',
};

function api() {
  const context = vm.createContext({ console, document: { addEventListener() {} }, window: { addEventListener() {}, __mathExerciseConfig: { lang: 'en' }, __mathExerciseTestMode: true } });
  context.addEventListener = () => {};
  runInContext(context, RUNTIME);
  runInContext(context, LOCALE);
  vm.runInContext(source, context);
  return context.window.__mathExerciseTestApi;
}
const prefix = html => html.slice(0, html.indexOf('<input'));

test('KaTeX auto-render typesets formulas with line breaks and bare environments', () => {
  const { JSDOM } = require('jsdom');
  const renderer = api();
  for (const [name, task] of Object.entries(tasks)) {
    const html = renderer.renderTaskText(task, 'x', '', 'col', 'equivalent', false).html;
    const dom = new JSDOM('<!doctype html><div id="q">' + html + '</div>');
    global.Node = dom.window.Node; global.document = dom.window.document;
    try {
      const renderMathInElement = require('katex/dist/contrib/auto-render.js').default || require('katex/dist/contrib/auto-render.js');
      const el = dom.window.document.getElementById('q');
      renderMathInElement(el, { delimiters: [
        { left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false }, { left: '\\[', right: '\\]', display: true }], throwOnError: false });
      assert.equal(el.querySelectorAll('.katex').length, 1, name + ': one typeset formula');
      assert.equal(el.querySelectorAll('.katex-error').length, 0, name + ': no KaTeX error');
      const rest = el.cloneNode(true);
      rest.querySelectorAll('.katex').forEach(node => node.remove());
      assert.doesNotMatch(rest.textContent, /\\(?:begin|end|\(|\[)/, name + ': no raw TeX left');
    } finally { delete global.Node; delete global.document; dom.window.close(); }
  }
});

test('Lua and JS render these formulas the same way', { skip: available ? false : 'Quarto required' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'math-spans-'));
  try {
    cpSync(fileURLToPath(new URL('../_extensions/math-exercise', import.meta.url)), join(dir, '_extensions/math-exercise'), { recursive: true });
    install(dir);
    const names = Object.keys(tasks);
    writeFileSync(join(dir, 'page.qmd'), '---\nformat: html\nfilters: [math-exercise]\nmath-exercise: {feedback: false}\n---\n\n' +
      names.map((name, i) => '```{math-exercise}\n#| label: s' + i + '\n' + tasks[name] + '\n```\n').join('\n'));
    const r = spawnSync(quarto, ['render', 'page.qmd'], { cwd: dir, env: renderEnv, encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, r.stderr);
    const page = readFileSync(join(dir, 'page.html'), 'utf8');
    const renderer = api();
    names.forEach((name, i) => {
      const js = prefix(renderer.renderTaskText(tasks[name], 's' + i, '', 'col', 'equivalent', false).html);
      assert.ok(js.length > 0, name + ': JS prefix');
      assert.ok(page.includes('>' + js + '<input'), name + ': Lua renders ' + JSON.stringify(js));
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
