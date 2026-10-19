// Without AI feedback (P22), an exercise without a static check (custom mode
// without a checker) is assessed by AI feedback only. math-exercise decides
// that with its own options (also a generated exercise's YAML) and asks
// ctm-libs (ctm.policy.withoutAI), which applies ai-feedback: without-ai.
// A ctm-libs without that function renders such exercises as before; these
// tests need one with it.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRequire } from 'node:module';
import { ctmLibs, install, renderEnv } from './helpers/ctm-libs.mjs';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const quarto = process.env.QUARTO_BIN || 'quarto';
const available = !spawnSync(quarto, ['--version']).error;
const hasApi = /function M\.withoutAI\(/.test(readFileSync(join(ctmLibs, 'lua', 'policy.lua'), 'utf8'));
const skip = !available ? 'Quarto required' : !hasApi ? 'this ctm-libs has no ctm.policy.withoutAI' : false;
const extension = fileURLToPath(new URL('../_extensions/math-exercise', import.meta.url));
const OFF = { ...renderEnv, CTM_FEEDBACK: 'off' };
const NOTE = 'This exercise has no automatic feedback in this version.';

const custom = '```{math-exercise}\n#| label: sketch\n#| caption: A sketch\n#| mode: custom\nDraw \\(y=x^2\\) and give $f(2)$: _[4] and vec[1,2]\n```';
const pool = '```{math-exercise}\n#| label: pool-custom\n#| mode: custom\n#| pool: true\nFirst task: vec[1,2] and mat{name=A, rows=2, cols=auto}\n---\nSecond task: _[3]\n```';
// A generated exercise whose checker is YAML (one space after "#|"): it has a static check.
const generated = '```{math-exercise}\n#| label: gen-custom\n#| mode: custom\n#| parameters:\n#|   a: [1, 2, 3]\n#| checker: |\n#|  def check(response, symbols):\n#|      return True\nCompute {{a}} + 1: _[{{a}}+1]\n```';
// A generated exercise without a checker: its first variant is HTML already (Pandoc), shown as it is.
const generatedText = '```{math-exercise}\n#| label: gen-text\n#| mode: custom\n#| parameters:\n#|   a: [2, 4]\nCompute $\\frac{ {{a}} }{2}$ **now**: _[{{a}}/2] and vec[1,2]\n```';
const checked = '```{math-exercise}\n#| label: two\nCompute 1+1: _[2]\n```';
const body = [custom, pool, generated, generatedText, checked].join('\n\n');

function withProject(run) {
  const dir = mkdtempSync(join(tmpdir(), 'math-without-ai-'));
  try {
    cpSync(extension, join(dir, '_extensions/math-exercise'), { recursive: true });
    install(dir);
    return run(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function render(dir, front, text, env = OFF) {
  writeFileSync(join(dir, 'page.qmd'), '---\nformat: html\nfilters: [math-exercise]\n' + front + '---\n\n' + text + '\n');
  return spawnSync(quarto, ['render', 'page.qmd'], { cwd: dir, env, encoding: 'utf8', timeout: 120000 });
}
const page = dir => new JSDOM(readFileSync(join(dir, 'page.html'), 'utf8')).window.document;
const message = stderr => (/AI feedback is off for this build \(CTM_FEEDBACK=off\); ([^\n]*)\./.exec(stderr) || [])[1];

test('unset: a custom exercise without a checker stops the build; one with a YAML checker does not', { skip }, () => withProject(dir => {
  let r = render(dir, '', body);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /and page\.qmd has an exercise that only AI feedback can assess: sketch \(math-exercise in custom mode without a checker\)\.\n/);
  // A generated exercise without a checker counts too.
  r = render(dir, '', [generatedText, checked].join('\n\n'));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /has an exercise that only AI feedback can assess: gen-text \(math-exercise in custom mode without a checker\)\.\n/);
  assert.match(r.stderr, /ai-feedback:\n {2}without-ai: text/);
  r = render(dir, '', [generated, checked].join('\n\n'));
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /only AI feedback can assess/);
  // math-exercise: feedback: false: such an exercise has no AI feedback in either build.
  r = render(dir, 'math-exercise:\n  feedback: false\n', body);
  assert.equal(r.status, 0, r.stderr);
}));

test('text: the question without answer fields and Check, with its maths and the note', { skip }, () => withProject(dir => {
  const r = render(dir, 'ai-feedback:\n  without-ai: text\n', body);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(message(r.stderr), 'shown as text, without automatic feedback (without-ai: text in page.qmd): sketch; pool-custom; gen-text');
  const doc = page(dir);
  const texts = [...doc.querySelectorAll('.math-exercise-text')];
  assert.equal(texts.length, 3);
  for (const text of texts) {
    assert.equal(text.querySelectorAll('input, textarea, button, .math-exercise-controls').length, 0);
    assert.equal(text.querySelector('.ctm-without-ai').textContent.trim(), NOTE);
  }
  const sketch = texts[0];
  assert.equal(sketch.querySelector('.math-exercise-caption').textContent, 'A sketch');
  // The question keeps its maths for typesetting; answer fields become "…".
  assert.equal(sketch.querySelector('.math-exercise-question').textContent, 'Draw \\(y=x^2\\) and give \\(f(2)\\): … and …');
  assert.equal(texts[1].querySelector('.math-exercise-question').textContent, 'First task: … and …', 'a pool shows its first task');
  // A generated exercise without a checker: its first variant's markup is shown, not escaped.
  const variant = texts[2].querySelector('.math-exercise-question');
  assert.equal(variant.querySelector('strong').textContent, 'now');
  assert.match(variant.querySelector('[data-ai-feedback-tex] .math.inline').textContent, /^\\\(\\frac\{ [24] \}\{2\}\\\)$/);
  assert.match(variant.textContent, /^Compute \\\(\\frac\{ [24] \}\{2\}\\\) now: … and …$/);
  assert.doesNotMatch(variant.textContent, /<|data-ai-feedback|\{\{a\}\}/);
  // The generated exercise has its checker: rendered as usual, nothing of its code or template leaks.
  const cells = [...doc.querySelectorAll('.math-exercise-cell')];
  assert.deepEqual(cells.map(cell => cell.dataset.label), ['gen-custom', 'two']);
  assert.ok(cells[0].dataset.variants);
  assert.doesNotMatch(doc.body.textContent, /return True|\{\{a\}\}/);
  assert.equal(doc.querySelectorAll('.math-check-btn').length, 2);
}));

test('drop removes them; with AI feedback nothing changes', { skip }, () => withProject(dir => {
  let r = render(dir, 'ai-feedback:\n  without-ai: drop\n', body);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(message(r.stderr), 'removed from this page (without-ai: drop in page.qmd): sketch; pool-custom; gen-text. Links and cross-references to them no longer resolve');
  let doc = page(dir);
  assert.equal(doc.querySelectorAll('.math-exercise-text, .ctm-without-ai').length, 0);
  assert.deepEqual([...doc.querySelectorAll('.math-exercise-cell')].map(cell => cell.dataset.label), ['gen-custom', 'two']);
  assert.doesNotMatch(doc.body.textContent, /Draw|First task/);
  // With AI feedback the setting is not used.
  r = render(dir, 'ai-feedback:\n  without-ai: drop\n', body, renderEnv);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /AI feedback is off/);
  doc = page(dir);
  assert.deepEqual([...doc.querySelectorAll('.math-exercise-cell')].map(cell => cell.dataset.label), ['sketch', 'pool-custom', 'gen-custom', 'gen-text', 'two']);
  assert.equal(doc.querySelectorAll('.math-exercise-text, .ctm-without-ai').length, 0);
}));

test('a ctm-libs without ctm.policy.withoutAI: such an exercise is rendered as before', { skip: !available ? 'Quarto required' : hasApi ? 'this ctm-libs has ctm.policy.withoutAI' : false }, () => withProject(dir => {
  const r = render(dir, '', body);
  assert.equal(r.status, 0, r.stderr);
  const doc = page(dir);
  assert.deepEqual([...doc.querySelectorAll('.math-exercise-cell')].map(cell => cell.dataset.label), ['sketch', 'pool-custom', 'gen-custom', 'gen-text', 'two']);
  assert.equal(doc.querySelectorAll('.math-exercise-text').length, 0);
}));
