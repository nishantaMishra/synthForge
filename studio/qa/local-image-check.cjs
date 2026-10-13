// Image completion and restoration must use only the local engine.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function element(){return {style:{setProperty(){}},classList:{toggle(){}},children:[],attributes:{},textContent:'',
  addEventListener(){},setAttribute(name,value){this.attributes[name]=value;},append(...children){this.children.push(...children);},
  replaceChildren(){this.children=[];},querySelector(){return element();},scrollTo(){}};}
const source=fs.readFileSync(require.resolve('../static/app.js'),'utf8').replace(/^import .*;$/gm,'').split("$('processView').onclick=")[0];
function setup(saved){
  const elements=new Map(),storage=new Map();
  if(saved)storage.set('synth-forge-session-v1',JSON.stringify(saved));
  const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},
    createElement:element,createElementNS:element,querySelectorAll:()=>[]};
  const context=vm.createContext({document,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    window:{addEventListener(){}},crypto:{randomUUID:()=> 'qa-job'},setInterval(){},console,Date,URLSearchParams});
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
  console.log('Local image completion, missing output, cancellation, and legacy-session restoration passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
