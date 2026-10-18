import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPage } from './helpers/ai-context.mjs';

function setup({mode = 'equivalent', question = 'Compute 6 times 7: _[SECRET_EXPECTED]', lang = 'en', graph = false, runtimeVersion} = {}) {
  const p = loadPage(`<div id="cell" class="math-exercise-cell" data-label="test" data-context-mode="none" data-mode="${mode}"><div class="math-exercise-question"></div><button class="math-check-btn">Check</button><button class="math-legend-btn">Help</button><button class="math-feedback-btn">Feedback</button><button class="math-reconfig-btn">Settings</button><div class="math-legend-panel" style="display:none"></div><div class="math-feedback-area"></div></div>`, {lang});
  const cell = p.document.querySelector('#cell');
  const rendered = p.api.renderTaskText(question, 'cell', '', 'col', mode);
  p.api.setQuestionContent(cell.querySelector('.math-exercise-question'), rendered);
  cell.dataset.fields = JSON.stringify(rendered.fieldIds);
  cell.dataset.structuralFieldLabels = JSON.stringify(rendered.structuralLabels);
  cell.dataset.checker = JSON.stringify('SECRET_CHECKER');
  let runs = 0, result = {status: 'wrong', score: 0, feedback: 'SECRET_CHECK_MESSAGE', expected: 'SECRET_RESULT'};
  p.window.mainPyodide = {loadPackage: async () => {}, globals: {set() {}}, runPythonAsync: async () => { runs++; return JSON.stringify(result); }};
  if (graph) cell.dataset.response = 'jsxgraph:graph';
  if (runtimeVersion) p.window.AIFeedback.version = runtimeVersion;
  p.api.setupCell(cell);
  for (const input of cell.querySelectorAll('.math-input')) input.value = '40';
  const F = p.window.AIFeedback;
  F.saveConfig({mode: 'api', storage: 'local', baseUrl: 'https://example.invalid/v1', model: 'test', apiKey: 'test-only'});
  return Object.assign(p, {cell, F, runs: () => runs, result: value => result = value});
}
async function settle(button) {
  for (let i = 0; i < 80 && button.disabled; i++) await new Promise(r => setTimeout(r, 0));
  assert.equal(button.disabled, false, 'button must finish');
}
async function feedback(p) {
  const button = p.cell.querySelector('.math-feedback-btn'); button.click(); await settle(button);
  return p.requests.at(-1)?.body;
}
async function check(p) { const button = p.cell.querySelector('.math-check-btn'); button.click(); await settle(button); }
function data(body) { return JSON.parse(Array.isArray(body.messages[1].content) ? body.messages[1].content[0].text : body.messages[1].content); }
function edit(p, value) {const input = p.cell.querySelector('.math-input'); input.value = value; input.dispatchEvent(new p.window.Event('input', {bubbles: true}));}

test('math Feedback never checks work; matching Check evidence is allowlisted and edits invalidate it', async () => {
  const p = setup();
  let body = await feedback(p);
  assert.equal(p.runs(), 0); assert.equal(data(body).evidence.length, 0);
  assert.doesNotMatch(JSON.stringify(body), /SECRET_/);
  p.result({status: 'correct', score: 1});
  await check(p); assert.ok(p.cell.querySelector('.math-input-ok')); const runs = p.runs();
  body = await feedback(p); assert.equal(p.runs(), runs);
  assert.equal(data(body).evidence.length, 1);
  assert.match(data(body).evidence[0].text, /correct/);
  assert.doesNotMatch(JSON.stringify(body), /SECRET_/);
  edit(p, '41'); assert.equal(p.cell.querySelector('.math-input-ok'), null); body = await feedback(p);
  assert.equal(p.runs(), runs); assert.equal(data(body).evidence.length, 0);
  p.dom.window.close();
});

test('four API teaching steps permit a complete solution only at step four', async () => {
  const p = setup();
  for (let n = 1; n <= 4; n++) {
    const body = await feedback(p);
    assert.ok(body.messages[0].content.includes(p.F.shippedPolicies.integrations['math-exercise'].steps[n-1]['step-prompt']));
    assert.equal(body.messages[0].content.includes('A complete rewrite or solution is permitted'), n === 4);
    assert.equal(p.cell.querySelector('.ai-feedback-hint').textContent, 'Hint ' + n);
  }
  assert.equal(p.runs(), 0); p.dom.window.close();
});

