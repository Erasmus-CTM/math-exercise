import assert from 'node:assert/strict';
import {cp,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {install,renderEnv} from './helpers/ctm-libs.mjs';

const quarto=process.env.QUARTO_BIN||'quarto';
const available=!spawnSync(quarto,['--version']).error;

test('generated math HTML and saved variant revisions are stable across fresh Quarto processes',
  {skip:available?false:'Quarto is required'}, async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'math-variant-storage-'));
  try {
    await cp(new URL('../_extensions/math-exercise/',import.meta.url),
      path.join(dir,'_extensions/math-exercise'),{recursive:true});
    install(dir);
    const question='Compute $x+{{a}}$: _[{{a}}].';
    const solution='Use $x={{a}}$ and $$y={{b}}.$$';
    const cases=[
      ['base',question,solution,'Given {{a}}.'],
      ['question',question+' Changed question.',solution,'Given {{a}}.'],
      ['solution',question,solution+' Changed solution.','Given {{a}}.'],
      ['context',question,solution,'Changed context {{a}}.'],
    ];
    const fence=String.fromCharCode(96).repeat(3);
    let body='---\nfilters: [math-exercise]\nmath-exercise:\n  feedback: false\n---\n\n';
    for(const [label,text,answer,context] of cases) {
      body+=fence+'{math-exercise}\n#| label: '+label+'\n#| parameters: {a: [1,2]}\n'
        +'#| derived: {b: a+1}\n#| mode: numeric\n#| tolerance: "0.01"\n'
        +'#| solution: '+JSON.stringify(answer)+'\n#| variant-context: '+JSON.stringify(context)
        +'\n\n'+text+'\n'+fence+'\n\n';
    }
    await writeFile(path.join(dir,'fixture.qmd'),body);
    let reference;
    for(let run=0;run<6;run++) {
      const rendered=spawnSync(quarto,['render','fixture.qmd','--to','html'],
        {cwd:dir,env:renderEnv,encoding:'utf8',timeout:120000});
      assert.equal(rendered.status,0,rendered.stdout+'\n'+rendered.stderr);
      const window=new JSDOM(await readFile(path.join(dir,'fixture.html'),'utf8')).window;
      try {
        const cells=[...window.document.querySelectorAll('.math-exercise-cell')];
        assert.equal(cells.length,cases.length);
        const snapshot={};
        for(const cell of cells) {
          const data=JSON.parse(cell.dataset.variants);
          const descriptors=JSON.parse(cell.dataset.storageVariants);
          assert.equal(data.variants.length,2);
          assert.deepEqual(JSON.parse(cell.dataset.pool),data.variants.map(record=>record.question));
          assert.deepEqual(descriptors.map(record=>record.id),data.variants.map(record=>record.id));
          for(const record of data.variants) {
            assert.equal(record.derived.b,record.parameters.a+1);
            assert.ok(record.question.includes('_['+record.parameters.a+']'),'answer marker preserved');
            for(const html of [record.question,record.solution]) {
              const holder=window.document.createElement('div');
              holder.innerHTML=html;
              const spans=[...holder.querySelectorAll('[data-ai-feedback-tex]')];
              assert.ok(spans.length,'native Math spans rendered');
              for(const span of spans) {
                assert.deepEqual(span.getAttributeNames(),
                  ['data-ai-feedback-tex','data-ai-feedback-display'],'stable native attribute order');
                assert.ok(span.dataset.aiFeedbackTex.length);
                assert.ok(['false','true'].includes(span.dataset.aiFeedbackDisplay));
                assert.ok(span.querySelector('.math'),'actual math child preserved');
              }
            }
          }
          snapshot[cell.dataset.label]={data,descriptors};
        }
        if(reference) assert.deepEqual(snapshot,reference,'fresh-process records and revisions are identical');
        else reference=snapshot;
        for(const name of ['question','solution','context']) {
          assert.deepEqual(snapshot[name].descriptors.map(record=>record.id),
            snapshot.base.descriptors.map(record=>record.id),'same variant identities');
          for(let index=0;index<2;index++) assert.notEqual(
            snapshot[name].descriptors[index].hash,snapshot.base.descriptors[index].hash,
            name+' changes must invalidate the saved revision');
        }
        console.log('Quarto variant storage process '+(run+1)+': '
          +JSON.stringify(snapshot.base.descriptors));
      } finally {window.close();}
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});
