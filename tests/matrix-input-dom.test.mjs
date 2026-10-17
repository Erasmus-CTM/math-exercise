import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../_extensions/math-exercise/matrix-input.js', import.meta.url), 'utf8');
const spec = {name:'A',rows:{auto:true,initial:2,min:1,max:3},cols:{auto:true,initial:2,min:1,max:3}};
function editor() {
  const dom = new JSDOM('<body></body>', {runScripts:'outside-only'});
  dom.window.eval(source);
  const events=[];
  const renderer=dom.window.MatrixInput.create({idPrefix:'answer',onChange:event=>events.push(event)});
  dom.window.document.body.innerHTML=renderer.renderHTML(spec).html;
  const wrap=dom.window.document.body.firstElementChild;
  return {dom,wrap,events,renderer,api:renderer.mount(wrap)};
}

test('raw expressions survive writes and resizing, with explicit change notifications', () => {
  const {api,events,wrap,dom}=editor();
  api.write({rows:2,cols:2,raw:[' x+x ','0.1','1/2','']});
  assert.deepEqual(Array.from(api.read().raw),[' x+x ','0.1','1/2','']);
  assert.deepEqual(events.map(e=>e.kind),['write']);
  api.setState({status:'correct',cells:[['invalid']]});
  assert.equal(wrap.querySelector('input').getAttribute('aria-invalid'),'true');
  api.resize(3,2);
  assert.deepEqual(Array.from(api.read().raw),[' x+x ','0.1','1/2','','','']);
  assert.equal(wrap.querySelector('.math-input-ok'),null);
  assert.equal(wrap.querySelector('[aria-invalid]'),null);
  const input=wrap.querySelector('input'); input.value='1/3';
  input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(events.at(-1).kind,'edit');
  api.reset();
  assert.equal(api.read().rows,2);
  assert.deepEqual(Array.from(api.read().raw),['','','','']);
});

test('bounds protect writes and resizing and destroy removes listeners', () => {
  const {api,wrap,events,dom}=editor();
  assert.throws(()=>api.resize(0,2),/outside bounds/);
  assert.throws(()=>api.write({rows:2,cols:2,raw:['ragged']}),/rectangular/);
  api.setState({status:'correct'});
  assert.throws(()=>api.setState({cells:[['invalid','invalid','invalid']]}),/coordinates/);
  assert.equal(wrap.querySelectorAll('.math-input-ok').length,4);
  assert.throws(()=>api.write({rows:4,cols:1,raw:['x','x','x','x']}),/outside bounds/);
  assert.equal(api.read().rows,2);
  assert.equal(wrap.querySelectorAll('.math-input-ok').length,4);
  api.destroy(); api.destroy();
  wrap.querySelector('input').dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  wrap.querySelector('[data-dynamic-action="add-row"]').click();
  assert.equal(events.length,0);
  assert.throws(()=>api.read(),/destroyed/);
});

test('fixed axis controls cannot resize and localization is supplied by consumer', () => {
  const {dom,renderer}=editor();
  const fixed={name:'B',rows:{auto:false,initial:2,min:2,max:2},cols:{auto:true,initial:1,min:1,max:3}};
  const holder=dom.window.document.createElement('div');
  holder.innerHTML=renderer.renderHTML(fixed).html;
  const api=renderer.mount(holder.firstElementChild);
  assert.throws(()=>api.resize(3,1),/outside bounds/);
  assert.equal(holder.querySelector('[data-dynamic-action="add-row"]').disabled,true);
  assert.equal(holder.querySelector('[data-dynamic-axis="row"]').style.display,'none');
});

test('canonical zero-only axes disable restoration controls for either orientation', () => {
  const {dom}=editor();
  for (const zeroAxis of ['rows','cols']) {
    for (const auto of [true,false]) {
      const renderer=dom.window.MatrixInput.create({zeroDimensions:'canonical'});
      const zero={auto,initial:0,min:0,max:0};
      const flexible={auto:true,initial:0,min:0,max:3};
      const spec={name:'Z',rows:zeroAxis==='rows'?zero:flexible,cols:zeroAxis==='cols'?zero:flexible};
      const holder=dom.window.document.createElement('div');
      holder.innerHTML=renderer.renderHTML(spec).html;
      const api=renderer.mount(holder.firstElementChild);
      const add=holder.querySelector('[data-dynamic-action="'+(zeroAxis==='rows'?'add-col':'add-row')+'"]');
      assert.equal(add.disabled,true);
      assert.doesNotThrow(()=>add.click());
      assert.equal(api.read().rows,0);
      assert.equal(api.read().cols,0);
    }
  }
});