test('copy prompts use the same four teaching steps, shared settings and no transport', async () => {
  const p = setup(); p.F.saveConfig({mode: 'copy'});
  for (let n = 1; n <= 4; n++) {
    await feedback(p);
    const prompt = p.cell.querySelector('pre').textContent;
    assert.ok(prompt.includes(p.F.shippedPolicies.integrations['math-exercise'].steps[n-1]['step-prompt']));
    assert.equal(prompt.includes('A complete rewrite or solution is permitted'), n === 4);
    assert.doesNotMatch(prompt, /SECRET_/);
  }
  assert.equal(p.requests.length, 0); assert.equal(p.runs(), 0);
  assert.equal(p.cell.querySelectorAll('.ai-feedback-gear').length, 1);
  p.dom.window.close();
});

test('Check completing after an edit cannot become feedback evidence', async () => {
  const p = setup(); let resolve;
  p.window.mainPyodide.runPythonAsync = () => new Promise(r => { resolve = r; });
  const button = p.cell.querySelector('.math-check-btn'); button.click();
  await new Promise(r => setTimeout(r, 0)); edit(p, '41'); resolve('{}');
  await new Promise(r => setTimeout(r, 0));
  // SymPy bootstrap (guard and checker module) completes before the actual field check; all are controlled.
  for (let i = 0; i < 5 && button.disabled; i++) { resolve(JSON.stringify({status: 'correct', score: 1})); await new Promise(r => setTimeout(r, 0)); }
  await settle(button);
  assert.equal(data(await feedback(p)).evidence.length, 0); p.dom.window.close();
});

test('failed and cancelled replies do not advance hints or restore stale advice', async () => {
  const p = setup();
  p.window.fetch = async () => ({ok: false, status: 500, text: async () => 'failure'});
  await feedback(p); assert.equal(p.window.sessionStorage.getItem('ai-feedback-hints-v2|/exercises|math-test'), null);
  let finish;
  p.window.fetch = () => new Promise(r => { finish = r; });
  const button = p.cell.querySelector('.math-feedback-btn'); button.click();
  await new Promise(r => setTimeout(r, 0)); edit(p, 'new response');
  finish({ok: true, json: async () => ({choices: [{message: {content: 'OLD ADVICE'}}]})});
  await settle(button);
  assert.doesNotMatch(p.cell.querySelector('.ai-feedback-output').textContent, /OLD ADVICE/);
  assert.equal(p.window.sessionStorage.getItem('ai-feedback-hints-v2|/exercises|math-test'), null);
  p.dom.window.close();
});

test('static vector and matrix responses retain field positions without answer keys', async () => {
  const p = setup({question: 'A vector vec[SECRET_A,SECRET_B] and matrix mat[SECRET_C,SECRET_D;SECRET_E,SECRET_F]'});
  const body = await feedback(p);
  assert.match(data(body).responses[0].value, /Component 1/);
  assert.match(data(body).responses[0].value, /Row 2, column 2/);
  assert.doesNotMatch(JSON.stringify(body), /SECRET_/); assert.equal(p.runs(), 0); p.dom.window.close();
});

test('dynamic matrices retain shape, allow empty bases, and resizing clears advice and evidence', async () => {
  const p = setup({mode: 'custom', question: 'Enter mat{name=B,rows=2,cols=auto,min-cols=0,max-cols=3,initial-cols=1}'});
  p.result({status: 'partial', score: 0.5, assessment: {B: {columns: ['correct'], private: 'SECRET_ASSESSMENT'}}, feedback: 'SECRET_MESSAGE'});
  await check(p); let body = await feedback(p);
  assert.match(data(body).evidence[0].text, /column/); assert.doesNotMatch(JSON.stringify(body), /SECRET_/);
  const remove = p.cell.querySelector('[data-dynamic-action="remove-col"]');
  assert.ok(remove, 'resize button exists'); remove.click();
  assert.equal(p.cell.querySelector('.ai-feedback-output').textContent, '');
  const runs = p.runs(); body = await feedback(p);
  assert.equal(data(body).evidence.length, 0); assert.match(data(body).responses[0].value, /rows="0" columns="0"/);
  assert.equal(p.runs(), runs); p.dom.window.close();
});

