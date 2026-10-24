import assert from 'node:assert/strict';
import {cp,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {install,renderEnv} from './helpers/ctm-libs.mjs';
const quarto=process.env.QUARTO_BIN||'quarto';
const available=spawnSync(quarto,['--version']).status===0;

test('native generated Markdown, solution math and storage identities survive fresh Quarto processes', {skip:available?false:'Quarto is required'},async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'math-variant-storage-'));
 try{
  await cp(new URL('../_extensions/math-exercise/',import.meta.url),path.join(dir,'_extensions/math-exercise'),{recursive:true});install(dir);
  const question='Compute $x+{@a@}$: _[{#a#}].',solution='Use $x={@a@}$ and $$y={@b@}.$$',context='Given $a={@a@}$.';
  const cases=[['base',question,solution,context],['question',question.replace('x+','x-'),solution,context],['solution',question,solution.replace('x={@a@}','x={@a@}+1'),context],['context',question,solution,context.replace('a={@a@}','a={@a@}+1')]];
  const body=cases.map(([label,text,answer,material])=>['```{math-exercise}','#| label: '+label,'#| variables: |','#|   a = pick([1, 2])','#|   b = a + 1','#| field-labels: Answer','#| vars: x','#| note: a={#a#}','#| mode: numeric','#| tolerance: 0.01','#| context-text: '+material,text,'#| solution',answer,'```'].join('\n')).join('\n\n');
  await writeFile(path.join(dir,'fixture.qmd'),'---\nengine: markdown\nfilters: [math-exercise]\nmath-exercise: {feedback: false}\n---\n\n'+body);
  let reference;
  for(let run=0;run<2;run++){
   const rendered=spawnSync(quarto,['render','fixture.qmd','--to','html'],{cwd:dir,env:{...renderEnv,CTM_VARIANTS:'review'},encoding:'utf8',timeout:120000});assert.equal(rendered.status,0,rendered.stdout+'\n'+rendered.stderr);
   const dom=new JSDOM(await readFile(path.join(dir,'fixture.html'),'utf8'));
   try{
    const snapshot={};
    for(const cell of dom.window.document.querySelectorAll('.math-exercise-cell')){
     const data=JSON.parse(cell.dataset.variants),descriptors=JSON.parse(cell.dataset.storageVariants);assert.equal(data.native,true);assert.equal(data.variants.length,2);assert.equal(cell.hasAttribute('data-pool'),false);
     assert.deepEqual(descriptors.map(row=>row.id),data.variants.map(row=>row.id));
     for(const record of data.variants){
      const a=Number(/_\[(\d+)\]/.exec(record.question)[1]);assert.ok([1,2].includes(a));assert.doesNotMatch(record.question,/\{@|\{#|<span/);assert.equal(record.context.variant,null);
      const holder=dom.window.document.createElement('div');holder.innerHTML=record.solution;
      const spans=[...holder.querySelectorAll('[data-ai-feedback-tex]')];assert.ok(spans.length,'solution retains annotated mathematical spans');assert.ok(spans.some(span=>span.dataset.aiFeedbackTex.replace(/[{} ]/g,'').includes('y='+String(a+1))),'derived b=a+1 is resolved in solution mathematics');
      for(const span of spans){assert.ok(span.dataset.aiFeedbackTex);assert.ok(['false','true'].includes(span.dataset.aiFeedbackDisplay));assert.ok(span.querySelector('.math'));}
     }
     snapshot[cell.dataset.label]={data,descriptors};
    }
    assert.equal(Object.keys(snapshot).length,4);
    if(reference)assert.deepEqual(snapshot,reference,'fresh-process native values and identities are identical');else reference=snapshot;
    const original=new Map(snapshot.base.descriptors.map(row=>[row.id,row.hash]));
    for(const name of ['question','solution','context'])for(const row of snapshot[name].descriptors){assert.ok(original.has(row.id),'same retained-choice identity');assert.notEqual(row.hash,original.get(row.id),name+' mathematical changes invalidate saved content');}
   }finally{dom.window.close();}
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
