// Test requests exercise the installed shared API, never a consumer prompt implementation.
export function sharedTestApi(F, language='en', storage=null) {
 const request=(task,answer,assessment,contexts=[],level=1,visual)=>F.applyPolicy('math-exercise', {
   profile:'mathematics',task,responses:[{id:'answer',value:answer}],
   materials:contexts.map(c=>({id:c.id||'context',role:'context',text:c.text||c.content})),
   evidence:assessment?[{label:'Private assessment',text:assessment}]:[],feedback:{language},
   attachments:visual?.image?[{id:'graph',role:'response',dataUrl:visual.image}]:[]
 },level);
 return {
  sysPrompt:level=>F.buildMessages(request('Task','Answer','',[],level))[0].content,
  buildUserPrompt:(...args)=>F.buildMessages(request(...args))[1].content,
  callLLM:async(task,answer,assessment,contexts,level,cfg,visual)=>(await F.createClient(cfg,{storage}).request(request(task,answer,assessment,contexts,level,visual), {imageFallback:'text'})).text,
  modelPolicy:F.modelPolicy,
  loadCapability:(baseUrl,model)=>F.createClient({baseUrl,model},{storage}).loadCapability()
 };
}
