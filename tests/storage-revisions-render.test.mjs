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
const clone=value=>JSON.parse(JSON.stringify(value));

test('rendered storage revisions follow checker inputs and survive unrelated variant changes', {skip:available?false:'Quarto is required'},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'math-storage-revision-'));
  try {
    await cp(new URL('../_extensions/math-exercise/',import.meta.url),path.join(dir,'_extensions/math-exercise'),{recursive:true});
    install(dir);
    const record={id:'stable-id',parameters:{hidden:1,other:2},derived:{coefficient:3},
      question:'Same question: _[1].',checker:'def check(response, variant): return variant',
      solution:'Same solution.',fingerprint:'definition-before','variant-context':'Same context.'};
    const base={options:{label:'base',mode:'custom',checker:'global checker',pool:'true'},variants:[record]};
    const fixtures={base};
    const mutate=(name,fn)=>{const fixture=clone(base);fixture.options.label=name;fn(fixture);fixtures[name]=fixture;};
    mutate('parameters',f=>{f.variants[0].parameters.hidden=9;});
    mutate('derived',f=>{f.variants[0].derived.coefficient=9;});
    mutate('checker',f=>{f.variants[0].checker+=' # changed';});
    mutate('stable-map-order',f=>{f.variants[0].parameters={other:2,hidden:1};});
    mutate('unrelated',f=>{
      f.variants[0].fingerprint='definition-after';
      f.variants.unshift({...clone(record),id:'other-id',question:'Other question: _[2].',parameters:{hidden:2}});
    });
    const rules={mode:'equivalent',reject:'sin',tolerance:'0.1',decplaces:'3',sigfigs:'4',
      form:'expanded',vars:'x',packages:'numpy',response:'changed-source',
      'partial-credit':'true','form-credit':'0.2',vecdir:'row','field-labels':'named-answer'};
    for(const [key,value] of Object.entries(rules)) mutate('rule-'+key,f=>{f.options[key]=value;});
    await writeFile(path.join(dir,'fixtures.json'),JSON.stringify(fixtures));
    // Freeze the generator's already-resolved records so each mutation reaches
    // the production Lua renderer without Python or an unrelated generator change.
    await writeFile(path.join(dir,'_extensions/math-exercise/variants.lua'),
      'local f=assert(io.open("fixtures.json","r"));local fixtures=quarto.json.decode(f:read("*a"));f:close()\n'
      +'return {generate=function(raw,question,opts) return fixtures[opts.label] end}\n');
    let body='---\nfilters: [math-exercise]\nmath-exercise:\n  feedback: false\n---\n\n';
    for(const name of Object.keys(fixtures)) body+='```{math-exercise}\n#| label: '+name+'\nQuestion.\n```\n\n';
    for(const [name,checker,tolerance,question] of [
      ['plain-base','return True','0','First _[1].\n---\nSecond _[2].'],
      ['plain-checker','return False','0','First _[1].\n---\nSecond _[2].'],
      ['plain-tolerance','return True','1','First _[1].\n---\nSecond _[2].'],
      ['plain-reordered','return True','0','Second _[2].\n---\nFirst _[1].']
    ]) body+='```{math-exercise}\n#| label: '+name+'\n#| pool: true\n#| mode: custom\n#| checker: '+checker+'\n#| tolerance: '+tolerance+'\n'+question+'\n```\n\n';
    await writeFile(path.join(dir,'fixture.qmd'),body);
    const rendered=spawnSync(quarto,['render','fixture.qmd','--to','html'],{cwd:dir,env:renderEnv,encoding:'utf8',timeout:120000});
    assert.equal(rendered.status,0,rendered.stderr);
    const document=new JSDOM(await readFile(path.join(dir,'fixture.html'),'utf8')).window.document;
    const cells=[...document.querySelectorAll('.math-exercise-cell')];
    const variants=Object.fromEntries(cells.map(cell=>[cell.dataset.label,JSON.parse(cell.dataset.storageVariants)]));
    const original=variants.base[0];
    assert.equal(variants['stable-map-order'][0].hash,original.hash);
    assert.equal(variants.unrelated.find(v=>v.id==='stable-id').hash,original.hash);
    for(const name of ['parameters','derived','checker',...Object.keys(rules).map(k=>'rule-'+k)]) {
      assert.notEqual(variants[name][0].hash,original.hash,name+' must invalidate a saved variant');
      assert.equal(variants[name][0].id,'stable-id',name+' keeps matching the same variant id');
    }
    assert.notEqual(variants['plain-checker'][0].hash,variants['plain-base'][0].hash);
    assert.notEqual(variants['plain-tolerance'][0].hash,variants['plain-base'][0].hash);
    assert.equal(variants['plain-reordered'][1].hash,variants['plain-base'][0].hash);
  } finally {await rm(dir,{recursive:true,force:true});}
});

