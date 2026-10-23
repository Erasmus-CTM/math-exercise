import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {JSDOM} from 'jsdom';
import {install,renderEnv} from './helpers/ctm-libs.mjs';

test('native questions have one serialized source while handwritten pools retain their own tasks',()=>{
 const dir=mkdtempSync(join(tmpdir(),'math-native-payload-'));
 try{
  cpSync(new URL('../_extensions/math-exercise',import.meta.url),join(dir,'_extensions/math-exercise'),{recursive:true});install(dir);
  writeFileSync(join(dir,'_quarto.yml'),'project: {type: default}\nformat: html\nfilters: [math-exercise]\nai-feedback: {enabled: false}\nmath-exercise: {feedback: false}\n');
  writeFileSync(join(dir,'lesson.qmd'),['```{math-exercise}','#| label: native','#| variables: |','#|   a = pick([2])','#| field-labels: Answer','#| note: a={#a#}','Unique native question _[{#a#}]','```','',
   '```{math-exercise}','#| label: handwritten','#| pool: true','First _[2]','---','Second _[3]','```'].join('\n'));
  const result=spawnSync(process.env.QUARTO||'quarto',['render','lesson.qmd'],{cwd:dir,env:{...renderEnv,CTM_VARIANTS:'review'},encoding:'utf8',timeout:60000});
  assert.equal(result.status,0,result.stdout+result.stderr);
  const dom=new JSDOM(readFileSync(join(dir,'lesson.html'),'utf8'));
  const native=dom.window.document.querySelector('[data-label="native"]'),pool=dom.window.document.querySelector('[data-label="handwritten"]');
  assert.equal(native.hasAttribute('data-pool'),false);
  const rows=JSON.parse(native.dataset.variants).variants;
  assert.equal(rows.length,1);assert.equal(rows[0].question,'Unique native question _[2]');
  assert.equal(JSON.parse(native.dataset.storageVariants).length,1);
  assert.deepEqual(JSON.parse(pool.dataset.pool),['First _[2]','Second _[3]']);
  dom.window.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
