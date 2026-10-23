// Actual component DOM/store/transport; the grader boundary is explicitly a
// stub. One bounded captured-packet test calls the canonical installed native
// wheel; this does not claim Pyodide bootstrap or browser-engine acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {JSDOM} from 'jsdom';
import {ctmLibs} from './helpers/ctm-libs.mjs';
import {pythonEnv} from './helpers/ctm-checkers.mjs';
const own=name=>readFileSync(new URL('../_extensions/math-exercise/'+name,import.meta.url),'utf8');
const lib=name=>readFileSync(join(ctmLibs,name),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const codec=spawnSync(process.env.QUARTO_PYTHON||'python3',['-c',`import json
from sympy import Rational, Symbol
from ctm_checkers.variants import question_context
rows=[]
for n,key in [(2,'a'),(7,'b'),(31,'a'),(None,'c')]:
 identity=None if n is None else {'n':n,'id':'id-'+str(n),'hash':key*16}
 rows.append(question_context(['Answer'],{'a':Rational(1,3),'x':Symbol('x',positive=True)},{'Answer':Rational(2,3)},identity))
rows.append(question_context(['u','v'],{'a':Rational(1,3)},{'u':Rational(1,3),'v':Rational(2,3)},{'n':2,'id':'vector-two','hash':'d'*16}))
print(json.dumps(rows))`],{env:pythonEnv,encoding:'utf8'});
assert.equal(codec.status,0,codec.stderr);
const contexts=JSON.parse(codec.stdout);
const record=(index=0)=>{const context=plain(contexts[index]),identity=context.variant;
 return {id:identity?.id||'proposal-one',hash:identity?.hash||'c'.repeat(16),n:identity?.n??null,
 proposal:!identity,status:identity?'approved':'undecided',context,
 question:'**Find** the value <b>literal</b>: _[2/3]',solution:'<p>Teacher solution</p>',checker:'def check(response, symbols): return True',
 'variant-context':'Authored context only'};};
function cell(records,{id='cell',label='q',mode='custom',initial,legacy=false,pool=false}={}) {
 const generated={native:!legacy,version:1,variants:records,approval:'required'};
 const descriptors=records.map(({n,id,hash,proposal})=>({n,id,hash,proposal}));
 const tasks=records.map(r=>r.question);
 return `<div id="${id}" class="math-exercise-cell" data-ctm-source="source123" data-ctm-id="${label}" data-label="${label}" data-mode="${mode}" data-vars="x" data-fields="[]" data-field-labels="${esc(JSON.stringify(records[0].context?.fields||['Answer']))}" data-storage-variants="${esc(JSON.stringify(descriptors))}" data-pool="${esc(JSON.stringify(tasks))}" ${pool?'':`data-variants="${esc(JSON.stringify(generated))}"`} ${initial?`data-initial-values="${esc(JSON.stringify([initial]))}"`:''}>
 <div class="math-exercise-question"></div><button class="math-pool-reload"></button><button class="math-check-btn"></button><button class="math-legend-btn"></button><div class="math-legend-panel" style="display:none"></div><div class="math-feedback-area"></div></div>`;
}
function page({records=[record(),record(1)],local={},session={},query='?variant=q:2',lang='en',initial,disabled=false,automatic=false,missingChooser=false,extra='',pool=false,legacy=false,feedback=false,boards=false,review=false}={}) {
 const dom=new JSDOM('<script id="ctm-store-manifest" type="application/json">'+JSON.stringify({course:'course',exercises:[{id:'q',component:'math-exercise'},{id:'ordinary',component:'math-exercise'}]})+'</script>'+cell(records,{initial,pool,legacy})+extra,
 {url:'https://example.test/lesson.html'+query,runScripts:'outside-only'});
 const w=dom.window;w.TextEncoder=TextEncoder;let feedbackOptions;
 if(feedback){w.document.getElementById('cell').insertAdjacentHTML('beforeend','<button class="math-feedback-btn"></button>');w.AIFeedback={questionText:cell=>cell.querySelector('.math-exercise-question').textContent,contextMaterials:()=>[],attach(options){feedbackOptions=options;return {reset(){},cancel(){}};}};}
 for(const[k,v]of Object.entries(local))w.localStorage.setItem(k,v);
 for(const[k,v]of Object.entries(session))w.sessionStorage.setItem(k,v);
 const original=w.document.addEventListener.bind(w.document);let ready;
 w.document.addEventListener=(type,fn,options)=>type==='DOMContentLoaded'?ready=fn:original(type,fn,options);
 w.__mathExerciseTestMode=true;w.__mathExerciseConfig={lang};
 const errors=[];w.console.error=(...args)=>errors.push(args);
 w.CTMLayout={ready(){}};w.CTMAssets={url(){throw new Error('Intentional renderer-unavailable control');}};
 for(const path of ['locales/ctm-locale.js','locales/common.js','locales/ui.js','locales/math-exercise.js','ui/ctm-store.js'])w.eval(lib(path));
 if(!missingChooser)w.eval(lib('ui/variants.js'));
 if(disabled)w.CTMStore.setEnabled(false);
 let runtime=0;const requests=[],tracked=[];const py={loadPackage:async()=>{}};
 w.MathExerciseRuntime={trackInitialUI(p){tracked.push(p);p.catch(()=>{});},ensurePyodide:async()=>{runtime++;return py;},ensureGuard:async()=>{},ensureCheckers:async()=>{},stopCount:()=>0,whenSlow:()=>()=>{},
 callCheckers:async(_py,name,request)=>{requests.push({name,request:plain(request)});return JSON.stringify({status:'correct',score:1});}};
 w.eval(own('matrix-input.js'));w.eval(own('math-store.js'));w.eval(own('math-exercise.js'));
 const element=w.document.getElementById('cell');const boardCalls=[];
 if(review){const payload=JSON.parse(element.dataset.variants);payload.renderMode='review';element.dataset.variants=JSON.stringify(payload);element.insertAdjacentHTML('afterbegin','<p class="math-variant-unapproved">Review warning</p>');}
 if(boards){element.dataset.variantBoards='["figure"]';w.MathExerciseBoards={attach(options){boardCalls.push(plain(options.getVariant()));return {changed(){boardCalls.push(plain(options.getVariant()));}};}};}
 if(!automatic)w.__mathExerciseTestApi.setupCell(element);
 return {w,dom,element,errors,requests,tracked,boardCalls,get runtime(){return runtime;},start:()=>ready(),feedbackRequest:()=>feedbackOptions.getRequest({}),
 field:()=>element.querySelector('input.math-input'),next:()=>element.querySelector('.math-pool-reload').click(),
 local:()=>Object.fromEntries(Object.entries(w.localStorage)),session:()=>Object.fromEntries(Object.entries(w.sessionStorage)),
 stored:()=>JSON.parse(w.localStorage.getItem(w.CTMStore.key('q'))),close:()=>w.close()};
}
async function check(p){const button=p.element.querySelector('.math-check-btn');button.click();
 for(let i=0;i<30&&button.disabled;i++)await new Promise(r=>setTimeout(r,0));assert.equal(button.disabled,false,p.element.textContent);}

test('native Markdown stays text and custom requests carry exact context, never legacy variant fields',async()=>{
 const p=page();assert.equal(p.runtime,0);assert.equal(p.requests.length,0);
 assert.equal(p.element.querySelector('b'),null);assert.equal(p.element.querySelector('strong').textContent,'Find');
 assert.match(p.element.textContent,/<b>literal<\/b>/);
 assert.deepEqual(plain(p.element.mathExercise.getVariant()),contexts[0].variant);
 p.field().value='2/3';await check(p);
 assert.equal(p.requests.length,1);const sent=p.requests[0];assert.equal(sent.name,'math_exercise.check_custom');
 assert.deepEqual(sent.request.question_context,contexts[0]);assert.equal(sent.request.response.variant,undefined);
 assert.deepEqual(sent.request.response.raw,['2/3']);assert.deepEqual(sent.request.response.inputs,{});
 const copy=p.element.mathExercise.getVariant();copy.n=999;
 assert.equal(p.element.mathExercise.getVariant().n,2);
 p.w.AIFeedback={contextMaterials:()=>[]};const materials=p.w.__mathExerciseTestApi.resolveContexts(p.element);
 assert.equal(materials[0].text,'Authored context only');assert.doesNotMatch(materials[0].text,/teacher|Rational/);
 p.close();
});
test('cancel does not advance/persist seen; accepted change clears old grades, announces and focuses',async()=>{
 const p=page({lang:'de'});assert.equal(p.element.querySelector('.math-pool-reload').textContent,'Neue Variante');
 p.field().value='2/3';await check(p);const before=p.local();assert.equal(p.stored().result.status,'correct');
 const accepted=[];p.element.addEventListener('math-exercise:variant-accepted',event=>accepted.push(plain(event.detail)));
 const resets=[];p.w.document.addEventListener('ctm:store-clear',event=>resets.push(plain(event.detail)));
 p.w.confirm=()=>false;p.next();assert.equal(accepted.length,0);assert.equal(resets.length,0);assert.deepEqual(p.local(),before);assert.equal(p.field().value,'2/3');
 p.w.confirm=()=>true;p.next();assert.equal(accepted.length,1);assert.deepEqual(accepted[0],{label:'q',variant:{n:7,id:'id-7',hash:'b'.repeat(16)}});assert.equal(resets.length,1);assert.equal(resets[0].reason,'variant');assert.equal(resets[0].id,'q');assert.equal(p.element.mathExercise.getVariant().n,7);assert.equal(p.field().value,'');
 assert.equal(p.stored().result,undefined);assert.deepEqual(p.stored().seen,[2,7]);
 assert.match(p.element.querySelector('.math-variant-announcement').textContent,/7.*ausgewählt/);
 assert.equal(p.w.document.activeElement,p.element.querySelector('.math-exercise-question'));
 const local=p.local();p.close();const reopened=page({local,query:'?variant=q:2'});
 assert.equal(reopened.element.mathExercise.getVariant().n,7,'saved selection before URL');
 assert.equal(reopened.runtime,0);assert.equal(reopened.requests.length,0);reopened.close();
});
test('choice-only restore preserves authored initial values; an explicitly empty answer remains empty',()=>{
 let p=page({initial:'prefilled'});assert.equal(p.field().value,'prefilled');assert.deepEqual(p.stored().inputs,{});
 let local=p.local();p.close();p=page({initial:'prefilled',local});assert.equal(p.field().value,'prefilled');assert.equal(p.runtime,0);
 p.field().value='';p.field().dispatchEvent(new p.w.Event('input',{bubbles:true}));p.w.dispatchEvent(new p.w.Event('pagehide'));
 local=p.local();p.close();p=page({initial:'prefilled',local});assert.equal(p.field().value,'');assert.equal(p.requests.length,0);p.close();
});
test('changed and withdrawn saved answers remain offered and durable until actual acceptance',()=>{
 for(const withdrawn of [false,true]){
  let p=page();p.field().value='old answer';p.field().dispatchEvent(new p.w.Event('input',{bubbles:true}));p.w.dispatchEvent(new p.w.Event('pagehide'));
  const local=p.local(),old=p.stored(),key=p.w.CTMStore.key('q');p.close();
  const records=withdrawn?[record(1)]:[record(),record(1)];
  if(!withdrawn){records[0].hash='d'.repeat(16);records[0].context.variant.hash=records[0].hash;}
  p=page({local,records});assert.equal(p.field().value,'');assert.match(p.element.querySelector('.math-saved-answer pre').textContent,/old answer/);
  assert.deepEqual(JSON.parse(p.w.localStorage.getItem(key)),old);assert.equal(p.runtime,0);assert.equal(p.requests.length,0);
  p.w.CTMStore.setEnabled(true);assert.deepEqual(p.stored(),old,'enable event must not accept deferred choice');
  const again=p.local();p.close();p=page({local:again,records});assert.match(p.element.querySelector('.math-saved-answer pre').textContent,/old answer/);assert.deepEqual(p.stored(),old);p.close();
 }
});
test('equal-content saved choices restore exact number/id; undecided proposals retain null codec identity',async()=>{
 let p=page({records:[record(),record(2)],query:'?variant=q:31'});p.field().value='saved';p.field().dispatchEvent(new p.w.Event('input',{bubbles:true}));p.w.dispatchEvent(new p.w.Event('pagehide'));
 const local=p.local();p.close();p=page({records:[record(),record(2)],local,query:'?variant=q:2'});
 assert.equal(p.element.mathExercise.getVariant().n,31);assert.equal(p.field().value,'saved');assert.equal(p.runtime,0);p.close();
 p=page({records:[record(3)],query:''});assert.equal(p.element.mathExercise.getVariant(),null);assert.equal(p.stored().variant,null);
 assert.deepEqual(p.stored().proposal,{id:'proposal-one',hash:'c'.repeat(16)});assert.doesNotMatch(p.element.querySelector('.math-variant-number').textContent,/Variant (0|null)/);
 p.field().value='2/3';await check(p);assert.deepEqual(p.requests[0].request.question_context,contexts[3]);assert.equal(p.requests[0].request.question_context.variant,null);p.close();
});
test('save disabled uses choice-only session state and enabling saving persists current accepted choice',async()=>{
 let p=page({disabled:true});p.field().value='private';p.field().dispatchEvent(new p.w.Event('input',{bubbles:true}));await check(p);
 const key=p.w.CTMStore.key('q');assert.equal(p.w.localStorage.getItem(key),null);
 let choice=JSON.parse(p.w.sessionStorage.getItem(key));assert.deepEqual(choice.inputs,{});assert.equal(choice.result,undefined);
 p.w.CTMStore.setEnabled(true);assert.equal(p.stored().variant.n,2);assert.deepEqual(p.stored().inputs,{});
 p.w.CTMStore.clearPage();assert.equal(p.w.localStorage.getItem(key),null);assert.equal(p.w.sessionStorage.getItem(key),null);p.close();
});
test('handwritten pools share stable choice without native grading; legacy generated HTML retains its renderer',()=>{
 let p=page({pool:true});assert.equal(p.element.querySelector('.math-variant-number').textContent,'Variant 2');
 const local=p.local();p.close();p=page({pool:true,local,query:''});assert.equal(p.stored().variant.n,2);assert.equal(p.runtime,0);p.close();
 const legacy=record();legacy.question='<strong>Legacy HTML</strong> _[2/3]';
 p=page({records:[legacy],legacy:true});assert.equal(p.element.querySelector('strong').textContent,'Legacy HTML');p.close();
});
test('failed required native chooser is isolated from ordinary Check and remains an initial UI failure',async()=>{
 const ordinary='<div id="ordinary" class="math-exercise-cell" data-label="ordinary" data-mode="equivalent" data-fields="[&quot;o-f1&quot;]"><div class="math-exercise-question"><input class="math-input" id="o-f1" data-answer="42"></div><button class="math-check-btn"></button><button class="math-legend-btn"></button><div class="math-legend-panel"></div><div class="math-feedback-area"></div></div>';
 const p=page({missingChooser:true,automatic:true,extra:ordinary});p.start();
 await assert.rejects(p.tracked[0],/renderer-unavailable/);
 assert.ok(p.element.querySelector('.math-setup-unavailable'));assert.equal(p.element.querySelector('.math-check-btn').disabled,true);
 const good=p.w.document.getElementById('ordinary');good.querySelector('input').value='42';good.querySelector('.math-check-btn').click();
 for(let i=0;i<30&&good.querySelector('.math-check-btn').disabled;i++)await new Promise(r=>setTimeout(r,0));
 assert.equal(good.querySelector('.math-check-btn').disabled,false);assert.equal(p.requests.length,1);assert.equal(p.requests[0].name,'math_exercise.check');
 assert.match(p.errors[0][1].message,/Shared variant selection/);p.close();
});

test('feedback request and identity exclude native teacher/variables/checker/solution',async()=>{
 const p=page({feedback:true});p.field().value='student value';
 const request=await p.feedbackRequest(),text=JSON.stringify(request);
 assert.equal(p.runtime,0);assert.equal(p.requests.length,0);
 assert.doesNotMatch(text,/questionContext|question_context|\\"teacher\\"|\\"variables\\"|Rational|def check|Teacher solution/);
 assert.equal(request.materials[0].text,'Authored context only');p.close();
});
test('actual JS scalar/vector transport packets grade through the canonical installed wheel API',async()=>{
 const code="def check(response, symbols):\n    assert set(response['answers']) == set(response['teacher'])\n    assert response['variables']['a'] == Rational(1,3)\n    assert response['variant']['n'] == 2\n    return all(simplify(response['answers'][key]-value)==0 for key,value in response['teacher'].items())";
 const packets=[];
 for(const vector of [false,true]){
  const row=record();row.checker=code;
  if(vector){row.context=plain(contexts[4]);Object.assign(row,row.context.variant);row.question='Vector: vec[1/3,2/3]';}
  const p=page({records:[row]});
  const inputs=[...p.element.querySelectorAll('input.math-input')];assert.equal(inputs.length,vector?2:1);
  inputs.forEach((input,index)=>{input.value=vector?(index?'2/3':'1/3'):'2/3';});await check(p);
  packets.push(p.requests[0]);p.close();
 }
 const result=spawnSync(process.env.QUARTO_PYTHON||'python3',['-c',`import json,os,sys,faulthandler
faulthandler.dump_traceback_later(8,exit=True)
import ctm_checkers
from ctm_checkers.browser import call
assert ctm_checkers.__file__.startswith(os.environ['CTM_CHECKERS_WHEEL'])
out=[]
for packet in json.loads(sys.argv[1]):
 caller={'_ctm_request':json.dumps(packet['request'])}
 out.append(json.loads(call(packet['name'],caller)))
 assert '_ctm_request' not in caller
print(json.dumps(out))`,JSON.stringify(packets)],{env:pythonEnv,encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stderr);const verdicts=JSON.parse(result.stdout);
 assert.equal(verdicts.length,2);for(const verdict of verdicts){assert.equal(verdict.status,'correct',JSON.stringify(verdict));assert.equal(verdict.score,1);}
 if(process.env.CTM_VARIANTS_TRANSPORT_EVIDENCE)writeFileSync(process.env.CTM_VARIANTS_TRANSPORT_EVIDENCE,JSON.stringify({scope:'Actual component JS custom scalar/vector packets through installed native wheel browser.call; no Pyodide bootstrap claim',packets,verdicts},null,2)+'\n');
});

test('review warning persists for approved choices and optional boards receive only public projected values',()=>{
 const records=[record(),record(1)];records[0].values={a:'1/3',vector:[1,2]};records[1].values={a:'2/3'};
 const p=page({records,boards:true,review:true});
 assert.equal(p.element.querySelector('.math-variant-unapproved').hidden,false);
 assert.deepEqual(p.boardCalls,[{n:2,id:records[0].id,values:records[0].values}]);
 p.next();assert.equal(p.boardCalls.length,2);assert.deepEqual(p.boardCalls[1],{n:7,id:records[1].id,values:records[1].values});
 assert.equal(p.element.querySelector('.math-variant-unapproved').hidden,false);assert.equal(p.runtime,0);p.close();
});

test('handwritten pool missing shared chooser fails locally rather than changing its selection model',async()=>{
 const p=page({pool:true,missingChooser:true,automatic:true});p.start();await assert.rejects(p.tracked[0],/renderer-unavailable/);
 assert.match(p.element.querySelector('.math-setup-unavailable').textContent,/load|reload|unavailable/i);
 assert.equal(p.requests.length,0);assert.match(p.errors[0][1].message,/Shared variant selection/);p.close();
});

test('external worked solution collapses only on an accepted real change',()=>{
 const p=page({automatic:true,extra:'<details open><div class="callout"><div class="collapse show"><div id="external-solution"></div></div></div></details>'});
 const payload=JSON.parse(p.element.dataset.variants);payload.solutionTarget='external-solution';p.element.dataset.variants=JSON.stringify(payload);
 let hidden=0;const accepted=[];p.w.bootstrap={Collapse:{getOrCreateInstance(){return {hide(){hidden++;}};}}};
 p.element.addEventListener('math-exercise:variant-accepted',event=>accepted.push(plain(event.detail)));
 p.w.__mathExerciseTestApi.setupCell(p.element);assert.equal(hidden,0);assert.equal(accepted.length,0);assert.equal(p.w.document.querySelector('details').open,true);
 p.field().value='answer';p.w.confirm=()=>false;p.next();assert.equal(hidden,0);assert.equal(accepted.length,0);
 p.w.confirm=()=>true;p.next();assert.equal(hidden,1);assert.equal(accepted.length,1);assert.equal(p.w.document.querySelector('details').open,false);
 p.element.mathExercise.selectVariant('id-7');assert.equal(hidden,1);assert.equal(accepted.length,1,'same selection does not reset authored work');p.close();
});

test('legacy custom feedback identities omit checker source and parameter bags',async()=>{
 const row=record();row.parameters={privateTeacher:'secret-value'};row.derived={privateDerived:'hidden-result'};row.checker='def check(response, symbols): return 42 # hidden-checker';
 const p=page({records:[row],legacy:true,feedback:true});p.field().value='learner answer';
 const request=await p.feedbackRequest();assert.doesNotMatch(JSON.stringify(request),/secret-value|hidden-result|hidden-checker|def check|parameters|derived/);p.close();
});
