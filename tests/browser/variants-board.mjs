// Focused real-browser figure transport check, with no CDN or grading engine.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const source=readFileSync(new URL('../../_extensions/math-exercise/variants-board.js',import.meta.url));
const output=resolve(process.env.CTM_BOARD_REPORT||'work/variants-board-browser.json');
const report={passed:false,scope:'actual browser optional figure transport only; no Python/grading/first-visit acceptance',helperSha256:createHash('sha256').update(source).digest('hex'),rawErrors:[],received:[],checks:[]};
const child=`addEventListener('message',function(event){
 if(event.source!==parent)return;var data=event.data;
 if(data.protocol==='ctm-variant'||data.protocol==='jsxgraph-quarto-assessment')parent.postMessage({protocol:'fixture',type:'received',payload:data},'*');
 if(data.protocol==='fixture-barrier')parent.postMessage({protocol:'fixture',type:'barrier',token:data.token},'*');
});
window.sendReady=function(label,claimed,token){parent.postMessage({protocol:'ctm-variant',type:'ready',label:label,assessmentId:claimed},'*');parent.postMessage({protocol:'fixture',type:'marker',token:token},'*');};
parent.postMessage({protocol:'fixture',type:'loaded'},'*');`;
const childHTML=JSON.stringify('<script>'+child+'</script>').replace(/</g,'\\u003c');
const html=`<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><script src="/variants-board.js"></script>
<button id="check">Ordinary control</button><details id="reveal"><summary>Figure</summary><iframe id="A" sandbox="allow-scripts" width="300" height="150"></iframe></details><iframe id="B" sandbox="allow-scripts"></iframe>
<script>
window.received=[];window.markers=[];window.barriers=[];window.loaded=[];window.reported=[];window.controlChecks=0;
document.getElementById('check').onclick=function(){controlChecks++;};
addEventListener('message',function(event){
 var frame=Array.from(document.querySelectorAll('iframe')).find(function(frame){return frame.contentWindow===event.source;});
 if(!frame||event.data.protocol!=='fixture')return;
 var row={frame:frame.id,origin:event.origin,...event.data};
 if(row.type==='received')received.push(row);else if(row.type==='marker')markers.push(row.token);else if(row.type==='barrier')barriers.push(row.token);else if(row.type==='loaded')loaded.push(row.frame);
});
document.getElementById('A').srcdoc=${childHTML};document.getElementById('B').srcdoc=${childHTML};
window.current={n:4,id:'v4',values:{fraction:'1/3',nested:[2,'sqrt(2)']}};
window.bridge=MathExerciseBoards.attach({label:'q',boards:['A'],getVariant:function(){return current;},title:function(v){return v.n===null?'Question — Not approved':'Question — Variant '+v.n;},onError:function(error){reported.push(String(error));}});
</script>`;
let browser,context;const server=http.createServer((request,response)=>{
 if(request.url==='/variants-board.js'){response.writeHead(200,{'Content-Type':'text/javascript','Content-Length':source.length});response.end(source);}
 else if(request.url==='/'){response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(html);}
 else {response.writeHead(404);response.end();}
});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const pw=await import(process.env.CTM_PLAYWRIGHT_MODULE||'playwright');
 browser=await pw.chromium.launch({headless:true,...(process.env.CTM_CHROMIUM_EXECUTABLE?{executablePath:process.env.CTM_CHROMIUM_EXECUTABLE}:{})});report.browser=browser.version();
 context=await browser.newContext();const page=await context.newPage();
 page.on('pageerror',error=>report.rawErrors.push(String(error)));page.on('console',message=>{if(message.type()==='error')report.rawErrors.push(message.text());});
 await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
 await page.waitForFunction(()=>loaded.includes('A')&&loaded.includes('B'));
 const frameA=await page.locator('#A').elementHandle().then(handle=>handle.contentFrame());
 const frameB=await page.locator('#B').elementHandle().then(handle=>handle.contentFrame());
 let token=0;
 async function barrier(){const next='barrier-'+(++token);await page.evaluate(next=>document.getElementById('A').contentWindow.postMessage({protocol:'fixture-barrier',token:next},'*'),next);await page.waitForFunction(next=>barriers.includes(next),next);}
 async function count(){return page.evaluate(()=>received.filter(row=>row.frame==='A'&&row.payload.protocol==='ctm-variant').length);}
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await barrier();
 const before=await count();
 await frameB.evaluate(()=>sendReady('q','A','foreign'));await page.waitForFunction(()=>markers.includes('foreign'));await barrier();
 assert.equal(await count(),before,'opaque sibling claiming target A cannot trigger A resend');report.checks.push('opaque sibling source spoof rejected');
 await frameA.evaluate(()=>sendReady('other','A','wrong-label'));await page.waitForFunction(()=>markers.includes('wrong-label'));await barrier();assert.equal(await count(),before);
 await frameA.evaluate(()=>sendReady('q','A','legitimate'));await page.waitForFunction(()=>markers.includes('legitimate'));await barrier();assert.ok(await count()>before);report.checks.push('legitimate source and label resend only A');
 await page.evaluate(()=>{current={n:null,id:'proposal-9',values:{fraction:'2/7',nested:[3,'sqrt(3)']}};bridge.changed();});await barrier();
 const latest=await page.evaluate(()=>received.filter(row=>row.frame==='A'&&row.payload.protocol==='ctm-variant').at(-1));
 assert.deepEqual(latest.payload,{protocol:'ctm-variant',label:'q',n:null,id:'proposal-9',values:{fraction:'2/7',nested:[3,'sqrt(3)']}});assert.equal(latest.origin,'null');report.checks.push('proposal null and caller values preserved through real structured clone');
 assert.equal(await page.locator('#A').getAttribute('title'),'Question — Not approved');report.checks.push('caller title updates without inventing a proposal number');
 const hiddenWidth=await page.locator('#A').evaluate(frame=>frame.getBoundingClientRect().width),layoutBefore=await page.evaluate(()=>received.filter(row=>row.payload.type==='layout').length);
 await page.locator('#reveal summary').click();await page.waitForFunction(()=>document.getElementById('A').getBoundingClientRect().width>0);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await barrier();
 assert.equal(hiddenWidth,0);assert.ok(await page.evaluate(()=>received.filter(row=>row.payload.type==='layout').length)>layoutBefore);report.checks.push('native details reveal resends variant and layout after rendering phase');
 const tabBefore=await count();await page.evaluate(()=>document.dispatchEvent(new Event('shown.bs.tab')));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));await barrier();assert.ok(await count()>tabBefore);report.checks.push('tab reveal layout resend');
 await page.evaluate(()=>{window.fault=MathExerciseBoards.attach({label:'q',boards:['missing','A'],getVariant:function(){throw Error('expected optional fixture failure');},onError:function(error){reported.push(String(error));}});fault.changed();});await page.locator('#check').click();
 assert.equal(await page.evaluate(()=>controlChecks),1);assert.ok((await page.evaluate(()=>reported)).some(text=>text.includes('expected optional')));report.checks.push('optional callback failure isolated from ordinary control');
 await page.evaluate(()=>{fault.dispose();bridge.dispose();});const disposed=await count();await frameA.evaluate(()=>sendReady('q','A','disposed'));await page.waitForFunction(()=>markers.includes('disposed'));await barrier();assert.equal(await count(),disposed);report.checks.push('disposed bridge stops ready resends');
 report.received=await page.evaluate(()=>received);report.reported=await page.evaluate(()=>reported);
 assert.ok(report.received.every(row=>row.frame==='A'),'unconfigured sibling never receives variant/layout');assert.deepEqual(report.rawErrors,[]);report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}
finally{if(context)await context.close();if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks,output,error:report.error}));}
