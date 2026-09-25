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
  await check(p); const runs = p.runs();
  body = await feedback(p); assert.equal(p.runs(), runs);
  assert.equal(data(body).evidence.length, 1);
  assert.match(data(body).evidence[0].text, /incorrect/);
  assert.doesNotMatch(JSON.stringify(body), /SECRET_/);
  edit(p, '41'); body = await feedback(p);
  assert.equal(p.runs(), runs); assert.equal(data(body).evidence.length, 0);
  p.dom.window.close();
});

test('four API teaching steps permit a complete solution only at step four', async () => {
  const p = setup();
  for (let n = 1; n <= 4; n++) {
    const body = await feedback(p);
    assert.ok(body.messages[0].content.includes(p.api.locale['promptHint' + n]));
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
    assert.ok(prompt.includes(p.api.locale['promptHint' + n]));
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
  // SymPy bootstrap completes before the actual field check; both are controlled.
  if (button.disabled) resolve(JSON.stringify({status: 'correct', score: 1}));
  await settle(button);
  assert.equal(data(await feedback(p)).evidence.length, 0); p.dom.window.close();
});

test('failed and cancelled replies do not advance hints or restore stale advice', async () => {
  const p = setup();
  p.window.fetch = async () => ({ok: false, status: 500, text: async () => 'failure'});
  await feedback(p); assert.equal(p.window.sessionStorage.getItem('ai-feedback-hints|/exercises|math-test'), null);
  let finish;
  p.window.fetch = () => new Promise(r => { finish = r; });
  const button = p.cell.querySelector('.math-feedback-btn'); button.click();
  await new Promise(r => setTimeout(r, 0)); edit(p, 'new response');
  finish({ok: true, json: async () => ({choices: [{message: {content: 'OLD ADVICE'}}]})});
  await settle(button);
  assert.doesNotMatch(p.cell.querySelector('.ai-feedback-output').textContent, /OLD ADVICE/);
  assert.equal(p.window.sessionStorage.getItem('ai-feedback-hints|/exercises|math-test'), null);
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
  assert.ok(body.messages[0].content.includes(p.api.locale.promptHint1));
  assert.ok(body.messages[0].content.includes(p.api.locale.promptLanguageGuard));
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
