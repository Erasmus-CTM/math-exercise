import assert from 'node:assert/strict';
import {cp,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {loadPage} from './helpers/ai-context.mjs';
const quarto=process.env.QUARTO_BIN||'quarto';
const available=!spawnSync(quarto,['--version']).error;
test('Quarto generated pools preserve JSON/HTML entities and literal TeX quotes', {skip:available?false:'Quarto is required'},async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'math-variants-render-'));let page;
 try{
  await cp(new URL('../_extensions/math-exercise/',import.meta.url),path.join(dir,'_extensions/math-exercise'),{recursive:true});
  await cp(process.env.AI_FEEDBACK_EXTENSION,path.join(dir,'_extensions/ai-feedback'),{recursive:true});
  const body='---\nfilters: [math-exercise]\n---\n\n```{math-exercise}\n#| label: entities\n#| parameters: {a: [1,2]}\n#| solution: |\n#|   Quote $\\text{&quot;a&quot;}$ and $x<y$.\n\nCompute $\\text{&quot;a&quot;}+x<y$ when $a={{a}}$: _[{{a}}].\n```\n';
  await writeFile(path.join(dir,'fixture.qmd'),body);
  const render=spawnSync(quarto,['render','fixture.qmd','--to','html'],{cwd:dir,encoding:'utf8',timeout:120000});assert.equal(render.status,0,render.stderr);
  page=loadPage(await readFile(path.join(dir,'fixture.html'),'utf8'));
  const cell=page.document.querySelector('.math-exercise-cell'),data=JSON.parse(cell.dataset.variants),pool=JSON.parse(cell.dataset.pool);
  assert.deepEqual(pool,data.variants.map(x=>x.question));page.api.setupCell(cell);
  assert.equal(cell.querySelector('[data-ai-feedback-tex]').dataset.aiFeedbackTex,String.raw`\text{&quot;a&quot;}+x<y`);
 }finally{page?.window.close();await rm(dir,{recursive:true,force:true});}
});
