import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPage } from './helpers/ai-context.mjs';

test('duplicate matrix names from separately rendered question fragments fail before mounting', () => {
  const p = loadPage('<main></main>');
  const root = p.document.querySelector('main');
  const marker = 'mat{name=A,rows=2,cols=auto,initial-cols=1,max-cols=3}';
  root.innerHTML = p.api.renderTaskText(marker,'first','','col','custom').html
    + p.api.renderTaskText(marker,'second','','col','custom').html;
  assert.throws(() => p.api.initializeDynamicMatrices(root,'question',''), /duplicate dynamic matrix name A/);
  root.querySelectorAll('.math-dynamic-matrix-wrap').forEach(wrap => assert.equal(wrap.matrixInput,undefined));
  p.window.close();
});

test('legacy checker assessment tolerates extra and malformed axis arrays on smaller responses', () => {
  const p = loadPage('<main></main>');
  const root = p.document.querySelector('main');
  root.innerHTML = p.api.renderTaskText('mat{name=A,rows=2,cols=auto,initial-cols=1,max-cols=3}','question','','col','custom').html;
  p.api.initializeDynamicMatrices(root,'question','');
  assert.doesNotThrow(() => p.api.applyCustomAssessment(root,{status:'partial',assessment:{A:{rows:'ignored',columns:['correct','incorrect','dependent']}}}));
  assert.equal(root.querySelectorAll('.math-input-ok').length,2);
  assert.doesNotThrow(() => p.api.applyCustomAssessment(root,{status:'partial',assessment:{A:{rows:['incorrect','correct','invalid'],columns:{0:'correct'}}}}));
  assert.equal(root.querySelectorAll('.math-input-wrong').length,1);
  assert.equal(root.querySelectorAll('.math-input-ok').length,1);
  root.firstElementChild.matrixInput.resize(0,0);
  assert.doesNotThrow(() => p.api.applyCustomAssessment(root,{status:'partial',assessment:{A:{rows:['correct'],columns:['correct']}}}));
  p.window.close();
});