test('graph requests send only curated AI summary/image while private payload stays local', async () => {
  const p = setup({mode: 'custom', question: 'Draw a graph.', graph: true});
  const frame = p.document.createElement('iframe'); frame.id = 'graph'; p.document.body.append(frame);
  let graph = {vertices: [1, 2], private: 'SECRET_GRAPH'}, png = 0;
  frame.contentWindow.postMessage = message => queueMicrotask(() => {
    p.window.dispatchEvent(new p.window.MessageEvent('message', {source: frame.contentWindow, data: {
      protocol: message.protocol, version: message.version, type: 'response', requestId: message.requestId, assessmentId: 'graph',
      payload: graph, ai: {summary: 'Two vertices.', image: 'data:image/png;base64,' + (++png % 2 ? 'YWJj' : 'ZGVm')}
    }}));
  });
  let body = await feedback(p);
  assert.equal(p.runs(), 0); assert.doesNotMatch(JSON.stringify(body), /SECRET_GRAPH/);
  assert.match(JSON.stringify(body), /Two vertices/); assert.ok(p.cell.querySelector('.ai-feedback-body'));
  await check(p); const runs = p.runs(); body = await feedback(p);
  assert.equal(data(body).evidence.length, 1);
  graph = {vertices: [1, 2, 3], private: 'SECRET_GRAPH'};
  body = await feedback(p); assert.equal(data(body).evidence.length, 0); assert.equal(p.runs(), runs);
  p.dom.window.close();
});

for (const lang of ['en', 'de', 'nb']) test('actual adapter preserves ' + lang + ' teaching policy', async () => {
  const p = setup({lang});
  const body = await feedback(p);
  assert.ok(body.messages[0].content.includes(p.F.shippedPolicies.integrations['math-exercise'].steps[0]['step-prompt']));
  assert.ok(body.messages[0].content.includes('Write explanations in ' + lang));
  p.dom.window.close();
});

test('canonical math context excludes other shared activities and previous feedback', async () => {
  const p = setup();
  const ctx = p.document.createElement('div'); ctx.id = 'lesson'; ctx.className = 'ai-feedback-context';
  ctx.innerHTML = '<p>Allowed lesson <span data-ai-feedback-tex="x^2">WRONG_GLYPHS</span></p><div class="ai-feedback-activity">PRIVATE_ACTIVITY</div><div class="ai-feedback-output">PRIVATE_FEEDBACK</div><div class="ai-feedback-settings">PRIVATE_SETTINGS</div>';
  p.document.body.append(ctx); p.cell.dataset.contextMode = 'explicit'; p.cell.dataset.contextRefs = 'lesson';
  const body = await feedback(p);
  assert.match(data(body).materials[0].text, /Allowed lesson/);
  assert.match(data(body).materials[0].text, /x\^2/);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE_|WRONG_GLYPHS/);
  p.dom.window.close();
});

test('minimum-version gate survives editing and a successful Check', async () => {
  const p = setup({runtimeVersion: '0.1.0'});
  edit(p, '42'); p.result({status: 'correct', score: 1}); await check(p);
  assert.ok(p.cell.querySelector('.math-fb-ok'));
  assert.equal(p.cell.querySelector('.math-feedback-btn').disabled, true);
  assert.match(p.cell.querySelector('.ai-feedback-output').textContent, /Update.*ai-feedback/);
  p.cell.querySelector('.math-feedback-btn').click(); assert.equal(p.requests.length, 0);
  p.dom.window.close();
});

