import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPage, typesetMathJax, typesetKatex, requestFeedback } from './helpers/ai-context.mjs';

const formulas = [
  String.raw`\frac{N}{l}`,
  String.raw`10^{-7}`,
  String.raw`\frac{4\pi\mu_0 N^2a^2}{l}`,
  String.raw`\dot I_1=-4\dot I_2`,
  String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`,
  String.raw`\begin{aligned}F&=ma\\E&=mc^2\end{aligned}`,
];

for (const version of [3, 4]) {
  for (const output of ['chtml', 'svg']) {
    for (const display of [false, true]) {
      test(`MathJax ${version} ${output}, ${display ? 'display' : 'inline'}: recover complete original expressions once`, () => {
        const page = loadPage('<div id="ctx" class="math-exercise-context"></div>');
        const root = page.document.getElementById('ctx');
        root.textContent = formulas.map(tex => (display ? '\\[' : '\\(') + tex + (display ? '\\]' : '\\)')).join(' ');
        const before = page.api.contextText(root);
        typesetMathJax(page, version, output);
        assert.equal(root.querySelectorAll('mjx-container').length, formulas.length);
        assert.equal(page.api.contextText(root), before);
        assert.deepEqual(page.warnings, []);
        page.dom.window.close();
      });
    }
  }
}

for (const display of [false, true]) {
  test(`KaTeX ${display ? 'display' : 'inline'}: use annotation once and preserve display delimiters`, () => {
    const page = loadPage('<div id="ctx"></div>');
    const root = page.document.getElementById('ctx');
    for (const tex of formulas) {
      typesetKatex(root, tex, display);
      assert.equal(page.api.contextText(root), (display ? '\\[' : '\\(') + tex + (display ? '\\]' : '\\)'));
    }
    page.dom.window.close();
  });
}

for (const output of ['chtml', 'svg']) test(`MathJax 4 ${output} data-latex fallback works without the runtime`, () => {
  const page = loadPage('<div id="ctx">\\(\\frac{N}{l}\\)</div>');
  typesetMathJax(page, 4, output);
  delete page.window.MathJax;
  assert.equal(page.api.contextText(page.document.getElementById('ctx')), String.raw`\(\frac{N}{l}\)`);
  page.dom.window.close();
});

test('unknown rendered mathematics is flagged rather than flattened to misleading glyphs', () => {
  const page = loadPage('<div id="ctx"><mjx-container><mjx-math><mjx-mi data-latex="N">N</mjx-mi><mjx-mi>l</mjx-mi></mjx-math></mjx-container></div>');
  assert.equal(page.api.contextText(page.document.getElementById('ctx')), '[Mathematical source unavailable]');
  assert.equal(page.warnings.length, 1);
  page.dom.window.close();
});

test('source metadata wins over visual/accessibility duplicates and retains TeX whitespace', () => {
  const page = loadPage('<div id="ctx"><span></span></div>');
  const root = page.document.getElementById('ctx');
  const math = root.firstChild;
  const tex = '\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}';
  math.dataset.mathExerciseTex = tex;
  math.dataset.mathExerciseDisplay = 'true';
  math.innerHTML = '<span>bad glyphs</span><span aria-hidden="true">duplicate</span>';
  assert.equal(page.api.contextText(root), '\\[' + tex + '\\]');
  page.dom.window.close();
});

test('context keeps prose/list boundaries and excludes controls, feedback and hidden content', () => {
  const page = loadPage(`<div id="ctx" class="math-exercise-context">
    <p>First paragraph.</p><p>Second paragraph.</p><ul><li>One</li><li>Two</li></ul>
    <script>secret-script</script><style>.secret-style {}</style>
    <button>secret-button</button><input value="secret-value"><textarea>secret-input</textarea>
    <div hidden>secret-hidden</div><div aria-hidden="true">secret-aria</div>
    <div style="display:none">secret-display</div><div style="visibility:hidden">secret-visibility</div>
    <div class="math-exercise-cell">secret-exercise</div><div class="math-feedback-area">secret-feedback</div>
  </div>`);
  const result = page.api.contextText(page.document.getElementById('ctx'));
  assert.match(result, /First paragraph\.\nSecond paragraph\./);
  assert.match(result, /- One\n- Two/);
  assert.doesNotMatch(result, /secret/);
  page.dom.window.close();
});

test('explicit references work across nested inactive tabs and read current prose', () => {
  const page = loadPage(`<div class="tab-pane" style="display:none"><div class="tab-pane" style="display:none">
    <div id="ctx" class="math-exercise-context"><p>Original</p><span data-math-exercise-tex="x^2">bad glyphs</span></div>
    </div></div><div id="cell" data-context-mode="explicit" data-context-refs="ctx, ctx, missing, wrong"></div><div id="wrong"></div>`);
  const cell = page.document.getElementById('cell');
  let contexts = page.api.resolveContexts(cell);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].text, 'Original\n\\(x^2\\)');
  page.document.querySelector('#ctx p').textContent = 'Updated';
  contexts = page.api.resolveContexts(cell);
  assert.match(contexts[0].text, /Updated/);
  page.dom.window.close();
});

test('none opts out, auto uses its own source, and explicit budget omits whole blocks', () => {
  const page = loadPage('<div id="cell"></div><div id="big" class="math-exercise-context"></div><div id="small" class="math-exercise-context">Small \\(x^2\\)</div>');
  const cell = page.document.getElementById('cell');
  cell.dataset.context = JSON.stringify(String.raw`Auto \(\frac{1}{2}\)`);
  assert.equal(page.api.resolveContexts(cell)[0].text, String.raw`Auto \(\frac{1}{2}\)`);
  cell.dataset.contextMode = 'none';
  assert.equal(page.api.resolveContexts(cell).length, 0);
  cell.dataset.contextMode = 'explicit';
  cell.dataset.contextRefs = 'big, small';
  page.document.getElementById('big').textContent = '\\(' + 'x+'.repeat(3001) + '1\\)';
  const contexts = page.api.resolveContexts(cell);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].id, 'small');
  assert.equal(contexts[0].text, String.raw`Small \(x^2\)`);
  page.dom.window.close();
});

test('question fallback recovers MathJax on live nodes and labels fields without copying answers', () => {
  const page = loadPage('<div id="cell"><div class="math-exercise-caption">Find \\(N/l\\)</div><div class="math-exercise-question">\\(\\frac{N}{l}\\) = <input id="f1" data-answer="SECRET" value="student"></div></div>');
  typesetMathJax(page, 3, 'svg');
  const text = page.api.questionText(page.document.getElementById('cell'), ['f1'], () => 'Density');
  assert.equal(text, String.raw`Find \(N/l\)` + '\n' + String.raw`\(\frac{N}{l}\) = [Density]`);
  assert.doesNotMatch(text, /SECRET|student/);
  page.dom.window.close();
});

test('pool reload refreshes preserved source, labels and the actual outgoing request', async () => {
  const page = loadPage('<div id="cell" data-context-mode="none"><div class="math-exercise-question"></div></div>');
  const cell = page.document.getElementById('cell');
  const q = cell.firstChild;
  for (const [tex, answer] of [[formulas[0], 'SECRET_A'], [formulas[2], 'SECRET_B']]) {
    const rendered = page.api.renderTaskText(`Compute $${tex}$: _[${answer}]`, 'pool', '', 'col');
    page.api.setQuestionContent(q, rendered);
    cell.dataset.fields = JSON.stringify(rendered.fieldIds);
    assert.doesNotMatch(q.dataset.mathExerciseSource, /SECRET|data-answer/);
    q.innerHTML = '<span>typesetter replaced the question</span>';
    const payload = await requestFeedback(page, cell, ['Result']);
    assert.ok(payload.includes('\\(' + tex + '\\)'));
    assert.ok(payload.includes('[Result]'));
    assert.doesNotMatch(payload, /SECRET|typesetter replaced/);
  }
  assert.equal(page.requests.length, 2);
  assert.ok(!page.requests[1].body.messages[1].content.includes('\\(' + formulas[0] + '\\)'));
  page.dom.window.close();
});

test('named dynamic matrices stay placeholders and static matrix fields keep labels', () => {
  const page = loadPage('<div id="cell"><div class="math-exercise-question"></div></div>');
  const cell = page.document.getElementById('cell');
  const rendered = page.api.renderTaskText('mat{name=A, rows=2, cols=auto} mat[SECRET1,SECRET2;SECRET3,SECRET4]', 'm', '', 'col', 'custom');
  page.api.setQuestionContent(cell.firstChild, rendered);
  const result = page.api.questionText(cell, Array.from(rendered.fieldIds), i => page.api.localizeStructuralLabel(rendered.structuralLabels[i]));
  assert.match(result, /\[Matrix A\]/);
  assert.match(result, /\[Row 1, column 1\]/);
  assert.match(result, /\[Row 2, column 2\]/);
  assert.doesNotMatch(result, /SECRET|Add row|Remove/);
  page.dom.window.close();
});
