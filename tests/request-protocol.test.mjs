// The request protocol (ctm-checkers docs/api.md; step-2 design §2.2): each
// check sends one request, `_ctm_request` (JSON), through ctm-libs'
// MathExerciseRuntime.callCheckers, with the values math-exercise 0.10 set as
// `_math_*` globals, under their names without `_math_`: strings as set,
// partial_credit a boolean, form_credit the cell's finite number, the custom
// response as the object 0.10 sent as JSON text.
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPage } from './helpers/ai-context.mjs';
import { ANY_CHECK, CHECK, CHECK_CUSTOM } from './helpers/ctm-checkers.mjs';

// A runtime that records each request and the call text that used it.
function recordingRuntime(result = { status: 'correct', score: 1 }) {
  const requests = [];
  let pending = null;
  return {
    requests,
    loadPackage: async () => {},
    globals: { set: async (name, value) => { if (name === '_ctm_request') pending = value; } },
    runPythonAsync: async code => {
      if (!code.includes(ANY_CHECK)) return undefined;
      requests.push({ call: code.includes(CHECK_CUSTOM) ? 'check_custom' : code.includes(CHECK) ? 'check' : 'other', text: pending });
      return JSON.stringify(result);
    },
  };
}

test('a typed answer: every value of 0.10\'s globals, with their types', async () => {
  const p = loadPage('');
  const py = recordingRuntime();
  p.window.mainPyodide = py;
  const field = { value: ' 5.395 ', dataset: { answer: '5.40', vars: 'x y' } };
  const result = await p.api.checkField(field, 'numeric', { reject: 'x', tolerance: '', decplaces: '2', sigfigs: '', form: '',
    partialCredit: true, formCredit: 0.25 });
  assert.deepEqual({ ...result }, { status: 'correct', score: 1 });   // an object of the page's realm
  assert.equal(py.requests.length, 1);
  assert.equal(py.requests[0].call, 'check');
  assert.deepEqual(JSON.parse(py.requests[0].text), { student: '5.395', correct: '5.40', vars: 'x y', mode: 'numeric', reject: 'x',
    tolerance: '', decplaces: '2', sigfigs: '', form: '', partial_credit: true, form_credit: 0.25 });
  // Defaults, as 0.10 set them: empty strings, equivalent mode, no partial credit.
  await p.api.checkField({ value: 'x', dataset: {} }, '', {});
  assert.deepEqual(JSON.parse(py.requests[1].text), { student: 'x', correct: '', vars: '', mode: 'equivalent', reject: '',
    tolerance: '', decplaces: '', sigfigs: '', form: '', partial_credit: false, form_credit: 0.5 });
  // An integral form credit arrives as an integer (as Pyodide converted 0.10's
  // number); one that is not a number, or outside [0, 1], is the default (the cell's rule).
  await p.api.checkField({ value: 'x', dataset: { answer: 'x' } }, 'exact', { partialCredit: true, formCredit: 1 });
  assert.equal(py.requests[2].text.match(/"form_credit":([^,}]*)/)[1], '1');
  await p.api.checkField({ value: 'x', dataset: { answer: 'x' } }, 'exact', { partialCredit: true, formCredit: 'half' });
  assert.equal(JSON.parse(py.requests[3].text).form_credit, 0.5);
  await p.api.checkField({ value: 'x', dataset: { answer: 'x' } }, 'exact', { partialCredit: true, formCredit: 2 });
  assert.equal(JSON.parse(py.requests[4].text).form_credit, 0.5);
  p.dom.window.close();
});

test('a custom checker: the response as an object, the variables and the checker', async () => {
  const checker = 'def check(response, symbols):\n    return True\n';
  const html = `<div id="cell" class="math-exercise-cell" data-label="cell" data-context-mode="none" data-mode="custom" data-vars="x"
    data-checker='${JSON.stringify(checker)}'><div class="math-exercise-question"></div><button class="math-check-btn">Check</button>
    <button class="math-legend-btn">Help</button><div class="math-legend-panel" style="display:none"></div><div class="math-feedback-area"></div></div>`;
  const p = loadPage(html, { lang: 'en' });
  const py = recordingRuntime({ status: 'correct', score: 1, show_score: true, feedback: '', assessment: {} });
  p.window.mainPyodide = py;
  const cell = p.document.querySelector('#cell');
  const rendered = p.api.renderTaskText('Expression: _[] and _[]', 'cell', 'x', 'col', 'custom');
  p.api.setQuestionContent(cell.querySelector('.math-exercise-question'), rendered);
  cell.dataset.fields = JSON.stringify(rendered.fieldIds);
  p.api.setupCell(cell);
  const inputs = cell.querySelectorAll('.math-input');
  inputs[0].value = 'x+1';
  inputs[1].value = '2*x';
  cell.querySelector('.math-check-btn').click();
  for (let i = 0; i < 400 && !py.requests.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(py.requests.length, 1);
  assert.equal(py.requests[0].call, 'check_custom');
  const request = JSON.parse(py.requests[0].text);
  assert.deepEqual(Object.keys(request), ['response', 'vars', 'checker']);
  assert.equal(request.vars, 'x');
  assert.equal(request.checker, checker);
  assert.deepEqual(request.response.raw, ['x+1', '2*x']);
  assert.equal(request.response.kind, 'expressions');
  p.dom.window.close();
});
