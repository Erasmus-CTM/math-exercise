import assert from 'node:assert/strict';
import test from 'node:test';
import {cpSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {loadPage} from './helpers/ai-context.mjs';
import {install,renderEnv} from './helpers/ctm-libs.mjs';

test('starting values are exceptional, survive copied Quarto source, and preserve answer keys',()=>{
  const dir=mkdtempSync(join(tmpdir(),'math-starting-values-')); let page;
  try {
    cpSync(new URL('../_extensions/math-exercise',import.meta.url),join(dir,'_extensions/math-exercise'),{recursive:true});
    install(dir);
    const source='---\nformat: html\nfilters: [math-exercise]\n---\n\n'+[
      ['ordinary','', 'What is 6*7? _[42]'],
      ['draft','#| initial-values: ["40"]\n','What is 6*7? _[42]'],
      ['vector','#| initial-values: ["2*x", ""]\n','Enter vec[2*x+y,x].'],
      ['matrix','#| initial-values: ["1", "", "", "4"]\n','Enter mat[1,3;2,4].'],
      ['dynamic','#| initial-values: ["1", "-1", ""]\n#| mode: custom\n#| checker: |\n#|   def check(response, symbols):\n#|       return True\n','Enter mat{name=B,rows=3,cols=auto,initial-cols=1}.']
    ].map(([label,options,question])=>'```{math-exercise}\n#| label: '+label+'\n'+options+question+'\n```').join('\n\n');
    writeFileSync(join(dir,'copied.qmd'),source);
    let render=spawnSync(process.env.QUARTO_BIN||'quarto',['render','copied.qmd'],{cwd:dir,env:renderEnv,encoding:'utf8',timeout:60000});
    assert.equal(render.status,0,render.stderr);
    page=loadPage(readFileSync(join(dir,'copied.html'),'utf8'));
    const expected={ordinary:[''],draft:['40'],vector:['2*x',''],matrix:['1','','','4'],dynamic:['1','-1','']};
    for(const cell of page.document.querySelectorAll('.math-exercise-cell')){
      page.api.setupCell(cell);
      assert.deepEqual([...cell.querySelectorAll('.math-input')].map(n=>n.value),expected[cell.dataset.label]);
    }
    assert.equal(page.document.querySelector('[data-label="ordinary"]').hasAttribute('data-initial-values'),false);
    assert.equal(page.document.querySelector('[data-label="draft"] input').dataset.answer,'42');
    assert.equal(page.document.querySelector('[data-label="draft"] input').value,'40');
    writeFileSync(join(dir,'invalid.qmd'),source.split('```{math-exercise}')[0]+'```{math-exercise}\n#| initial-values: [40]\n_[42]\n```');
    render=spawnSync(process.env.QUARTO_BIN||'quarto',['render','invalid.qmd'],{cwd:dir,env:renderEnv,encoding:'utf8',timeout:60000});
    assert.notEqual(render.status,0); assert.match(render.stderr,/initial-values must be a JSON array of strings/);
  } finally {page?.window.close();rmSync(dir,{recursive:true,force:true});}
});
