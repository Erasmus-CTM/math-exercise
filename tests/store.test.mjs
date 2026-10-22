import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const source = name => readFileSync(new URL('../_extensions/math-exercise/' + name, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const ui = {sourceChanged: 'Source changed', variantChanged: 'Variant changed', variantWithdrawn: 'Variant withdrawn',
  copyAnswer: 'Copy answer', copyAnswerLabel: id => 'Copy the answer in exercise ' + id,
  showSaved: 'Show saved answers', outdated: 'Outdated', statusCorrect: 'Correct', statusPartial: 'Partial',
  statusWrong: 'Wrong', statusInvalid: 'Invalid', confirmNewVariant: 'Replace the answers?',
  lastChecked: (date, status, percent) => 'Last checked ' + date + ': ' + status + ' (' + percent + '%)'};
const math = new Proxy({legend: [], feedbackFieldSingle: 'Answer', feedbackFieldNumbered: n => 'Field ' + n,
  vecComponent: n => 'v' + n, dynamicMatCell: (name, row, col) => name + row + ',' + col,
  matCell: (row, col) => 'm' + row + ',' + col, resPartial: n => 'Partial ' + n, resScore: n => 'Score ' + n},
{get: (object, key) => key in object ? object[key] : String(key)});

function page({meta = {state: 'empty'}, question = '<input class="math-input" id="e-f1" data-answer="42">',
  labels = [], variants = [], pool = null, mode = 'equivalent', partial = false, graphical = false, rootId = 'e'} = {}) {
  question = question.replaceAll('id="e-', 'id="' + rootId + '-');
  const html = '<div class="math-exercise-cell" id="' + rootId + '" data-label="task" data-ctm-id="task" data-ctm-source="0123456789abcdef"'
    + ' data-mode="' + mode + '" data-fields="[]" data-field-labels="' + esc(JSON.stringify(labels)) + '"'
    + ' data-storage-variants="' + esc(JSON.stringify(variants)) + '" data-partial-credit="' + partial + '"'
    + (pool ? ' data-pool="' + esc(JSON.stringify(pool)) + '"' : '')
    + (graphical ? ' data-response="jsxgraph:board"' : '') + '>'
    + '<div class="math-exercise-question">' + question + '</div>'
    + (pool ? '<button class="math-pool-reload"></button>' : '')
    + '<button class="math-check-btn"></button><button class="math-legend-btn"></button>'
    + '<div class="math-legend-panel"></div><div class="math-feedback-area"></div></div>';
  const dom = new JSDOM(html, {url: 'https://example.invalid/tasks', runScripts: 'outside-only'});
  const w = dom.window;
  w.document.addEventListener = () => {}; // Exercise setup is explicit; never start CDN preloading.
  w.__mathExerciseTestMode = true;
  w.CTMLocales = {table: component => component === 'ui' ? ui : math};
  w.confirm = () => false;
  w.Math.random = () => 0;
  let registration, changes = 0, runtimeCalls = 0, verdict = {status: 'correct', score: 1};
  const events = [], copies = [];
  w.CTMCopy = {text: (text, options) => {copies.push({text, options});}};
  // Only the shared-store boundary is mocked: revision matching is tested in
  // ctm-libs; this suite verifies the adapter writes solely when asked to.
  w.CTMStore = {register(options) {
    registration = options;
    return {restore() {
      if (meta.state === 'restored') options.write(meta.record.inputs, meta);
      return meta;
    }, changed() { changes++; }, result(value) { events.push(plain(value)); }, clear() { options.clear(); }};
  }};
  const py = {loadPackage: async () => {}};
  w.MathExerciseRuntime = {ensurePyodide: async () => {runtimeCalls++; return py;},
    ensureGuard: async () => {}, ensureCheckers: async () => {}, stopCount: () => 0,
    whenSlow: () => () => {}, callCheckers: async () => JSON.stringify(verdict)};
  w.eval(source('matrix-input.js'));
  w.eval(source('math-store.js'));
  w.eval(source('math-exercise.js'));
  const cell = w.document.getElementById(rootId);
  w.__mathExerciseTestApi.setupCell(cell);
  return {dom, w, cell, get registration() {return registration;}, get changes() {return changes;},
    get runtimeCalls() {return runtimeCalls;}, events, copies, verdict(value) {verdict = value;},
    field() {return cell.querySelector('input.math-input');}};
}
async function check(p) {
  const button = p.cell.querySelector('.math-check-btn');
  button.click();
  for (let i = 0; i < 30 && button.disabled; i++) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(button.disabled, false, p.cell.textContent);
}

test('matching saved fields restore without Python, checks or fresh result events', () => {
  const p = page({labels: ['x'], meta: {state: 'restored', outdated: false,
    record: {inputs: {fields: {x: '3/4'}, matrices: {}}, result: {at: '2026-10-20T10:30:12Z', status: 'partial', score: .5}}}});
  assert.equal(p.field().value, '3/4');
  assert.equal(p.runtimeCalls, 0);
  assert.deepEqual(p.events, []);
  assert.match(p.cell.querySelector('.math-saved-result').textContent, /Partial \(50%\)/);
  assert.equal(p.field().classList.contains('math-input-partial'), false);
  assert.deepEqual(plain(p.registration.read()).fields, {x: '3/4'});
  p.field().value = 'edited';
  p.field().dispatchEvent(new p.w.Event('input', {bubbles: true}));
  assert.match(p.cell.querySelector('.math-saved-result').textContent, /Partial \(50%\).*Outdated/);
  assert.equal(p.runtimeCalls, 0);
  p.dom.window.close();
});

test('changed and withdrawn answers stay read-only, with empty current fields', () => {
  for (const state of ['changed', 'withdrawn']) {
    const p = page({meta: {state, outdated: true, record: {
      inputs: {fields: {old: '<script>old answer</script>'}}, result: {at: '2026-10-20', status: 'wrong', score: 0}}}});
    assert.equal(p.field().value, '');
    assert.match(p.cell.querySelector('.math-saved-answer pre').textContent, /<script>old answer<\/script>/);
    assert.equal(p.cell.querySelector('.math-saved-answer script'), null);
    assert.equal(p.cell.querySelector('.math-saved-answer input'), null);
    assert.match(p.cell.querySelector('.math-saved-result').textContent, /Outdated/);
    assert.equal(p.runtimeCalls, 0);
    assert.deepEqual(p.events, []);
    p.dom.window.close();
  }
});

test('a saved deployed hash selects its variant before filling the fields', () => {
  const variants = [{n: 1, id: 'a', hash: 'a'.repeat(16)}, {n: 2, id: 'b', hash: 'b'.repeat(16)}];
  const p = page({variants, pool: ['First _[1]', 'Second _[2]'], labels: ['x'],
    meta: {state: 'restored', variant: variants[1], record: {inputs: {fields: {x: '2'}, matrices: {}}}}});
  assert.match(p.cell.querySelector('.math-exercise-question').textContent, /Second/);
  assert.equal(p.field().value, '2');
  assert.deepEqual(plain(p.registration.variant()), variants[1]);
  // A learner must confirm replacing filled fields. Cancelling preserves them.
  p.cell.querySelector('.math-pool-reload').click();
  assert.equal(p.field().value, '2');
  assert.equal(p.runtimeCalls, 0);
  p.dom.window.close();
});

test('duplicate field labels fall back to distinct ids instead of losing responses', () => {
  const p = page({labels: ['x', 'x'], question: '<input class="math-input" id="e-f1"><input class="math-input" id="e-f2">'});
  const fields = p.cell.querySelectorAll('input');
  fields[0].value = 'one'; fields[1].value = 'two';
  assert.deepEqual(plain(p.registration.read()).fields, {f1: 'one', f2: 'two'});
  p.dom.window.close();
});

test('matrix sizes and field values restore together through the real editor', () => {
  const values = {'e-dm-A-1-1': '1', 'e-dm-A-1-2': '2', 'e-dm-A-2-1': '3', 'e-dm-A-2-2': '4'};
  const p = page({mode: 'custom', variants: [{n: 1, id: 'a', hash: 'a'.repeat(16)}],
    pool: ['mat{name=A, rows=auto, cols=auto, initial-rows=1, initial-cols=1, min-rows=0, min-cols=0, max-rows=3, max-cols=3}'],
    meta: {state: 'restored', record: {inputs: {fields: values, matrices: {A: {rows: 2, cols: 2}}}}}});
  const editor = p.cell.querySelector('.math-dynamic-matrix-wrap').matrixInput;
  assert.deepEqual(plain(editor.read()).raw, ['1', '2', '3', '4']);
  assert.equal(editor.read().rows, 2);
  assert.equal(editor.read().cols, 2);
  assert.equal(p.runtimeCalls, 0);
  assert.equal(p.changes, 0, 'programmatic restore must not schedule another save');
  assert.equal(p.registration.exportItem().parts[0].text, '[[1, 2], [3, 4]]');
  p.dom.window.close();
});

test('a new check publishes the actual result; editing requests a shared save', async () => {
  const p = page({labels: ['x']});
  p.field().value = '42';
  await check(p);
  assert.deepEqual(p.events.at(-1), {status: 'correct', score: 1});
  p.verdict({status: 'wrong', score: 0});
  await check(p);
  assert.deepEqual(p.events.at(-1), {status: 'wrong', score: 0});
  p.field().value = '';
  await check(p);
  assert.deepEqual(p.events.at(-1), {status: 'invalid', score: 0}, 'empty input is not an attempt');
  p.field().dispatchEvent(new p.w.Event('input', {bubbles: true}));
  assert.ok(p.changes > 0);
  p.dom.window.close();
});

test('export exposes typed answers only, and graphical responses do not opt into saving', () => {
  const p = page({labels: ['x']});
  p.field().value = '<typed> 3/4';
  assert.deepEqual(plain(p.registration.exportItem()), {title: 'task', parts: [{kind: 'answer', label: 'x', text: '<typed> 3/4'}]});
  p.dom.window.close();
  const graphical = page({graphical: true});
  assert.equal(graphical.registration.save, false);
  assert.equal(graphical.registration.read(), null);
  graphical.dom.window.close();
});

test('copy uses the shared helper with visible, exercise-specific labeling and no check', () => {
  const p = page({labels: ['x']});
  p.field().value = '3/4';
  const copy = p.cell.querySelector('.math-copy-answer');
  assert.equal(copy.textContent, 'Copy answer');
  assert.equal(copy.getAttribute('aria-label'), 'Copy the answer in exercise task');
  copy.click();
  assert.deepEqual(plain(p.copies), [{text: 'x: 3/4', options: {label: 'Copy the answer in exercise task'}}]);
  assert.equal(p.runtimeCalls, 0);
  p.dom.window.close();
});

test('unlabelled field keys survive a preceding exercise changing generated DOM prefixes', () => {
  const first=page({question:'<input class="math-input" id="e-f1"><input class="math-input" id="e-f2">'});
  const inputs=first.cell.querySelectorAll('input');
  inputs[0].value='first';inputs[1].value='second';
  const saved=plain(first.registration.read());
  assert.deepEqual(saved.fields,{f1:'first',f2:'second'});
  first.dom.window.close();
  const later=page({rootId:'math-exercise-27',question:'<input class="math-input" id="e-f1"><input class="math-input" id="e-f2">'});
  later.registration.write(saved,{});
  assert.deepEqual([...later.cell.querySelectorAll('input')].map(x=>x.value),['first','second']);
  assert.deepEqual(plain(later.registration.read()),saved);
  assert.equal(later.runtimeCalls,0);
  later.dom.window.close();
});
test('configured labels cannot collide with exercise-relative fallback keys', () => {
  const p=page({labels:['f2',''],question:'<input class="math-input" id="e-f1"><input class="math-input" id="e-f2">'});
  const fields=p.cell.querySelectorAll('input');fields[0].value='named';fields[1].value='unnamed';
  assert.deepEqual(plain(p.registration.read()).fields,{f2:'named','@field:f2':'unnamed'});
  p.dom.window.close();
});

test('dynamic matrix cell keys restore after the exercise gets a different page ordinal', () => {
  const values={'dm-A-1-1':'1','dm-A-1-2':'2','dm-A-2-1':'3','dm-A-2-2':'4'};
  const p=page({rootId:'math-exercise-27',mode:'custom',variants:[{n:1,id:'a',hash:'a'.repeat(16)}],
    pool:['mat{name=A, rows=auto, cols=auto, initial-rows=1, initial-cols=1, min-rows=0, min-cols=0, max-rows=3, max-cols=3}'],
    meta:{state:'restored',record:{inputs:{fields:values,matrices:{A:{rows:2,cols:2}}}}}});
  assert.deepEqual(plain(p.cell.querySelector('.math-dynamic-matrix-wrap').matrixInput.read()).raw,['1','2','3','4']);
  assert.deepEqual(plain(p.registration.read()).fields,values);
  assert.equal(p.runtimeCalls,0);
  p.dom.window.close();
});

test('forget removes only saved history and preserves current answers and feedback', () => {
  for (const state of ['restored', 'changed', 'withdrawn']) {
    const p = page({labels: ['x'], meta: {state, outdated: state !== 'restored',
      record: {inputs: {fields: {x: 'saved answer'}, matrices: {}},
        result: {at: '2026-10-20', status: 'partial', score: .5}}}});
    p.field().value = 'live answer';
    const feedback = p.cell.querySelector('.math-feedback-area');
    feedback.textContent = 'keep current feedback and output';
    const sibling = p.w.document.createElement('div');
    sibling.className = 'math-saved-result'; sibling.textContent = 'another exercise history';
    p.w.document.body.append(sibling);
    assert.notEqual(p.cell.querySelector('.math-saved-result').textContent, '');
    p.registration.forget(); p.registration.forget();
    assert.equal(p.field().value, 'live answer');
    assert.equal(feedback.textContent, 'keep current feedback and output');
    assert.equal(p.cell.querySelector('.math-saved-answer').textContent, '');
    assert.equal(p.cell.querySelector('.math-saved-result').textContent, '');
    assert.equal(sibling.textContent, 'another exercise history');
    assert.equal(p.changes, 0);
    assert.equal(p.runtimeCalls, 0);
    assert.deepEqual(p.events, []);
    p.dom.window.close();
  }
});

test('explicit clear resets current fields and removes saved history without scheduling a save', () => {
  const p = page({labels: ['x'], meta: {state: 'changed', outdated: true,
    record: {inputs: {fields: {x: 'old answer'}}, result: {at: '2026-10-20', status: 'wrong', score: 0}}}});
  p.field().value = 'live answer';
  assert.ok(p.cell.querySelector('.math-saved-answer pre'));
  p.registration.clear();
  assert.equal(p.field().value, '');
  assert.equal(p.cell.querySelector('.math-saved-answer').textContent, '');
  assert.equal(p.cell.querySelector('.math-saved-result').textContent, '');
  assert.equal(p.changes, 0);
  assert.equal(p.runtimeCalls, 0);
  p.dom.window.close();
});