test('Check restarts shared hint progression by default; an override can preserve it',async()=>{
 const p=setup();await feedback(p);await feedback(p);
 assert.equal(p.cell.querySelector('.ai-feedback-hint').textContent,'Hint 2');
 await check(p);await feedback(p);assert.equal(p.cell.querySelector('.ai-feedback-hint').textContent,'Hint 1');
 p.window.__aiFeedbackPolicies={projectPolicy:'preserve',layers:[{policies:{preserve:{'reset-on-run':false}}}]};
 await feedback(p);await check(p);await feedback(p);assert.equal(p.cell.querySelector('.ai-feedback-hint').textContent,'Hint 2');p.dom.window.close();
});

test('a long check in a worker runtime offers Stop; a stopped check is not repeated', async () => {
  const p = loadPage('<div id="cell" class="math-exercise-cell" data-label="t" data-context-mode="none" data-mode="equivalent"><div class="math-exercise-question"></div><button class="math-check-btn">Check</button><button class="math-legend-btn">Help</button><div class="math-legend-panel" style="display:none"></div><div class="math-feedback-area"></div></div>',
    {lang: 'en'}, w => { w.__mathExerciseSlowCheckMs = 30; });
  const cell = p.document.querySelector('#cell');
  const rendered = p.api.renderTaskText('Compute: _[2]', 'cell', '', 'col', 'equivalent');
  p.api.setQuestionContent(cell.querySelector('.math-exercise-question'), rendered);
  cell.dataset.fields = JSON.stringify(rendered.fieldIds);
  let checks = 0, restarts = 0, reject;
  p.window.mainPyodide = {loadPackage: async () => {}, globals: {set: async () => {}},
    restart() { restarts++; reject(new Error('Python was restarted.')); },
    runPythonAsync: code => code.includes('_math_check') ? (checks++, new Promise((_, r) => { reject = r; })) : Promise.resolve()};
  p.api.setupCell(cell);
  cell.querySelector('.math-input').value = '9**9**9**9';
  cell.querySelector('.math-check-btn').click();
  for (let i = 0; i < 100 && !cell.querySelector('.math-stop-btn'); i++) await new Promise(r => setTimeout(r, 5));
  cell.querySelector('.math-stop-btn').click();
  for (let i = 0; i < 100 && !cell.querySelector('.math-fb-err'); i++) await new Promise(r => setTimeout(r, 5));
  assert.match(cell.querySelector('.math-fb-err').textContent, /Stopped\. Python was restarted/);
  assert.equal(restarts, 1);
  assert.equal(checks, 1);
  p.dom.window.close();
});

test('loading SymPy does not count towards stop-after; the check itself does', async () => {
  const p = loadPage('<div id="cell" class="math-exercise-cell" data-label="t" data-context-mode="none" data-mode="equivalent"><div class="math-exercise-question"></div><button class="math-check-btn">Check</button><button class="math-legend-btn">Help</button><div class="math-legend-panel" style="display:none"></div><div class="math-feedback-area"></div></div>',
    {lang: 'en'}, w => { w.__mathExerciseSlowCheckMs = 30; });
  const cell = p.document.querySelector('#cell');
  const rendered = p.api.renderTaskText('Compute: _[2]', 'cell', '', 'col', 'equivalent');
  p.api.setQuestionContent(cell.querySelector('.math-exercise-question'), rendered);
  cell.dataset.fields = JSON.stringify(rendered.fieldIds);
  let loaded;
  const loading = new Promise(r => { loaded = r; });   // a slow network
  p.window.mainPyodide = {loadPackage: () => loading, globals: {set: async () => {}}, restart() {},
    runPythonAsync: code => code.includes('_math_check') ? new Promise(() => {}) : Promise.resolve()};
  p.api.setupCell(cell);
  cell.querySelector('.math-input').value = '2';
  cell.querySelector('.math-check-btn').click();
  await new Promise(r => setTimeout(r, 200));
  assert.equal(cell.querySelector('.math-stop-btn'), null);
  loaded();
  for (let i = 0; i < 100 && !cell.querySelector('.math-stop-btn'); i++) await new Promise(r => setTimeout(r, 5));
  assert.ok(cell.querySelector('.math-stop-btn'));
  p.dom.window.close();
});

