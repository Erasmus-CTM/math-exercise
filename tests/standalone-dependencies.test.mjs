// math-exercise is a part of CTM Assessment: without the package (or its
// library ctm-libs) the render stops with the install command; with ctm-libs
// the Feedback button is on by default; optional JSXGraph gives clear
// build-time messages instead of broken pages.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRequire } from 'node:module';
import { install, renderEnv } from './helpers/ctm-libs.mjs';
const require = createRequire(import.meta.url);

const quarto = process.env.QUARTO_BIN || 'quarto';
const available = !spawnSync(quarto, ['--version']).error;
const skip = available ? false : 'Quarto required';
const extension = fileURLToPath(new URL('../_extensions/math-exercise', import.meta.url));
const jsxgraph = process.env.JSXGRAPH_EXTENSION || fileURLToPath(new URL('../_extensions/jsxgraph', import.meta.url));
const INSTALL = 'Install CTM Assessment: quarto add https://erasmus-ctm.github.io/ctm-assessment/ctm-assessment.tar.gz';

function project({ withCtmLibs = true, withJsxgraph = false, withPackage = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'math-standalone-'));
  cpSync(extension, join(dir, '_extensions/math-exercise'), { recursive: true });
  if (withCtmLibs) install(dir);
  if (withJsxgraph) cpSync(jsxgraph, join(dir, '_extensions/jsxgraph'), { recursive: true });
  if (withPackage) {
    // The CTM Assessment package's manifest, which the bootstrap looks for.
    mkdirSync(join(dir, '_extensions/ctm-assessment'));
    writeFileSync(join(dir, '_extensions/ctm-assessment/_extension.yml'), 'title: CTM Assessment\nversion: 0.9.0\ncontributes:\n  filters:\n    - ctm-assessment.lua\n');
    writeFileSync(join(dir, '_extensions/ctm-assessment/ctm-assessment.lua'), 'return {}\n');
  }
  return dir;
}
function render(dir, front, body, env = renderEnv) {
  writeFileSync(join(dir, 'page.qmd'), '---\nformat: html\n' + front + '---\n\n' + body + '\n');
  return spawnSync(quarto, ['render', 'page.qmd'], { cwd: dir, env, encoding: 'utf8', timeout: 120000 });
}
const html = dir => readFileSync(join(dir, 'page.html'), 'utf8');
const withoutDev = () => { const env = { ...process.env }; delete env.CTM_COMPONENT_DEV; return env; };
const plain = '```{math-exercise}\n#| label: two\nCompute 1+1: _[2]\n```';
const graphical = (id) => '```{.jsxgraph assessment_id="board"}\nvar board = JXG.JSXGraph.initBoard(BOARDID, {boundingbox: [-2, 2, 2, -2]});\nJXG.QuartoAssessment.register({response: () => ({x: 1})});\n```\n\n' +
  '```{math-exercise}\n#| label: graph\n#| mode: custom\n#| response: jsxgraph:' + id + '\n#| checker: |\n#|   def check(response, symbols):\n#|       return {"correct": response["x"] == 1}\nMove the point.\n```';

