import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../_extensions/math-exercise/variants-board.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(markup='<iframe id="A"></iframe><iframe id="B"></iframe>'){
 const dom=new JSDOM(markup,{url:'https://course.test/page',runScripts:'outside-only'}),w=dom.window,errors=[],tasks=new Map();let id=0;
 w.requestAnimationFrame=fn=>{tasks.set(++id,fn);return id;};w.cancelAnimationFrame=id=>tasks.delete(id);w.eval(source);
 const posts=new Map();function watch(frame){const rows=[];posts.set(frame,rows);frame.contentWindow.postMessage=(data,origin)=>rows.push({data,origin});return rows;}
 for(const frame of w.document.querySelectorAll('iframe'))watch(frame);
 return {dom,w,errors,watch,posts,flush(){const batch=[...tasks.values()];tasks.clear();batch.forEach(fn=>fn());},attach(options){return w.MathExerciseBoards.attach({label:'q',boards:['A'],getVariant:()=>({n:4,id:'v4',values:{a:2}}),onError:error=>errors.push(error),...options});}};
}
const variants=rows=>rows.filter(row=>row.data.protocol==='ctm-variant');
test('ready resend validates actual frame source and label, including opaque origins',()=>{
 const f=fixture(),a=f.w.document.getElementById('A'),b=f.w.document.getElementById('B'),handle=f.attach();
 const rows=f.posts.get(a),before=rows.length;
 const ready=(source,label='q')=>f.w.dispatchEvent(new f.w.MessageEvent('message',{data:{protocol:'ctm-variant',type:'ready',label,assessmentId:'A'},source,origin:'null'}));
 ready(b.contentWindow);ready(a.contentWindow,'other');assert.equal(rows.length,before);
 ready(a.contentWindow);assert.equal(rows.length,before+2);assert.equal(f.posts.get(b).length,0);
 assert.ok(rows.every(row=>row.origin==='*'));handle.dispose();f.dom.window.close();
});
test('values pass through unchanged; frame/title/clone failures stay local and do not block siblings',()=>{
 const f=fixture(),a=f.w.document.getElementById('A'),b=f.w.document.getElementById('B');
 const values={fraction:'1/3',list:[2,'sqrt(2)']};let current={n:null,id:'proposal-a',values};
 const handle=f.attach({boards:['A','B'],getVariant:()=>current,title:variant=>'Question — '+variant.id});
 assert.equal(variants(f.posts.get(a))[0].data.values,values);assert.equal(a.title,'Question — proposal-a');
 a.contentWindow.postMessage=()=>{throw new Error('frame unavailable');};current={n:9,id:'approved',values};
 const count=f.posts.get(b).length;assert.equal(handle.changed(),1);assert.equal(f.posts.get(b).length,count+2);assert.equal(f.errors.length,1);
 const failing=f.attach({getVariant(){throw new Error('optional values unavailable');}});assert.equal(failing.changed(),0);
 assert.ok(f.errors.some(error=>/values unavailable/.test(error.message)));failing.dispose();handle.dispose();f.dom.window.close();
});
test('tab/reveal rendering-phase resends and lazy frame replacement retain only live destinations',async()=>{
 const f=fixture(''),handle=f.attach();assert.equal(handle.changed(),0);
 const a=f.w.document.createElement('iframe');a.id='A';f.w.document.body.append(a);const first=f.watch(a);await tick();assert.ok(first.length);
 let before=first.length;f.w.document.dispatchEvent(new f.w.Event('shown.bs.tab'));assert.equal(first.length,before);f.flush();assert.equal(first.length,before+2);
 before=first.length;f.w.document.dispatchEvent(new f.w.Event('toggle'));f.flush();assert.equal(first.length,before+2);
 const old=a.contentWindow,replacement=f.w.document.createElement('iframe');replacement.id='A';a.replaceWith(replacement);const next=f.watch(replacement);await tick();assert.ok(next.length);
 before=next.length;f.w.dispatchEvent(new f.w.MessageEvent('message',{source:old,origin:'null',data:{protocol:'ctm-variant',type:'ready',label:'q'}}));assert.equal(next.length,before);
 handle.dispose();replacement.dispatchEvent(new f.w.Event('load'));f.w.document.dispatchEvent(new f.w.Event('shown.bs.tab'));f.flush();assert.equal(next.length,before);f.dom.window.close();
});
test('missing frames and invalid variant numbers never throw or invent variant zero',()=>{
 const f=fixture(),handle=f.attach({boards:['missing']});assert.equal(handle.changed(),0);
 const bad=f.attach({getVariant:()=>({n:0,id:'bad',values:{}})});assert.equal(bad.changed(),0);
 assert.equal(variants(f.posts.get(f.w.document.getElementById('A'))).length,0);assert.ok(f.errors.length);
 const invalid=f.w.MathExerciseBoards.attach({label:'q',boards:[null],onError:()=>{throw Error('bad reporter');}});assert.equal(invalid.changed(),0);
 invalid.dispose();bad.dispose();handle.dispose();f.dom.window.close();
});