test('a SymPy load that never finishes still offers Stop, after the load limit', async () => {
  const p = loadPage('<div id="cell" class="math-exercise-cell" data-label="t" data-context-mode="none" data-mode="equivalent"><div class="math-exercise-question"></div><button class="math-check-btn">Check</button><button class="math-legend-btn">Help</button><div class="math-legend-panel" style="display:none"></div><div class="math-feedback-area"></div></div>',
    {lang: 'en'}, w => { w.__mathExerciseSlowCheckMs = 30; w.__qExercisePyodideTimeout = 200; });
  const cell = p.document.querySelector('#cell');
  const rendered = p.api.renderTaskText('Compute: _[2]', 'cell', '', 'col', 'equivalent');
  p.api.setQuestionContent(cell.querySelector('.math-exercise-question'), rendered);
  cell.dataset.fields = JSON.stringify(rendered.fieldIds);
  let rejectLoad;
  p.window.mainPyodide = {loadPackage: () => new Promise((_, reject) => { rejectLoad = reject; }), globals: {set: async () => {}},
    restart() { rejectLoad(new Error('Python was restarted.')); }, runPythonAsync: () => Promise.resolve()};
  p.api.setupCell(cell);
  cell.querySelector('.math-input').value = '2';
  cell.querySelector('.math-check-btn').click();
  await new Promise(r => setTimeout(r, 100));
  assert.equal(cell.querySelector('.math-stop-btn'), null, 'not before the load limit');
  for (let i = 0; i < 300 && !cell.querySelector('.math-stop-btn'); i++) await new Promise(r => setTimeout(r, 10));
  cell.querySelector('.math-stop-btn').click();
  for (let i = 0; i < 100 && !cell.querySelector('.math-fb-err'); i++) await new Promise(r => setTimeout(r, 5));
  assert.match(cell.querySelector('.math-fb-err').textContent, /Stopped/);
  assert.equal(cell.querySelector('.math-check-btn').disabled, false);
  p.dom.window.close();
});

const STOP_CELL = '<div id="cell" class="math-exercise-cell" data-label="t" data-context-mode="none" data-mode="equivalent"><div class="math-exercise-question"></div><button class="math-check-btn">Check</button><button class="math-legend-btn">Help</button><div class="math-legend-panel" style="display:none"></div><div class="math-feedback-area"></div></div>';
function stopCell(setup) {
  const p = loadPage(STOP_CELL, {lang: 'en'}, setup);
  const cell = p.document.querySelector('#cell');
  const rendered = p.api.renderTaskText('Compute: _[2]', 'cell', '', 'col', 'equivalent');
  p.api.setQuestionContent(cell.querySelector('.math-exercise-question'), rendered);
  cell.dataset.fields = JSON.stringify(rendered.fieldIds);
  return {p, cell};
}

test('reloading SymPy after a runtime restart is timed by the load limit, not stop-after', async () => {
  const {p, cell} = stopCell(w => { w.__mathExerciseSlowCheckMs = 50; w.__qExercisePyodideTimeout = 5000; });
  let rejectCheck = null, reloaded = null, repeated = 0;
  const v1 = {loadPackage: async () => {}, globals: {set: async () => {}}, restart() {},
    runPythonAsync: code => code.includes('_math_check') ? new Promise((_, r) => { rejectCheck = r; }) : Promise.resolve()};
  const v2 = {loadPackage: () => new Promise(r => { reloaded = r; }), globals: {set: async () => {}}, restart() {},
    runPythonAsync: code => code.includes('_math_check') ? (repeated++, Promise.resolve(JSON.stringify({status: 'correct', score: 1}))) : Promise.resolve()};
  p.window.mainPyodide = v1;
  p.api.setupCell(cell);
  cell.querySelector('.math-input').value = '2';
  cell.querySelector('.math-check-btn').click();
  for (let i = 0; i < 200 && !rejectCheck; i++) await new Promise(r => setTimeout(r, 1));
  // pyodide-interaktiv restarts its worker (an interactive cell's Stop or restart).
  p.window.dispatchEvent(new p.window.Event('qpyodide-runtime-restart'));
  p.window.mainPyodide = v2;
  rejectCheck(new Error('Python was restarted.'));
  await new Promise(r => setTimeout(r, 300));
  assert.equal(cell.querySelector('.math-stop-btn'), null, 'no Stop while SymPy reloads');
  reloaded();
  for (let i = 0; i < 200 && cell.querySelector('.math-check-btn').disabled; i++) await new Promise(r => setTimeout(r, 2));
  assert.equal(repeated, 1);
  assert.ok(cell.querySelector('.math-fb-ok'));
  p.dom.window.close();
});

