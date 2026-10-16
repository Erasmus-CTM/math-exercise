import assert from 'node:assert/strict';
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {loadPage, typesetMathJax} from './helpers/ai-context.mjs';

const katex = readFileSync(new URL('../node_modules/katex/dist/katex.min.js', import.meta.url), 'utf8');
const autoRender = readFileSync(new URL('../node_modules/katex/dist/contrib/auto-render.min.js', import.meta.url), 'utf8');

const question = String.raw`Enter positive integers $a<b<c$ satisfying $a^2+b^2=c^2$:
$a=$ _[3], $b=$ _[4], $c=$ _[5]`;
const formulas = /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g;
const delimiters = [
  {left: '\\(', right: '\\)', display: false},
  {left: '\\[', right: '\\]', display: true},
];

function typesetKatex(page, el) {
  page.window.eval(katex);
  page.window.eval(autoRender);
  page.window.renderMathInElement(el, {delimiters, throwOnError: true});
}

function verifyQuestion(page, el, mathjaxFirst) {
  assert.match(el.textContent, /a<b<c/);
  assert.match(el.textContent, /a\^2\+b\^2=c\^2/);
  assert.equal(el.querySelectorAll('input').length, 3);
  if (mathjaxFirst) typesetMathJax(page, 4);
  typesetKatex(page, el);
  assert.equal(el.querySelectorAll('.katex, mjx-container').length, 5);
  assert.equal(el.querySelectorAll('.katex-error, mjx-merror').length, 0);
  const text = el.cloneNode(true);
  text.querySelectorAll('.katex, mjx-container').forEach(node => node.remove());
  assert.doesNotMatch(text.textContent, /\\[()[\]]/);
}

for (const mathjaxFirst of [false, true]) {
  test(`pooled task preserves inequalities and all five formulas (${mathjaxFirst ? 'MathJax first' : 'KaTeX only'})`, () => {
    const page = loadPage('<!doctype html><div id="question"></div>');
    try {
      const rendered = page.api.renderTaskText(question, 'triple', '', 'col', 'custom');
      const el = page.document.getElementById('question');
      page.api.setQuestionContent(el, rendered);
      assert.equal(el.dataset.mathExerciseSource.match(formulas).length, 5);
      assert.doesNotMatch(el.dataset.mathExerciseSource, /data-answer/);
      verifyQuestion(page, el, mathjaxFirst);
    } finally { page.window.close(); }
  });
}

test('task text preserves matrix alignment, literal entities and nonbreaking spaces', () => {
  const page = loadPage('<!doctype html>');
  try {
    const task = String.raw`$\begin{matrix}a&b\\c&d\end{matrix}$ &quot; <literal> _[7]`;
    const el = page.document.createElement('div');
    el.innerHTML = page.api.renderTaskText(task, 'matrix', '', 'col').html;
    assert.equal(el.textContent, String.raw`\(\begin{matrix}a&b\\c&d\end{matrix}\) &quot; <literal> `);
    assert.equal(el.querySelectorAll('literal').length, 0);
    typesetKatex(page, el);
    assert.equal(el.querySelectorAll('.katex').length, 1);
  } finally { page.window.close(); }
});

test('Quarto static tasks and saved feedback source retain the complete inequality', () => {
  const dir = mkdtempSync(join(tmpdir(), 'math-task-rendering-'));
  let page;
  try {
    cpSync(new URL('../_extensions/math-exercise', import.meta.url), join(dir, '_extensions/math-exercise'), {recursive: true});
    cpSync(process.env.AI_FEEDBACK_EXTENSION, join(dir, '_extensions/ai-feedback'), {recursive: true});
    writeFileSync(join(dir, 'lesson.qmd'), '---\nformat: html\nfilters: [math-exercise]\n---\n\n```{math-exercise}\n#| label: triple\n' + question + '\n```\n');
    const result = spawnSync(process.env.QUARTO_BIN || 'quarto', ['render', 'lesson.qmd'], {cwd: dir, encoding: 'utf8', timeout: 60000});
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    page = loadPage(readFileSync(join(dir, 'lesson.html'), 'utf8'));
    const cell = page.document.querySelector('.math-exercise-cell');
    assert.match(page.api.questionText(cell, JSON.parse(cell.dataset.fields), () => 'Answer'), /a<b<c/);
    assert.doesNotMatch(cell.querySelector('.math-exercise-question').dataset.mathExerciseSource, /data-answer/);
    verifyQuestion(page, cell.querySelector('.math-exercise-question'), true);
  } finally { page?.window.close(); rmSync(dir, {recursive: true, force: true}); }
});