test('without CTM Assessment or its library ctm-libs the render stops with the install command', { skip }, () => {
  let dir = project({ withCtmLibs: false });
  try {
    let r = render(dir, 'filters: [math-exercise]\n', plain, withoutDev());
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /math-exercise is part of CTM Assessment, which is not installed in this project/);
    assert.ok(r.stderr.includes(INSTALL), r.stderr);
    // A component development build without ctm-libs.
    r = render(dir, 'filters: [math-exercise]\n', plain);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /needs its library ctm-libs, which is not installed/);
    assert.ok(r.stderr.includes(INSTALL), r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  dir = project();
  try {
    const r = render(dir, 'filters: [math-exercise]\n', plain, withoutDev());
    assert.notEqual(r.status, 0);
    assert.ok(r.stderr.includes(INSTALL), r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('next to the CTM Assessment package it renders without CTM_COMPONENT_DEV', { skip }, () => {
  const dir = project({ withPackage: true });
  try {
    const r = render(dir, 'filters: [math-exercise]\n', plain, withoutDev());
    assert.equal(r.status, 0, r.stderr);
    assert.match(html(dir), /math-check-btn/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('feedback: auto and true give the Feedback button, false hides it, other values stop', { skip }, () => {
  const dir = project();
  try {
    for (const front of ['', 'math-exercise:\n  feedback: auto\n', 'math-exercise:\n  feedback: true\n']) {
      const r = render(dir, 'filters: [math-exercise]\n' + front, plain);
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /AI feedback/);
      assert.match(html(dir), /class="btn btn-light math-feedback-btn"/);
      assert.match(html(dir), /class="btn btn-light math-reconfig-btn"/);
      assert.match(html(dir), /<script src="[^"]*\/ai-feedback-[\d.]+\/feedback-core\.js"><\/script>/);
    }
    let r = render(dir, 'filters: [math-exercise]\nmath-exercise:\n  feedback: false\n', plain);
    assert.equal(r.status, 0, r.stderr);
    assert.match(html(dir), /math-check-btn/);
    assert.doesNotMatch(html(dir), /math-feedback-btn|math-reconfig-btn|feedback-core\.js/);
    r = render(dir, 'filters: [math-exercise]\nmath-exercise:\n  feedback: maybe\n', plain);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /feedback must be auto, true or false/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a build without AI feedback has no Feedback button; feedback: true is named in one build message', { skip }, () => {
  const dir = project();
  const off = { ...renderEnv, CTM_FEEDBACK: 'off' };
  try {
    let r = render(dir, 'filters: [math-exercise]\n', plain + '\n\n' + plain.replace('two', 'three'), off);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /AI feedback is off/);
    assert.match(html(dir), /math-check-btn/);
    assert.doesNotMatch(html(dir), /math-feedback-btn|feedback-core\.js|window\.__aiFeedbackConfig =/);
    r = render(dir, 'filters: [math-exercise]\nmath-exercise:\n  feedback: true\n', plain + '\n\n' + plain.replace('two', 'three'), off);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr.match(/AI feedback is off for this build \(CTM_FEEDBACK=off\); left out on this page: math-exercise feedback \(feedback: true in page\.qmd\)/g)?.length, 1, r.stderr);
    assert.doesNotMatch(html(dir), /math-feedback-btn|feedback-core\.js/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scripts and styles are cacheable dependencies: once per page, the runtime and catalogue before the exercise scripts', { skip }, () => {
  const dir = project();
  try {
    const r = render(dir, 'filters: [math-exercise]\nlang: nb\n', plain + '\n\n' + plain.replace('two', 'three'));
    assert.equal(r.status, 0, r.stderr);
    const page = html(dir);
    const order = ['ctm-runtime-[\\d.]+/pyodide-runtime\\.js', 'ctm-locale-[\\d.]+/ctm-locale\\.js', 'ctm-locale-math-exercise-[\\d.]+/math-exercise\\.js',
      'math-exercise-[\\d.]+/matrix-input\\.js', 'math-exercise-[\\d.]+/math-exercise\\.js'].map(file => {
      const found = [...page.matchAll(new RegExp('<script src="[^"]*/' + file + '"></script>', 'g'))];
      assert.equal(found.length, 1, file);
      return found[0].index;
    });
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.ok(page.indexOf('window.__mathExerciseConfig = {"lang":"nb"') < order[3]);
    assert.equal((page.match(/<link href="[^"]*\/math-exercise-[\d.]+\/math-exercise\.css" rel="stylesheet">/g) || []).length, 1);
    assert.doesNotMatch(page, /MathExerciseRuntime = |var LOCALES|<style type="text\/css">/);
    assert.match(page, /math-check-btn">✓&nbsp;Sjekk</);
    for (const src of page.matchAll(/<(?:script src|link href)="([^"]*quarto-contrib[^"]*)"/g)) assert.ok(existsSync(join(dir, src[1])), src[1]);
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
      const page = html(dir);
      assert.match(page, /<iframe[^>]* id="board"/);
      assert.match(page, /data-response="jsxgraph:board"/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Check grades with the page\'s own scripts and no AI feedback on the page (feedback: false)', { skip }, async () => {
  const { JSDOM } = require('jsdom');
  const dir = project();
  try {
    const r = render(dir, 'filters: [math-exercise]\nmath-exercise:\n  feedback: false\n', plain);
    assert.equal(r.status, 0, r.stderr);
    const dom = new JSDOM(html(dir), { url: 'https://example.invalid/', runScripts: 'outside-only' });
    const w = dom.window;
    assert.equal(w.AIFeedback, undefined);
    w.__mathExerciseTestMode = true;
    w.mainPyodide = { loadPackage: async () => {}, globals: { set() {} },
      runPythonAsync: async code => code.includes('_math_runtime_source') ? undefined : JSON.stringify({ status: 'correct', score: 1 }) };
    // KaTeX is imported from a CDN as an ES module; jsdom cannot, so the legend gets a stub.
    w.__katexStub = { default: { render() {}, renderToString: () => '' } };
    // The page's dependencies (ctm-libs' runtime and catalogue, then this
    // extension's scripts), in document order.
    const scripts = [...w.document.querySelectorAll('script[src*="quarto-contrib/"]')].map(script => script.getAttribute('src'));
    assert.ok(scripts.length >= 5, scripts.join(', '));
    for (const src of scripts) {
      w.eval(readFileSync(join(dir, src), 'utf8').replace(/import\(KATEX \+ '[^']*'\)/g, 'Promise.resolve(window.__katexStub)'));
    }
    const cell = w.document.querySelector('.math-exercise-cell');
    w.__mathExerciseTestApi.setupCell(cell);
    cell.querySelector('.math-input').value = '2';
    cell.querySelector('.math-check-btn').click();
    for (let i = 0; i < 100 && !cell.querySelector('.math-fb-ok, .math-fb-err'); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(cell.querySelector('.math-fb-ok'), cell.querySelector('.math-feedback-area').innerHTML);
    dom.window.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a page that uses JSXGraph without the extension stops, also without exercises; unused files are never loaded', { skip }, () => {
  const dir = project();
  try {
    let r = render(dir, 'filters: [math-exercise]\n', '```{.jsxgraph}\nvar board = JXG.JSXGraph.initBoard(BOARDID, {});\n```');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Run: quarto add jsxgraph\/jsxgraph-quarto/);
    r = render(dir, 'filters: [math-exercise]\nmath-exercise:\n  feedback: false\n', plain);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(html(dir), /feedback-core\.js|jsxgraphcore/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AI feedback is loaded only when the page uses it', { skip }, () => {
  const dir = project();
  try {
    // auto, but nothing on the page needs feedback
    let r = render(dir, 'filters: [math-exercise]\n', '::: {.callout-note}\nNo exercise here.\n:::');
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(html(dir), /feedback-core\.js|math-exercise\.js/);
    // exercise feedback off, but a text activity on the page is prepared; exercises get no Feedback button
    r = render(dir, 'filters: [math-exercise]\nmath-exercise:\n  feedback: false\n', plain + '\n\n::: {.ai-feedback}\nExplain.\n:::');
    assert.equal(r.status, 0, r.stderr);
    const page = html(dir);
    assert.match(page, /ai-feedback-activity/);
    assert.doesNotMatch(page, /class="btn btn-light math-feedback-btn"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the interface language: math-exercise: lang, then ctm-assessment: lang, then lang (nn gives Bokmål)', { skip }, () => {
  const dir = project();
  try {
    const own = 'math-exercise:\n  feedback: false\n';
    for (const [front, label] of [['lang: de\n' + own, 'Überprüfen'], ['lang: nn\n' + own, 'Sjekk'],
      ['lang: de\nctm-assessment:\n  lang: nb\n' + own, 'Sjekk'], ['lang: de\nctm-assessment:\n  lang: nb\n' + own + '  lang: en\n', 'Check']]) {
      const r = render(dir, 'filters: [math-exercise]\n' + front, plain);
      assert.equal(r.status, 0, r.stderr);
      assert.match(html(dir), new RegExp('math-check-btn">✓&nbsp;' + label + '<'), front);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stop-after is read per component or for all components, and validated', { skip }, () => {
  const dir = project();
  try {
    let r = render(dir, 'filters: [math-exercise]\nmath-exercise:\n  feedback: false\n', plain);
    assert.equal(r.status, 0, r.stderr);
    assert.match(html(dir), /"stopAfter":20/);
    r = render(dir, 'filters: [math-exercise]\nctm-assessment:\n  stop-after: 45\nmath-exercise:\n  feedback: false\n', plain);
    assert.match(html(dir), /"stopAfter":45/);
    r = render(dir, 'filters: [math-exercise]\nctm-assessment:\n  stop-after: 45\nmath-exercise:\n  feedback: false\n  stop-after: 5\n', plain);
    assert.match(html(dir), /"stopAfter":5/);
    r = render(dir, 'filters: [math-exercise]\nmath-exercise:\n  feedback: false\n  stop-after: soon\n', plain);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /stop-after must be a number of seconds/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('non-HTML output carries no script configuration', { skip }, () => {
  const dir = project();
  try {
    writeFileSync(join(dir, 'page.qmd'), '---\nformat: gfm\nfilters: [math-exercise]\nmath-exercise: {feedback: false}\n---\n\n' + plain + '\n');
    const r = spawnSync(quarto, ['render', 'page.qmd'], { cwd: dir, env: renderEnv, encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(readFileSync(join(dir, 'page.md'), 'utf8'), /__mathExerciseConfig|<script/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
