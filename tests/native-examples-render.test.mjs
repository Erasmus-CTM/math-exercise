import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {install,renderEnv} from './helpers/ctm-libs.mjs';

test('manual native examples reject zero approvals and render tested review proposals without history writes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ctm-native-examples-'));
 try{
  cpSync(new URL('../_extensions/math-exercise',import.meta.url),join(dir,'_extensions/math-exercise'),{recursive:true});install(dir);
  const body=['triangle','perpendicular','matrix','coupled','geometry'].map(name=>readFileSync(new URL('../_includes/variants/'+name+'.qmd',import.meta.url),'utf8')).join('\n\n');
  writeFileSync(join(dir,'lesson.qmd'),'---\nengine: markdown\nformat: html\nfilters: [math-exercise]\nmath-exercise: {feedback: false}\n---\n\n'+body);
  const run=mode=>spawnSync(process.env.QUARTO_BIN||'quarto',['render','lesson.qmd'],{cwd:dir,env:{...renderEnv,CTM_VARIANTS:mode},encoding:'utf8',timeout:120000});
  let result=run('');assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/at least one current approved/);
  result=run('review');assert.equal(result.status,0,result.stdout+result.stderr);
  const dom=new JSDOM(readFileSync(join(dir,'lesson.html'),'utf8'));
  try{
   const cells=[...dom.window.document.querySelectorAll('.math-exercise-cell')];assert.equal(cells.length,5);
   for(const cell of cells){const payload=JSON.parse(cell.dataset.variants);assert.equal(payload.native,true);assert.equal(payload.renderMode,'review');assert.ok(payload.variants.length>0);for(const row of payload.variants){assert.equal(row.n,null);assert.equal(row.context.variant,null);assert.equal(row.proposal,true);}}
   const matrix=JSON.parse(cells.find(cell=>cell.dataset.label==='variant-matrix').dataset.variants);assert.deepEqual(matrix.variants[0].context.fields,['A11','A12','A21','A22']);
  }finally{dom.window.close();}
  assert.equal(existsSync(join(dir,'_variants')),false,'review must not create approvals or retained history');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
