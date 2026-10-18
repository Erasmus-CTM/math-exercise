// math-exercise works installed on its own; optional dependencies give clear
// build-time messages instead of broken pages.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

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
    // A page without exercises (math-exercise listed project-wide) stays quiet.
    const quiet = render(dir, 'filters: [math-exercise]\n', '::: {.callout-note}\nNo exercise here.\n:::');
    assert.equal(quiet.status, 0, quiet.stderr);
    assert.doesNotMatch(quiet.stderr, /AI feedback is off/);
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
    assert.match(r.stderr, /uses JSXGraph boards \(`\.jsxgraph` blocks\), but the jsxgraph extension is not installed\. Run: quarto add jsxgraph\/jsxgraph-quarto/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a reference to a board that is not on the page names the missing assessment_id', { skip: skip || (!existsSync(jsxgraph) && 'JSXGraph not installed') }, () => {
  const dir = project({ withJsxgraph: true });
  try {
    const r = render(dir, 'filters: [jsxgraph, math-exercise]\nmath-exercise:\n  feedback: false\n', graphical('elsewhere'));
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

test('Check grades without ai-feedback on the page (feedback: auto without it, and feedback: false)', { skip }, async () => {
  const { JSDOM } = require('jsdom');
  for (const [withFeedback, front] of [[false, ''], [true, 'math-exercise:\n  feedback: false\n']]) {
    const dir = project({ withFeedback });
    try {
      const r = render(dir, 'filters: [math-exercise]\n' + front, plain);
      assert.equal(r.status, 0, r.stderr);
      const dom = new JSDOM(readFileSync(join(dir, 'page.html'), 'utf8'), { url: 'https://example.invalid/', runScripts: 'outside-only' });
      const w = dom.window;
      assert.equal(w.AIFeedback, undefined);
      w.__mathExerciseTestMode = true;
      w.mainPyodide = { loadPackage: async () => {}, globals: { set() {} },
        runPythonAsync: async code => code.includes('_math_runtime_source') ? undefined : JSON.stringify({ status: 'correct', score: 1 }) };
      // KaTeX is imported from a CDN as an ES module; jsdom cannot, so the legend gets a stub.
      w.__katexStub = { default: { render() {}, renderToString: () => '' } };
      for (const file of ['shared/pyodide-runtime.js', 'matrix-input.js', 'math-exercise.js']) {
        w.eval(readFileSync(join(extension, file), 'utf8').replace(/import\(KATEX \+ '[^']*'\)/g, 'Promise.resolve(window.__katexStub)'));
      }
      const cell = w.document.querySelector('.math-exercise-cell');
      w.__mathExerciseTestApi.setupCell(cell);
      cell.querySelector('.math-input').value = '2';
      cell.querySelector('.math-check-btn').click();
      for (let i = 0; i < 100 && !cell.querySelector('.math-fb-ok, .math-fb-err'); i++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(cell.querySelector('.math-fb-ok'), cell.querySelector('.math-feedback-area').innerHTML);
      dom.window.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('a page that uses a missing extension stops, also without exercises; unused ones are never loaded', { skip }, () => {
  const dir = project();
  try {
    let r = render(dir, 'filters: [math-exercise]\n', '::: {.ai-feedback}\nExplain.\n:::');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /uses AI feedback activities \(`\.ai-feedback` blocks\), but the ai-feedback extension is not installed\. Run: quarto add Erasmus-CTM\/ai-feedback/);
    r = render(dir, 'filters: [math-exercise]\n', '```{.jsxgraph}\nvar board = JXG.JSXGraph.initBoard(BOARDID, {});\n```');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Run: quarto add jsxgraph\/jsxgraph-quarto/);
    r = render(dir, 'filters: [math-exercise]\nmath-exercise:\n  feedback: false\n', plain);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(readFileSync(join(dir, 'page.html'), 'utf8'), /feedback-core\.js|jsxgraphcore/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ai-feedback is loaded only when the page uses it', { skip: skip || (!existsSync(feedback) && 'ai-feedback not installed') }, () => {
  const dir = project({ withFeedback: true });
  try {
    // auto, but nothing on the page needs feedback
    let r = render(dir, 'filters: [math-exercise]\n', '::: {.callout-note}\nNo exercise here.\n:::');
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(readFileSync(join(dir, 'page.html'), 'utf8'), /feedback-core\.js/);
    // exercise feedback off, but a text activity on the page is prepared; exercises get no Feedback button
    r = render(dir, 'filters: [math-exercise]\nmath-exercise:\n  feedback: false\n', plain + '\n\n::: {.ai-feedback}\nExplain.\n:::');
    assert.equal(r.status, 0, r.stderr);
    const html = readFileSync(join(dir, 'page.html'), 'utf8');
    assert.match(html, /ai-feedback-activity/);
    assert.doesNotMatch(html, /class="btn btn-light math-feedback-btn"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stop-after is read per component or for all components, and validated', { skip }, () => {
  const dir = project();
  try {
    let r = render(dir, 'filters: [math-exercise]\nmath-exercise:\n  feedback: false\n', plain);
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(join(dir, 'page.html'), 'utf8'), /"stopAfter":20/);
    r = render(dir, 'filters: [math-exercise]\nctm-assessment:\n  stop-after: 45\nmath-exercise:\n  feedback: false\n', plain);
    assert.match(readFileSync(join(dir, 'page.html'), 'utf8'), /"stopAfter":45/);
    r = render(dir, 'filters: [math-exercise]\nctm-assessment:\n  stop-after: 45\nmath-exercise:\n  feedback: false\n  stop-after: 5\n', plain);
    assert.match(readFileSync(join(dir, 'page.html'), 'utf8'), /"stopAfter":5/);
    r = render(dir, 'filters: [math-exercise]\nmath-exercise:\n  feedback: false\n  stop-after: soon\n', plain);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /stop-after must be a number of seconds/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('non-HTML output carries no script configuration', { skip }, () => {
  const dir = project();
  try {
    writeFileSync(join(dir, 'page.qmd'), '---\nformat: gfm\nfilters: [math-exercise]\nmath-exercise: {feedback: false}\n---\n\n' + plain + '\n');
    const r = spawnSync(quarto, ['render', 'page.qmd'], { cwd: dir, encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(readFileSync(join(dir, 'page.md'), 'utf8'), /__mathExerciseConfig|<script/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
