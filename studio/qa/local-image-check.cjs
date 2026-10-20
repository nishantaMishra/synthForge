// Image completion and restoration must use only the local engine.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function element(){const children=new Map();return {style:{setProperty(){}},classList:{toggle(){},add(){},remove(){}},children:[],attributes:{},textContent:'',
  complete:false,naturalWidth:0,srcWrites:0,
  set src(value){this.attributes.src=value;this.srcWrites++;},get src(){return this.attributes.src;},
  getAttribute(name){return this.attributes[name] ?? null;},
  addEventListener(){},setAttribute(name,value){this.attributes[name]=value;},append(...children){this.children.push(...children);},
  replaceChildren(){this.children=[];},querySelector(selector){if(!children.has(selector))children.set(selector,element());return children.get(selector);},scrollTo(){}};}
const source=fs.readFileSync(require.resolve('../static/app.js'),'utf8').replace(/^import .*;$/gm,'').split("$('processView').onclick=")[0];
function setup(saved){
  const elements=new Map(),storage=new Map();
  if(saved)storage.set('synth-forge-session-v1',JSON.stringify(saved));
  const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},
    createElement:element,createElementNS:element,querySelectorAll:()=>[]};
  const context=vm.createContext({document,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    window:{addEventListener(){}},crypto:{randomUUID:()=> 'qa-job'},setInterval(){},console,Date,URLSearchParams,
    WebSocket:{OPEN:1,CONNECTING:0}});
  vm.runInContext(source,context);
  return {context,document,storage};
}
const final={filename:'final.png',type:'output'};
(async()=>{
  const {context,document,storage}=setup();
  const requests=[];
  let run={outputs:{'62':{images:[final]}},status:{completed:true,status_str:'success'}};
  context.fetch=async url=>{
    requests.push(url);
    assert.equal(url,'/comfy/history/qa-job','Image completion must not submit external checks');
    return {ok:true,text:async()=>JSON.stringify({'qa-job':run})};
  };
  vm.runInContext("state.promptId='qa-job';state.running=true;state.input={filename:'input.png'};",context);
  await vm.runInContext('loadResult()',context);
  assert.equal(vm.runInContext('state.running',context),false);
  assert.equal(vm.runInContext('state.output.filename',context),'final.png');
  assert.equal(document.getElementById('runStatus').textContent,'Image complete');
  assert.equal(document.getElementById('overallProgress').style.width,'100%');
  assert.equal(document.getElementById('outputImage').hidden,false);
  assert.equal(JSON.parse(storage.get('synth-forge-session-v1')).verification,null);
  assert.equal(requests.length,1);

  run={outputs:{},status:{completed:true,status_str:'success'}};
  vm.runInContext('state.running=true;state.output=null;',context);
  await vm.runInContext('loadResult()',context);
  assert.equal(document.getElementById('runStatus').textContent,'Unable to load result');
  assert.equal(vm.runInContext('state.running',context),false);

  run={status:{completed:true,status_str:'error',messages:[['execution_interrupted',{}]]}};
  vm.runInContext('state.running=true;',context);
  await vm.runInContext('loadResult()',context);
  assert.equal(document.getElementById('runStatus').textContent,'Run stopped');

  const legacy={media:'image',promptId:'qa-job',running:true,phase:'verification',input:{filename:'input.png'},output:final,
    states:{'62':{status:'finished'},'verify-claude':{status:'running'}},verification:{status:'checking'},
    sessions:{image:{phase:'verification',verification:{status:'checking'},states:{'verify-openai':{status:'pending'}}},
      text:{phase:'text',verification:{providers:[{id:'desklib',outcome:'not_detected'}]}}}};
  const restored=setup(legacy);
  restored.context.fetch=context.fetch;
  run={outputs:{'62':{images:[final]}},status:{completed:true,status_str:'success'}};
  assert.equal(vm.runInContext('state.phase',restored.context),'generation');
  assert.equal(vm.runInContext('state.verification',restored.context),null);
  assert.equal(vm.runInContext("state.states['verify-claude']",restored.context),undefined);
  assert.equal(vm.runInContext('state.sessions.image.verification',restored.context),null);
  assert.equal(vm.runInContext('state.sessions.text.verification.providers[0].id',restored.context),'desklib');
  await vm.runInContext('loadResult()',restored.context);
  assert.equal(restored.document.getElementById('runStatus').textContent,'Image complete');
  assert.equal(vm.runInContext('state.running',restored.context),false);

  // Reproduce a reload while the engine is down, followed by a healthy poll.
  const recovery=setup(),ctx=recovery.context,el=id=>recovery.document.getElementById(id);
  vm.runInContext("state.input={filename:'input.png'};state.output={filename:'final.png',type:'output'};state.graph={nodes:[],edges:[]};renderImages();",ctx);
  const imageIds=['inputImage','outputImage','compareBefore','compareAfter'];
  for(const id of imageIds){el(id).complete=true;el(id).onerror();}
  assert.equal(el('inputImage').hidden,true);
  assert.equal(el('outputImage').hidden,true);
  assert.equal(el('comparisonImages').hidden,true);
  assert.equal(el('compareSlider').disabled,true);
  vm.runInContext("noticeEngine('The image engine is not connected yet.');state.socket={readyState:1};",ctx);
  ctx.fetch=async()=>({ok:true,text:async()=>JSON.stringify({ready:true,devices:[{type:'cuda',name:'Local GPU'}]})});
  await vm.runInContext('health()',ctx);
  assert.equal(el('notice').hidden,true,'Clear only the stale connection warning');
  assert.equal(el('runButton').disabled,false);
  for(const id of imageIds){
    assert.equal(el(id).srcWrites,2,`Retry failed ${id} after the engine connects`);
    el(id).naturalWidth=640;el(id).naturalHeight=480;el(id).onload();
  }
  assert.equal(el('inputImage').hidden,false);
  assert.equal(el('inputSize').textContent,'640 × 480');
  assert.equal(el('outputImage').hidden,false);
  assert.equal(el('comparisonImages').hidden,false);
  assert.equal(el('downloadComparison').hidden,false);
  assert.equal(el('compareSlider').disabled,false);
  vm.runInContext("notice('Keep this unrelated run error');",ctx);
  await vm.runInContext('health()',ctx);
  assert.equal(el('notice').textContent,'Keep this unrelated run error');
  for(const id of imageIds)assert.equal(el(id).srcWrites,2,'Do not reload successful previews');
  ctx.fetch=async()=>({ok:true,text:async()=>JSON.stringify({ready:false,message:'Image engine stopped.'})});
  await vm.runInContext('health()',ctx);
  assert.equal(el('connectionText').textContent,'Engine stopped');
  assert.equal(el('runButton').disabled,true);
  assert.equal(vm.runInContext('state.socketReady',ctx),false);
  ctx.fetch=async()=>{throw new Error('Server disconnected');};
  await vm.runInContext('health()',ctx);
  assert.equal(el('connectionText').textContent,'Engine unavailable');
  assert.equal(el('runButton').disabled,true);
  console.log('Local image completion, cancellation, session restoration, preview recovery, and connection-state checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
