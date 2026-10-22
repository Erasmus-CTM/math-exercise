import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {install,renderEnv} from './helpers/ctm-libs.mjs';

const fence=String.fromCharCode(96).repeat(3);
function block(mode,teacher,answer,expect='correct',extra=''){
  return [fence+'{math-exercise}','#| label: declarative-'+mode,'#| mode: '+mode,extra,
    '#| tests:','#|   - name: actual '+mode+' grading','#|     answers: ['+JSON.stringify(answer)+']',
    '#|     expect: '+expect,'Answer: _['+teacher+'].',fence].filter(Boolean).join('\n');
}
test('declarative tests run at real Quarto build time in every grading mode',()=>{
  const dir=mkdtempSync(join(tmpdir(),'math-declarative-tests-'));
  try{
    cpSync(new URL('../_extensions/math-exercise',import.meta.url),join(dir,'_extensions/math-exercise'),{recursive:true});
    install(dir);
    const render=()=>spawnSync(process.env.QUARTO||'quarto',['render','lesson.qmd'],{
      cwd:dir,env:renderEnv,encoding:'utf8',timeout:120000});
    const source='---\nformat: html\nfilters: [math-exercise]\n---\n\n'+[
      block('equivalent','(x+1)^2','x^2+2*x+1','correct','#| vars: x'),
      block('numeric','1/2','raw("0.501")','correct','#| tolerance: 0.01'),
      block('exact','1/2','raw("2/4")','wrong'),
      block('set','1,2,3','raw("3,2,1")'),
      block('string','Hello','raw("Hello")'),
      block('string_ci','Hello','raw("hello")'),
      block('custom','','2','correct','#| checker: |\n#|   def check(r, s):\n#|       return r["expressions"][0] == 2'),
    ].join('\n\n')+'\n';
    writeFileSync(join(dir,'lesson.qmd'),source);
    let result=render();
    assert.equal(result.status,0,result.stdout+result.stderr);
    const html=readFileSync(join(dir,'lesson.html'),'utf8');
    assert.doesNotMatch(html,/actual numeric grading|raw\("0.501"\)|"expect"/);
    for(const mode of ['equivalent','numeric','exact','set','string','string_ci','custom']){
      assert.match(html,new RegExp('declarative-'+mode));
    }
    // Mutating a real grading expectation must stop the build by name.
    writeFileSync(join(dir,'lesson.qmd'),source.replace('#|     answers: [raw("0.501")]','#|     answers: [raw("9")]'));
    result=render();
    assert.notEqual(result.status,0);
    assert.match(result.stdout+result.stderr,/declarative-numeric/);
    assert.match(result.stdout+result.stderr,/actual numeric grading/);
    writeFileSync(join(dir,'lesson.qmd'),source.replace('#|     expect: correct','#|     expect: [correct, wrong]'));
    result=render();
    assert.notEqual(result.status,0,'malformed field expectations fail closed');
    assert.match(result.stdout+result.stderr,/declarative-equivalent/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('named fields and partial scoring use real build-time grades',()=>{
  const dir=mkdtempSync(join(tmpdir(),'math-declarative-fields-'));
  try{
    cpSync(new URL('../_extensions/math-exercise',import.meta.url),join(dir,'_extensions/math-exercise'),{recursive:true});
    install(dir);
    writeFileSync(join(dir,'lesson.qmd'),[
      '---','format: html','filters: [math-exercise]','---','',
      fence+'{math-exercise}','#| label: named-partial','#| mode: set','#| partial-credit: true',
      '#| field-labels: selected','#| tests:','#|   - name: one of two',
      '#|     answers: {selected: raw("1")}','#|     expect: {selected: partial}',
      '#|     score: 0.5','#|     partial: true','Choose _[1,2].',fence,
    ].join('\n'));
    const result=spawnSync(process.env.QUARTO||'quarto',['render','lesson.qmd'],{
      cwd:dir,env:renderEnv,encoding:'utf8',timeout:120000});
    assert.equal(result.status,0,result.stdout+result.stderr);
  } finally {rmSync(dir,{recursive:true,force:true});}
});


test('native author keys equal actual Lua-rendered marker keys',()=>{
  const dir=mkdtempSync(join(tmpdir(),'math-declarative-markers-'));
  try{
    cpSync(new URL('../_extensions/math-exercise',import.meta.url),join(dir,'_extensions/math-exercise'),{recursive:true});
    install(dir);
    writeFileSync(join(dir,'lesson.qmd'),[
      '---','format: html','filters: [math-exercise]','---','',
      fence+'{math-exercise}','#| label: marker-parity','#| tests:',
      '#|   - name: all actual fields','#|     answers: [1,2,3,4,5]',
      '#|     expect: [correct,correct,correct,correct,correct]',
      '\x60_[1]\x60 \\_[2] αvec[3,4] _[unclosed _[5]',fence,
    ].join('\n'));
    const result=spawnSync(process.env.QUARTO||'quarto',['render','lesson.qmd'],{
      cwd:dir,env:renderEnv,encoding:'utf8',timeout:120000});
    assert.equal(result.status,0,result.stdout+result.stderr);
    const html=readFileSync(join(dir,'lesson.html'),'utf8');
    assert.deepEqual([...html.matchAll(/<input[^>]*data-answer="([^"]*)"/g)].map(match=>match[1]),['1','2','3','4','5']);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