test('a worker that never finishes starting ends the check with a message after the load limit', async () => {
  const {p, cell} = stopCell(w => { w.__mathExerciseSlowCheckMs = 30; w.__qExercisePyodideTimeout = 200; w.qpyodideInstance = new Promise(() => {}); });
  p.api.setupCell(cell);
  cell.querySelector('.math-input').value = '2';
  cell.querySelector('.math-check-btn').click();
  for (let i = 0; i < 300 && !cell.querySelector('.math-fb-err'); i++) await new Promise(r => setTimeout(r, 10));
  assert.ok(cell.querySelector('.math-fb-err'), 'the check ends');
  assert.equal(cell.querySelector('.math-check-btn').disabled, false);
  p.dom.window.close();
});

const PACKAGE_CELL = '<div id="cell" class="math-exercise-cell" data-label="t" data-context-mode="none" data-mode="equivalent" data-packages=\'["numpy"]\'><div class="math-exercise-question"></div><button class="math-check-btn">Check</button><button class="math-legend-btn">Help</button><div class="math-legend-panel" style="display:none"></div><div class="math-feedback-area"></div></div>';

test('reloading the exercise packages after a runtime restart is timed by the load limit', async () => {
  const p = loadPage(PACKAGE_CELL, {lang: 'en'}, w => { w.__mathExerciseSlowCheckMs = 50; w.__qExercisePyodideTimeout = 5000; });
  const cell = p.document.querySelector('#cell');
  const rendered = p.api.renderTaskText('Compute: _[2]', 'cell', '', 'col', 'equivalent');
  p.api.setQuestionContent(cell.querySelector('.math-exercise-question'), rendered);
  cell.dataset.fields = JSON.stringify(rendered.fieldIds);
  let rejectNumpy = null, numpyV2 = null;
  const v1 = {loadPackage: name => String(name).includes('numpy') ? new Promise((_, r) => { rejectNumpy = r; }) : Promise.resolve(),
    globals: {set: async () => {}}, restart() {}, runPythonAsync: async () => JSON.stringify({status: 'correct', score: 1})};
  const v2 = {loadPackage: name => String(name).includes('numpy') ? new Promise(r => { numpyV2 = r; }) : Promise.resolve(),
    globals: {set: async () => {}}, restart() {}, runPythonAsync: async () => JSON.stringify({status: 'correct', score: 1})};
  p.window.mainPyodide = v1;
  p.api.setupCell(cell);
  cell.querySelector('.math-input').value = '2';
  cell.querySelector('.math-check-btn').click();
  for (let i = 0; i < 200 && !rejectNumpy; i++) await new Promise(r => setTimeout(r, 1));
  assert.ok(rejectNumpy, 'numpy is loading');
  // An interactive cell restarts the worker while numpy loads.
  p.window.dispatchEvent(new p.window.Event('qpyodide-runtime-restart'));
  p.window.mainPyodide = v2;
  rejectNumpy(new Error('Python was restarted.'));
  for (let i = 0; i < 200 && !numpyV2; i++) await new Promise(r => setTimeout(r, 1));
  assert.ok(numpyV2, 'numpy reloads on the new runtime');
  await new Promise(r => setTimeout(r, 300));   // numpy still loading, far below the 5 s load limit
  const note = cell.querySelector('.math-feedback-area').textContent;
  assert.equal(cell.querySelector('.math-stop-btn'), null, 'no Stop while numpy reloads: ' + note);
  numpyV2();
  for (let i = 0; i < 200 && cell.querySelector('.math-check-btn').disabled; i++) await new Promise(r => setTimeout(r, 2));
  assert.ok(cell.querySelector('.math-fb-ok'), 'the repeated check is graded');
  p.dom.window.close();
});
