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

test('a hard restart cancels active and queued checks without package loads or replay', async () => {
  const p = loadPage(CELL('a', 'custom', ['scipy']) + CELL('b', 'equivalent', ['numpy']), {lang:'en'});
  const a = prep(p,'a','custom'), b = prep(p,'b','equivalent');
  let rejectCustom, numpyLoads = 0, replacementLoads = 0;
  const v1 = {loadPackage: async name => {if(String(name).includes('numpy')) numpyLoads++;},
    globals:{set:async()=>{}}, restart(){},
    runPythonAsync: code => code.includes(CHECK_CUSTOM) ? new Promise((_,reject)=>{rejectCustom=reject;}) : Promise.resolve(JSON.stringify({status:'correct',score:1}))};
  p.window.mainPyodide = v1;
  p.api.setupCell(a); p.api.setupCell(b);
  for(const cell of [a,b])cell.querySelector('.math-input').value='2';
  a.querySelector('.math-check-btn').click();
  assert.ok(await until(()=>rejectCustom),'A owns the interpreter');
  b.querySelector('.math-check-btn').click();
  await tick(30);
  assert.equal(numpyLoads,0,'queued B cannot load packages while A runs');
  p.window.dispatchEvent(new p.window.CustomEvent('qpyodide-runtime-restart',{detail:{proxy:v1}}));
  p.window.mainPyodide={loadPackage:async()=>{replacementLoads++;},globals:{set:async()=>{}},runPythonAsync:async()=>JSON.stringify({status:'correct',score:1})};
  rejectCustom(new Error('Python was restarted.'));
  assert.ok(await until(()=>![a,b].some(cell=>cell.querySelector('.math-check-btn').disabled)));
  assert.equal(numpyLoads,0);
  assert.equal(replacementLoads,0,'a replacement never replays either cancelled check');
  assert.match(area(a),/Stopped/);assert.match(area(b),/Stopped/);
  b.querySelector('.math-check-btn').click();
  assert.ok(await until(()=>!b.querySelector('.math-check-btn').disabled));
  assert.ok(replacementLoads>0,'only an explicit new Check starts on the replacement');
  assert.match(area(b),/Correct/);
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
