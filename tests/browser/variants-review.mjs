// Actual installed native wrapper + loopback helper + Chromium, no CDN/grader.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../..',import.meta.url));
const folder=mkdtempSync(join(tmpdir(),'ctm-connected-review-'));
const python=process.env.QUARTO_PYTHON||'python';
const checker=process.env.CTM_CHECKERS_EXTENSION;
const nativeSource=process.env.CTM_NATIVE_AUTHORING_SOURCE;
assert.ok(checker&&nativeSource,'CTM_CHECKERS_EXTENSION and CTM_NATIVE_AUTHORING_SOURCE required');
function run(args){const r=spawnSync(python,args,{encoding:'utf8',env:process.env});assert.equal(r.status,0,r.stderr);return r.stdout;}
const prepare=`
import sys,shutil
from pathlib import Path
folder,component,checkers,native=map(Path,sys.argv[1:])
target=folder/'_extensions/math-exercise';shutil.copytree(component,target)
checker=folder/'_extensions/ctm-checkers';checker.mkdir()
for name in ['checkers.json','_extension.yml']:
 shutil.copy2(checkers/name,checker/name)
for wheel in checkers.glob('*.whl'):shutil.copy2(wheel,checker/wheel.name)
sys.path.insert(0,str(native/'tools'))
from build_authoring import produce
produce(checker/'native-authoring',root=native)
(folder/'lesson.qmd').write_text('''~~~{math-exercise}
#| label: q
#| variables: |
#|   a = pick([1, 2])
#| field-labels: Answer
#| note: a={#a#}
_[{#a#}]
~~~
''')
`;
let browser,child;
try{
 run(['-c',prepare,folder,join(root,'_extensions/math-exercise'),checker,nativeSource]);
 const wrapper=join(folder,'_extensions/math-exercise/question-variants.py');
 const command=[wrapper,'--project',folder,'--file','lesson.qmd','--label','q'];
 const initial=JSON.parse(run([...command,'generate25more']));
 assert.equal(initial.records.length,2);
 child=spawn(python,[join(folder,'_extensions/math-exercise/variants-review.py'),'--project',folder,'--file','lesson.qmd','--label','q','--no-browser'],{env:process.env});
 let stderr='';child.stderr.on('data',c=>stderr+=c);
 const url=await new Promise((resolve,reject)=>{
  let output='';const deadline=setTimeout(()=>reject(new Error('helper launch timeout '+stderr)),15000);
  child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+\//);if(match){clearTimeout(deadline);resolve(match[0]);}});
  child.on('exit',code=>{clearTimeout(deadline);reject(new Error('helper exit '+code+' '+stderr));});
 });
 const {chromium}=await import(process.env.CTM_PLAYWRIGHT_MODULE||'playwright');
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(url);
 assert.match(await page.locator('h1 + p').textContent(),/Connected local review/);
 assert.equal(await page.locator('#download').isVisible(),false);
 const before=JSON.parse(run([...command,'review']));
 const record=before.records[0];
 const approved=page.locator('button[data-index="0"][data-status="approved"]');
 await Promise.all([page.waitForEvent('load'),approved.click()]);
 assert.match(await page.locator('#status').textContent(),/Saved.*rebuilt/);
 const after=JSON.parse(run([...command,'review']));
 assert.equal(after.manifest.decisions.length,1);
 assert.equal(after.manifest.decisions[0].status,'approved');
 const stale=await page.evaluate(async({url,lease,record})=>{
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseHash:lease,decisions:[{id:record.id,hash:record.hash,status:'approved'}]})});return response.status;
 },{url,lease:before.baseHash,record});
 assert.equal(stale,409,'stale browser decision rejected');
 assert.equal(JSON.parse(run([...command,'review'])).baseHash,after.baseHash);
 const source=join(folder,'lesson.qmd');writeFileSync(source,readFileSync(source,'utf8').replace('_[{#a#}]','_[{#a + 1#}]'));
 await page.locator('button[data-index="1"][data-status="approved"]').click();
 await page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Save not confirmed:'));
 assert.equal(await page.locator('button[data-index="1"][data-status="approved"]').isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:'Rebuild review'}).isEnabled(),true);
 assert.equal(JSON.parse(run([...command,'review'])).manifest.decisions.length,1,'changed source cannot approve stale candidate');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:7,scope:'installed canonical native wrapper, connected local review browser save, rebuild, stale lease/source rejection; no browser grading',pageErrors:errors},null,2));
}finally{
 if(browser)await browser.close();
 if(child){child.kill('SIGTERM');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));}
 rmSync(folder,{recursive:true,force:true});
}
