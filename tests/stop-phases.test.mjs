// Stop and its timing while Python reloads after a restart, with several
// checks on one page (review round 9).
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPage } from './helpers/ai-context.mjs';
import { ANY_CHECK, CHECK_CUSTOM } from './helpers/ctm-checkers.mjs';

const CELL = (id, mode, pkgs) => `<div id="${id}" class="math-exercise-cell" data-label="${id}" data-context-mode="none" data-mode="${mode}" data-packages='${JSON.stringify(pkgs)}' data-checker='"def check(r): return True"'><div class="math-exercise-question"></div><button class="math-check-btn">Check</button><button class="math-legend-btn">Help</button><div class="math-legend-panel" style="display:none"></div><div class="math-feedback-area"></div></div>`;

function prep(p, id, mode) {
  const cell = p.document.querySelector('#' + id);
  const rendered = p.api.renderTaskText('Compute: _[2]', id, '', 'col', mode);
  p.api.setQuestionContent(cell.querySelector('.math-exercise-question'), rendered);
  cell.dataset.fields = JSON.stringify(rendered.fieldIds);
  return cell;
}
const tick = (ms = 1) => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 400, ms = 5) { for (let i = 0; i < n && !fn(); i++) await tick(ms); return fn(); }
const area = cell => cell.querySelector('.math-feedback-area').textContent;

test('Stop pressed while the exercise packages reload after a restart says Stopped', async () => {
  const p = loadPage(CELL('cell', 'equivalent', ['numpy']), {lang: 'en'}, w => { w.__mathExerciseSlowCheckMs = 50; w.__qExercisePyodideTimeout = 200; });
  const cell = prep(p, 'cell', 'equivalent');
  let rejectV1 = null, rejectV2 = null, restarts = 0;
  const ok = async () => JSON.stringify({status: 'correct', score: 1});
  const v1 = {loadPackage: n => String(n).includes('numpy') ? new Promise((_, r) => { rejectV1 = r; }) : Promise.resolve(), globals: {set: async () => {}}, restart() {}, runPythonAsync: ok};
  // Mirrors pyodide-interaktiv: restart(reason) rejects pending calls with Error(reason).
  const v2 = {loadPackage: n => String(n).includes('numpy') ? new Promise((_, r) => { rejectV2 = r; }) : Promise.resolve(), globals: {set: async () => {}},
    restart(reason) { restarts++; p.window.dispatchEvent(new p.window.Event('qpyodide-runtime-restart')); rejectV2(new Error(reason || 'Python was restarted.')); }, runPythonAsync: ok};
  p.window.mainPyodide = v1;
  p.api.setupCell(cell);
  cell.querySelector('.math-input').value = '2';
  cell.querySelector('.math-check-btn').click();
  await until(() => rejectV1);
  p.window.dispatchEvent(new p.window.Event('qpyodide-runtime-restart'));   // an interactive cell restarts the worker
  p.window.mainPyodide = v2;
  rejectV1(new Error('Python was restarted.'));
  assert.ok(await until(() => rejectV2), 'numpy reloads on v2');
  assert.ok(await until(() => cell.querySelector('.math-stop-btn')), 'Stop offered after the load limit');
  cell.querySelector('.math-stop-btn').click();
  await until(() => !cell.querySelector('.math-check-btn').disabled);
  assert.match(area(cell), /Stopped/, 'expected the localized "Stopped" message');
  p.dom.window.close();
});

