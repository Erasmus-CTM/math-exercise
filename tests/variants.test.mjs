import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import {loadPage, requestFeedback, typesetMathJax} from './helpers/ai-context.mjs';
const root=path.resolve(import.meta.dirname,'..'),extension=path.join(root,'_extensions/math-exercise');
function compiled(name,review=false){
 const source=readFileSync(path.join(root,'_includes/variants',name+'.qmd'),'utf8').split('\n').slice(1,-2).join('\n');
 const p=spawnSync('python3',[path.join(extension,'variants.py')],{input:JSON.stringify({source,review}),encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);
}
function render(name){
 const input=readFileSync(path.join(root,'_includes/variants',name+'.qmd'),'utf8').replace('```{math-exercise}','```{.math-exercise}');
 const args=['--lua-filter',path.join(root,'tests/fixtures/variants-pandoc.lua'),'-t','plain','--wrap=none'];
 const p=spawnSync(process.env.PANDOC_BIN||'quarto',process.env.PANDOC_BIN?args:['pandoc',...args],{input,encoding:'utf8',env:{...process.env,VARIANT_EXTENSION:extension}});
 assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);
}
function cellHTML(data){
 const esc=x=>String(x).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
 const o=data.options;
 return `<div class="math-exercise-cell" id="v1" data-label="${o.label}" data-mode="${o.mode}" data-context-mode="auto" data-decplaces="${o.decplaces||''}" data-checker="${esc(JSON.stringify(o.checker||''))}" data-variants="${esc(JSON.stringify(data))}" data-pool="${esc(JSON.stringify(data.variants.map(x=>x.question)))}" data-fields="[]" data-field-labels="[]"><button class="math-pool-reload"></button><div class="math-exercise-question"></div><button class="math-check-btn"></button><button class="math-legend-btn"></button><div class="math-legend-panel"></div><div class="math-feedback-area"></div></div>`;
}
test('real YAML/Markdown adapter preserves Python, LaTeX and all marker forms',()=>{
 const a=compiled('matrix'),b=render('matrix');assert.equal(a.variants[0].checker,b.variants[0].checker);assert.match(b.variants[0].question,/mat\{name=A/);
 const c=render('triangle');assert.match(c.variants[0].solution,/data-ai-feedback-tex/);assert.match(c.variants[0].question,/_\[4\/sqrt\(3\^2\+4\^2\)\]/);
});
test('generated selection persists stable IDs, syncs solution, emits protocol and excludes references from AI',async()=>{
 const data=render('triangle');data.review=true;
 const page=loadPage(cellHTML(data)),cell=page.document.querySelector('.math-exercise-cell');
 page.window.Math.random=()=>0;page.api.setupCell(cell);
 assert.equal(cell.mathExercise.getVariant().parameters.ab,3);
 const first=cell.mathExercise.getVariant().id;
 assert.match(cell.querySelector('.math-variant-solution').textContent,/0.800/);
 let event;cell.addEventListener('math-exercise:variant-change',e=>event=e.detail);
 cell.querySelector('input.math-input').value='9';cell.querySelector('.math-pool-reload').click();
 assert.notEqual(event.variant.id,first);assert.equal(cell.querySelector('input.math-input').value,'');
 const snapshot=cell.mathExercise.getVariant();snapshot.parameters.ab=999;assert.notEqual(cell.mathExercise.getVariant().parameters.ab,999);
 assert.equal(page.window.sessionStorage.getItem('math-pool|/exercises|variant-triangle|id'),event.variant.id);
 const before=await requestFeedback(page,cell,['ratio']);assert(!before.includes('Pythagoras gives'));assert(!before.includes('expected'));assert(before.includes('Right triangle'));
 typesetMathJax(page,4);assert.equal(await requestFeedback(page,cell,['ratio']),before);
 const buttons=[...cell.querySelectorAll('button')];buttons.find(b=>b.textContent==='Copy selection').click();assert.match(cell.querySelector('.math-variant-review textarea').value,/reviewed-fingerprint/);
 cell.mathExercise.selectVariant(first);assert.equal(cell.mathExercise.getVariant().id,first);
 page.window.close();
});
test('all authored vector, matrix, coupled, geometric and expression fixtures use the real Python checkers',()=>{
 const source=readFileSync(path.join(extension,'math-exercise.js'),'utf8');
 const match=source.match(/runPythonAsync\(\[\n([\s\S]*?)\n    \]\.join\('\\n'\)\)/);
 const python=vm.runInNewContext(`[${match[1]}]`).join('\n');
 const cases=['triangle','perpendicular','matrix','coupled','geometry'].map(x=>compiled(x,true));
 const script=`import json,sys\nexec(${JSON.stringify(python)})\ncases=json.load(sys.stdin)\ncount=0\nfor data in cases:\n o=data['options']\n for r in data['variants']:\n  for t in r['tests']:\n   _math_vars=o.get('vars','')\n   if o['mode']=='custom':\n    response=t.get('response',{'kind':'expressions','raw':t.get('answers',[]),'inputs':{}}).copy()\n    response['variant']={k:r[k] for k in ('id','parameters','derived','fingerprint')}\n    response['variant']['context']=r['variant-context']\n    _math_response_json=json.dumps(response)\n    _math_checker=r['checker']\n    actual=[_math_check_custom()['status']]\n   else:\n    import re\n    expected_answers=re.findall(r'_+\\[([^\\]]+)\\]',r['question'])\n    _math_mode=o['mode'];_math_reject='';_math_tolerance=o.get('tolerance','');_math_decplaces=o.get('decplaces','');_math_sigfigs='';_math_form='';_math_partial_credit=False;_math_form_credit=.5\n    actual=[]\n    for _math_student,_math_correct in zip(t['answers'],expected_answers):actual.append(_math_check()['status'])\n   expected=t['expected'] if isinstance(t['expected'],list) else [t['expected']]\n   assert actual==expected,(o['label'],r['id'],t,actual,expected)\n   count+=1\nprint(count,'real checker fixtures passed')\n`;
 const result=spawnSync('python3',['-c',script],{input:JSON.stringify(cases),encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/fixtures passed/);
});
