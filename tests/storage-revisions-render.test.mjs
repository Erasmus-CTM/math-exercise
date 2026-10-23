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

// Native content identities are covered by test_variant_resolver.py and
// native-variants-render.test.mjs. This integration leaf owns ordinary pool
// grading revisions and must not replace a removed generator module with a mock.
test('ordinary pool revisions follow grading rules and survive source/task reordering', {skip:available?false:'Quarto is required'},async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'math-storage-revision-'));
 try{
  await cp(new URL('../_extensions/math-exercise/',import.meta.url),path.join(dir,'_extensions/math-exercise'),{recursive:true});install(dir);
  const rules={mode:'equivalent',reject:'sin',tolerance:'0.1',decplaces:'3',sigfigs:'4',form:'expanded',vars:'x',packages:'numpy',response:'changed-source','partial-credit':'true','form-credit':'0.2',vecdir:'row','field-labels':'named-answer'};
  const question='First _[1].\n---\nSecond _[2].';
  const defaults={pool:'true',mode:'custom',checker:'return True',tolerance:'0'};
  const cases=[['base',defaults,question],['stable-option-order',Object.fromEntries(Object.entries(defaults).reverse()),question],['unrelated',defaults,'Other _[9].\n---\n'+question],['reordered',defaults,'Second _[2].\n---\nFirst _[1].'],['checker',{...defaults,checker:'return False'},question],...Object.entries(rules).map(([key,value])=>['rule-'+key,{...defaults,[key]:value},question])];
  const body=cases.map(([label,options,text])=>'```{math-exercise}\n#| label: '+label+'\n'+Object.entries(options).map(([key,value])=>'#| '+key+': '+value).join('\n')+'\n'+text+'\n```').join('\n\n');
  await writeFile(path.join(dir,'fixture.qmd'),'---\nfilters: [math-exercise]\nmath-exercise: {feedback: false}\n---\n\n'+body);
  const rendered=spawnSync(quarto,['render','fixture.qmd','--to','html'],{cwd:dir,env:renderEnv,encoding:'utf8',timeout:120000});assert.equal(rendered.status,0,rendered.stderr);
  const dom=new JSDOM(await readFile(path.join(dir,'fixture.html'),'utf8'));
  try{
   const variants=Object.fromEntries([...dom.window.document.querySelectorAll('.math-exercise-cell')].map(cell=>[cell.dataset.label,JSON.parse(cell.dataset.storageVariants)]));
   const original=variants.base[0];assert.equal(variants['stable-option-order'][0].hash,original.hash);
   assert.equal(variants.unrelated[1].hash,original.hash);assert.equal(variants.reordered[1].hash,original.hash);
   assert.equal(variants.unrelated[1].id,original.id);
   for(const name of ['checker',...Object.keys(rules).map(key=>'rule-'+key)])assert.notEqual(variants[name][0].hash,original.hash,name+' invalidates saved grading');
  }finally{dom.window.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});
