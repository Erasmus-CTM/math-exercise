import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,rmSync,writeFileSync,readFileSync,openSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {install,renderEnv} from './helpers/ctm-libs.mjs';

const fence='```';
const options={label:'native-q',vars:'x',variables:'a = pick([2, 4])','field-labels':'Answer',note:'a={#a#}',
  tests:'- name: resolved answer\n  answers: [a/2]\n  expect: correct',
  solution:'The answer is {#a/2#}. <b>Text</b>\n\n<script>notSolutionContent()</script>',
  translations:{nb:{question:'Finn $x + {@a@}$: _[{@a/2@}]. <b>literal</b>',solution:'Svaret er {#a/2#}.'}}};
const source=['#| label: native-q','#| vars: x','#| variables: |','#|   a = pick([2, 4])',
  '#| field-labels: Answer','#| note: a={#a#}','#| tests:','#|   - name: resolved answer',
  '#|     answers: [a/2]','#|     expect: correct','Find $x + {@a@}$: _[{@a/2@}]. <b>literal</b>',
  '#| solution',options.solution,'#| lang: nb',options.translations.nb.question,'#| solution',options.translations.nb.solution].join('\n');
const question='Find $x + {@a@}$: _[{@a/2@}]. <b>literal</b>';

test('native Quarto bridge enforces approval and preserves exact contexts across Lua JSON',()=>{
 const dir=mkdtempSync(join(tmpdir(),'math-native-variants-'));
 try{
  cpSync(new URL('../_extensions/math-exercise',import.meta.url),join(dir,'_extensions/math-exercise'),{recursive:true});
  install(dir);
  writeFileSync(join(dir,'_quarto.yml'),'project:\n  type: default\nformat: html\nfilters: [math-exercise]\nexecute:\n  enabled: false\nctm-assessment:\n  variants:\n    approval: required\nai-feedback:\n  enabled: false\nmath-exercise:\n  feedback: false\n');
  const lesson=raw=>writeFileSync(join(dir,'lesson.qmd'),fence+'{math-exercise}\n'+raw+'\n'+fence+'\n');
  lesson(source);
  const render=mode=>spawnSync(process.env.QUARTO||'quarto',['render','lesson.qmd'],{
   cwd:dir,env:{...renderEnv,CTM_VARIANTS:mode||''},encoding:'utf8',timeout:120000});
  let result=render();
  assert.notEqual(result.status,0);
  assert.match(result.stdout+result.stderr,/native-q/);
  assert.match(result.stdout+result.stderr,/at least one current approved/);
  result=render('optional');assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout+result.stderr,/unapproved variants/);
  let dom=new JSDOM(readFileSync(join(dir,'lesson.html'),'utf8'));
  let cell=dom.window.document.querySelector('.math-exercise-cell');
  const generated=JSON.parse(cell.dataset.variants);
  assert.equal(generated.native,true);assert.equal(generated.approval,'optional');
  assert.equal(generated.variants.length,2);
  assert.equal(generated.options.variables,undefined);assert.equal(generated.options.tests,undefined);assert.equal(generated.options.note,undefined);
  assert.ok(cell.querySelector('.math-variant-unapproved'));
  for(const row of generated.variants){
   assert.equal(row.n,null);assert.equal(row.proposal,true);assert.equal(row.context.variant,null);
   assert.ok(row.question.includes('<b>literal</b>'),'question remains ordinary Markdown with literal HTML for the component renderer');
   assert.doesNotMatch(row.question,/\{@|\{#/);assert.doesNotMatch(row.solution,/<script|notSolutionContent|<b>/);
   assert.match(row.solution,/Text/,'removing raw HTML tags preserves surrounding solution text');
   assert.match(row.question,/_\[[12]\]/);
  }
  assert.deepEqual(JSON.parse(cell.dataset.storageVariants).map(v=>v.n),[null,null]);
  dom.window.close();
  result=render('review');assert.equal(result.status,0,result.stdout+result.stderr);
  dom=new JSDOM(readFileSync(join(dir,'lesson.html'),'utf8'));cell=dom.window.document.querySelector('.math-exercise-cell');
  assert.equal(JSON.parse(cell.dataset.variants).renderMode,'review');assert.match(cell.querySelector('.math-variant-unapproved').textContent,/Review build/);dom.window.close();
  const payload={version:1,action:'generate',source,question,options,projectRoot:dir,file:'lesson.qmd',label:'native-q',
   manifest:'_variants/native-q.yml',approval:'required',renderMode:'review',baseHash:null};
  const checker=JSON.parse(readFileSync(join(dir,'_extensions/ctm-checkers/checkers.json'),'utf8'));
  const native=operation=>{
   const requestFile=join(dir,'native-request.json');writeFileSync(requestFile,JSON.stringify(operation));
   const input=openSync(requestFile,'r');
   const output=spawnSync(process.env.QUARTO_PYTHON||'python3',[join(dir,'_extensions/math-exercise/question-variants.py'),'--stdin'],{
    cwd:dir,env:{...renderEnv,CTM_CHECKERS_WHEEL:join(dir,'_extensions/ctm-checkers',checker.wheel)},
    stdio:[input,'pipe','pipe'],encoding:'utf8',timeout:120000});
   closeSync(input);
   assert.equal(output.status,0,output.stdout+output.stderr);return JSON.parse(output.stdout);
  };
  const proposed=native(payload),selected=proposed.records[0];
  native({...payload,action:'decide',baseHash:proposed.baseHash,decision:{id:selected.id,hash:selected.hash,status:'approved'}});
  result=render();assert.equal(result.status,0,result.stdout+result.stderr);
  dom=new JSDOM(readFileSync(join(dir,'lesson.html'),'utf8'));cell=dom.window.document.querySelector('.math-exercise-cell');
  const approved=JSON.parse(cell.dataset.variants).variants;
  assert.equal(approved.length,1);assert.equal(approved[0].n,1);assert.equal(approved[0].proposal,false);
  assert.deepEqual(approved[0].context.variant,{n:1,id:approved[0].id,hash:approved[0].hash});
  assert.equal(cell.querySelector('.math-variant-unapproved'),null);dom.window.close();
  lesson(source.replaceAll('_[{@a/2@}]','_[{@a/2+1@}]').replace('answers: [a/2]','answers: [a/2+1]'));
  result=render();assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/at least one current approved/);
  result=render('optional');assert.equal(result.status,0,result.stdout+result.stderr);
  dom=new JSDOM(readFileSync(join(dir,'lesson.html'),'utf8'));cell=dom.window.document.querySelector('.math-exercise-cell');
  assert.ok(JSON.parse(cell.dataset.variants).variants.every(row=>row.n===null&&row.proposal&&row.context.variant===null));dom.window.close();
  lesson('#| label: legacy\n#| parameters: obsolete\n_[2]');
  result=render();assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/legacy parameters syntax was removed/);
  lesson('#| label: ordinary\nAnswer _[2].');
  result=render();assert.equal(result.status,0,result.stdout+result.stderr);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
