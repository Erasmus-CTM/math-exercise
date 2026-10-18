// math-exercise works installed on its own; optional dependencies give clear
// build-time messages instead of broken pages.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const quarto = process.env.QUARTO_BIN || 'quarto';
const available = !spawnSync(quarto, ['--version']).error;
const skip = available ? false : 'Quarto required';
const extension = fileURLToPath(new URL('../_extensions/math-exercise', import.meta.url));
const jsxgraph = process.env.JSXGRAPH_EXTENSION || fileURLToPath(new URL('../_extensions/jsxgraph', import.meta.url));
const feedback = process.env.AI_FEEDBACK_EXTENSION || fileURLToPath(new URL('../_extensions/ai-feedback', import.meta.url));

function project({ withFeedback = false, withJsxgraph = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'math-standalone-'));
  cpSync(extension, join(dir, '_extensions/math-exercise'), { recursive: true });
  if (withFeedback) cpSync(feedback, join(dir, '_extensions/ai-feedback'), { recursive: true });
  if (withJsxgraph) cpSync(jsxgraph, join(dir, '_extensions/jsxgraph'), { recursive: true });
  return dir;
}
function render(dir, front, body) {
  writeFileSync(join(dir, 'page.qmd'), '---\nformat: html\n' + front + '---\n\n' + body + '\n');
  return spawnSync(quarto, ['render', 'page.qmd'], { cwd: dir, encoding: 'utf8', timeout: 120000 });
}
const plain = '```{math-exercise}\n#| label: two\nCompute 1+1: _[2]\n```';
const graphical = (id) => '```{.jsxgraph assessment_id="board"}\nvar board = JXG.JSXGraph.initBoard(BOARDID, {boundingbox: [-2, 2, 2, -2]});\nJXG.QuartoAssessment.register({response: () => ({x: 1})});\n```\n\n' +
  '```{math-exercise}\n#| label: graph\n#| mode: custom\n#| response: jsxgraph:' + id + '\n#| checker: |\n#|   def check(response, symbols):\n#|       return {"correct": response["x"] == 1}\nMove the point.\n```';

test('renders without ai-feedback: no Feedback button and one clear message', { skip }, () => {
  const dir = project();
  try {
    const r = render(dir, 'filters: [math-exercise]\n', plain + '\n\n' + plain.replace('two', 'three'));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr.match(/AI feedback is off because the ai-feedback extension is not installed/g)?.length, 1);
    assert.match(r.stderr, /quarto add Erasmus-CTM\/ai-feedback/);
    const html = readFileSync(join(dir, 'page.html'), 'utf8');
    assert.match(html, /math-check-btn/);
    assert.doesNotMatch(html, /class="btn btn-light math-feedback-btn"|feedback-core\.js/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('feedback: false is silent; feedback: true requires ai-feedback', { skip }, () => {
  const dir = project();
  try {
    let r = render(dir, 'filters: [math-exercise]\nmath-exercise:\n  feedback: false\n', plain);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /AI feedback is off/);
    r = render(dir, 'filters: [math-exercise]\nmath-exercise:\n  feedback: true\n', plain);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /quarto add Erasmus-CTM\/ai-feedback/);
    r = render(dir, 'filters: [math-exercise]\nmath-exercise:\n  feedback: maybe\n', plain);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /feedback must be auto, true or false/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('with ai-feedback installed the Feedback button is unchanged', { skip: skip || (!existsSync(feedback) && 'ai-feedback not installed') }, () => {
  const dir = project({ withFeedback: true });
  try {
    const r = render(dir, 'filters: [math-exercise]\n', plain);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /AI feedback is off/);
    assert.match(readFileSync(join(dir, "page.html"), "utf8"), /class="btn btn-light math-feedback-btn"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('graphical answers name the missing JSXGraph extension or diagram', { skip }, () => {
  const dir = project();
  try {
    let r = render(dir, 'filters: [math-exercise]\n', graphical('board'));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /need the JSXGraph extension\. Run `quarto add jsxgraph\/jsxgraph-quarto`/);
    r = render(dir, 'filters: [math-exercise]\n', graphical('elsewhere'));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /exercise graph refers to jsxgraph:elsewhere, but this page has no JSXGraph block with assessment_id="elsewhere"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('graphical answers render with the upstream JSXGraph extension in either filter order', { skip: skip || (!existsSync(jsxgraph) && 'JSXGraph not installed') }, () => {
  const dir = project({ withJsxgraph: true });
  try {
    for (const filters of ['[jsxgraph, math-exercise]', '[math-exercise, jsxgraph]']) {
      const r = render(dir, 'filters: ' + filters + '\nmath-exercise:\n  feedback: false\n', graphical('board'));
      assert.equal(r.status, 0, r.stderr);
      const html = readFileSync(join(dir, 'page.html'), 'utf8');
      assert.match(html, /<iframe[^>]* id="board"/);
      assert.match(html, /data-response="jsxgraph:board"/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