test('a check still reloading its packages after a restart keeps the load limit when another check finishes its reload', async () => {
  const html = CELL('a', 'custom', ['scipy']) + CELL('b', 'equivalent', ['numpy']);
  const p = loadPage(html, {lang: 'en'}, w => { w.__mathExerciseSlowCheckMs = 50; w.__qExercisePyodideTimeout = 5000; });
  const a = prep(p, 'a', 'custom'), b = prep(p, 'b', 'equivalent');
  let rejectCustom = null, rejectNumpy = null, scipyV2 = null;
  const v1 = {
    loadPackage: n => String(n).includes('numpy') ? new Promise((_, r) => { rejectNumpy = r; }) : Promise.resolve(),
    globals: {set: async () => {}}, restart() {},
    runPythonAsync: code => code.includes(CHECK_CUSTOM) ? new Promise((_, r) => { rejectCustom = r; }) : Promise.resolve(JSON.stringify({status: 'correct', score: 1}))};
  const v2 = {
    loadPackage: n => String(n).includes('scipy') ? new Promise(r => { scipyV2 = r; }) : Promise.resolve(),
    globals: {set: async () => {}}, restart() {},
    runPythonAsync: async () => JSON.stringify({status: 'correct', score: 1})};
  p.window.mainPyodide = v1;
  p.api.setupCell(a); p.api.setupCell(b);
  a.querySelector('.math-input').value = '2';
  b.querySelector('.math-input').value = '2';
  a.querySelector('.math-check-btn').click();
  assert.ok(await until(() => rejectCustom), 'A is in its check phase (custom checker running)');
  b.querySelector('.math-check-btn').click();
  assert.ok(await until(() => rejectNumpy), 'B is loading numpy (its loading phase)');
  // pyodide-interaktiv restarts the worker: both in-flight calls fail and are retried.
  p.window.dispatchEvent(new p.window.Event('qpyodide-runtime-restart'));
  p.window.mainPyodide = v2;
  rejectCustom(new Error('Python was restarted.'));
  rejectNumpy(new Error('Python was restarted.'));
  assert.ok(await until(() => scipyV2), 'A reloads scipy on the new runtime');
  await tick(300);   // scipy is still loading, far below the 5 s load limit
  const stopShown = !!a.querySelector('.math-stop-btn');
  scipyV2();
  await until(() => !a.querySelector('.math-check-btn').disabled && !b.querySelector('.math-check-btn').disabled);
  assert.equal(stopShown, false, 'A must not offer Stop (stop-after) while it is still reloading its packages');
  p.dom.window.close();
});

test('the loading Stop note is taken back when the check itself starts', async () => {
  const p = loadPage(CELL('cell', 'equivalent', []), {lang: 'en'}, w => { w.__mathExerciseSlowCheckMs = 5000; w.__qExercisePyodideTimeout = 100; });
  const cell = prep(p, 'cell', 'equivalent');
  let loaded = null, checking = false;
  p.window.mainPyodide = {loadPackage: () => new Promise(r => { loaded = r; }), globals: {set: async () => {}}, restart() {},
    runPythonAsync: code => code.includes(ANY_CHECK) ? (checking = true, new Promise(() => {})) : Promise.resolve()};
  p.api.setupCell(cell);
  cell.querySelector('.math-input').value = '2';
  cell.querySelector('.math-check-btn').click();
  assert.ok(await until(() => cell.querySelector('.math-stop-btn')), 'Stop after the load limit');
  loaded();                                  // SymPy arrives; the check starts (stop-after 5 s)
  assert.ok(await until(() => checking));
  await tick(50);
  assert.doesNotMatch(area(cell), /still loading/, 'shows the loading phase while checking');
  p.dom.window.close();
});

test('a Stop note offered after an edit during the check goes with the abandoned check', async () => {
  const p = loadPage(CELL('cell', 'equivalent', []), {lang: 'en'}, w => { w.__mathExerciseSlowCheckMs = 60; w.__qExercisePyodideTimeout = 5000; });
  const cell = prep(p, 'cell', 'equivalent');
  let restarts = 0;
  p.window.mainPyodide = {loadPackage: async () => {}, globals: {set: async () => {}}, restart() { restarts++; },
    runPythonAsync: code => code.includes(ANY_CHECK) ? new Promise(r => setTimeout(() => r(JSON.stringify({status: 'correct', score: 1})), 300)) : Promise.resolve()};
  p.api.setupCell(cell);
  const input = cell.querySelector('.math-input');
  input.value = '2';
  cell.querySelector('.math-check-btn').click();
  await tick(20);
  input.value = '3'; input.dispatchEvent(new p.window.Event('input', {bubbles: true}));
  await until(() => !cell.querySelector('.math-check-btn').disabled, 400, 5);
  await tick(20);
  assert.equal(cell.querySelector('.math-stop-btn'), null, 'no Stop left for a check that has ended');
  assert.equal(restarts, 0);
  p.dom.window.close();
});
