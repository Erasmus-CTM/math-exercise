import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {JSDOM} from 'jsdom';
import {ctmLibs,install,renderEnv} from './helpers/ctm-libs.mjs';

test('ordinary authored context reaches AI alongside section context; none suppresses both',()=>{
 const dom=new JSDOM('<html lang="en"><body></body></html>',{url:'https://course.example/lesson',runScripts:'outside-only'}),w=dom.window;
 try{
  w.__mathExerciseTestMode=true;w.CTMLayout={ready(){}};
  w.MathExerciseRuntime={trackInitialUI(){}};
  const add=w.document.addEventListener.bind(w.document);
  w.document.addEventListener=(type,...args)=>type==='DOMContentLoaded'?undefined:add(type,...args);
  for(const name of ['locales/ctm-locale.js','locales/common.js','locales/math-exercise.js','feedback/feedback-core.js','feedback/feedback-dom.js'])w.eval(readFileSync(join(ctmLibs,name),'utf8'));
  w.eval(readFileSync(new URL('../_extensions/math-exercise/math-exercise.js',import.meta.url),'utf8'));
  const cell=w.document.createElement('div');cell.dataset.label='ordinary';cell.dataset.contextMode='auto';
  cell.dataset.context=JSON.stringify('Surrounding section');cell.dataset.contextText=JSON.stringify('Authored <b>literal</b> context, with exact notation x^2.');
  let materials=w.__mathExerciseTestApi.resolveContexts(cell);
  assert.ok(materials.some(m=>m.text==='Surrounding section'));
  assert.equal(materials.filter(m=>m.text===JSON.parse(cell.dataset.contextText)).length,1);
  assert.equal(cell.querySelector('b'),null);
  cell.dataset.contextMode='none';assert.deepEqual(JSON.parse(JSON.stringify(w.__mathExerciseTestApi.resolveContexts(cell))),[]);
  cell.dataset.contextMode='auto';delete cell.dataset.contextText;
  cell.mathExercise={getVariant(){return {n:2,id:'two',hash:'hash'};},getVariantContext(){return 'Resolved native authored context';}};
  materials=w.__mathExerciseTestApi.resolveContexts(cell);
  assert.equal(materials.filter(m=>m.text==='Resolved native authored context').length,1,'native record mapping remains separate');
 }finally{w.close();}
});

test('Quarto carries ordinary context-text safely and removes it under context none or AI off',()=>{
 const dir=mkdtempSync(join(tmpdir(),'math-authored-context-'));
 try{
  cpSync(new URL('../_extensions/math-exercise',import.meta.url),join(dir,'_extensions/math-exercise'),{recursive:true});install(dir);
  writeFileSync(join(dir,'_quarto.yml'),'project:\n  type: default\nformat: html\nfilters: [math-exercise]\n');
  const source=['```{math-exercise}','#| label: ordinary','#| context-text: Authored <b>literal</b> & exact x^2','Answer _[2]','```','',
   '```{math-exercise}','#| label: suppressed','#| context: none','#| context-text: NOT_SENT_CONTEXT','Answer _[3]','```'].join('\n');
  writeFileSync(join(dir,'lesson.qmd'),source);
  const render=()=>spawnSync(process.env.QUARTO||'quarto',['render','lesson.qmd'],{cwd:dir,env:{...renderEnv,CTM_VARIANTS_NATIVE:'/missing-native-not-needed'},encoding:'utf8',timeout:60000});
  let result=render();assert.equal(result.status,0,result.stdout+result.stderr);
  let dom=new JSDOM(readFileSync(join(dir,'lesson.html'),'utf8'));
  const ordinary=dom.window.document.querySelector('[data-label="ordinary"]');
  assert.equal(JSON.parse(ordinary.dataset.contextText),'Authored <b>literal</b> & exact x^2');
  assert.equal(ordinary.querySelector('b'),null);
  assert.equal(JSON.parse(dom.window.document.querySelector('[data-label="suppressed"]').dataset.contextText),'');dom.window.close();
  writeFileSync(join(dir,'lesson.qmd'),'---\nai-feedback:\n  enabled: false\n---\n'+source);
  result=render();assert.equal(result.status,0,result.stdout+result.stderr);
  dom=new JSDOM(readFileSync(join(dir,'lesson.html'),'utf8'));
  for(const cell of dom.window.document.querySelectorAll('.math-exercise-cell'))assert.equal(JSON.parse(cell.dataset.contextText),'');
  dom.window.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
