// Check completion sequencing using a minimal DOM and mocked network responses.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {classify}=require('../verify-sites.cjs');
assert.equal(classify('SynthID not detected\nC2PA detected','openai'),'detected');
assert.equal(classify('No signals detected','openai'),'not_detected');
assert.equal(classify('No Claude content credential found.','claude'),'not_detected');
assert.equal(classify('Claude content credential detected','claude'),'detected');
assert.equal(classify('What does a detected signal mean?\nimage called No signals detected.png','openai'),'inconclusive');
assert.equal(classify('Unexpected new provider wording','claude'),'inconclusive');
assert.equal(classify('C2PA\nNot detected\nSynthID\nDetected','openai'),'detected');
assert.equal(classify('C2PA not detected\nSynthID checking','openai'),'inconclusive');
assert.equal(classify('We didn’t find any signs this file was processed by Claude.\nThat doesn’t rule it out.','claude'),'not_detected');

function element(){return {style:{setProperty(){}},classList:{toggle(){}},children:[],attributes:{},handlers:{},textContent:'',
  addEventListener(name,handler){this.handlers[name]=handler;},setAttribute(name,value){this.attributes[name]=value;},append(...children){this.children.push(...children);},
  replaceChildren(){this.children=[];},querySelector(){return element();},scrollTo(){}};}
const elements=new Map();
const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},
  createElement:element,createElementNS:element,querySelectorAll:()=>[]};
const storage=new Map();
const context=vm.createContext({document,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  window:{addEventListener(){}},crypto:{randomUUID:()=> 'qa-job'},setInterval(){},console,Date,URLSearchParams});
// Load the real functions without automatic page startup or event wiring.
const app=fs.readFileSync(require.resolve('../static/app.js'),'utf8').replace(/^import .*;$/gm,'').split("$('processView').onclick=")[0];
vm.runInContext(app,context);
const final={filename:'final.png',type:'output'};
let checks=0;
const providers=[{id:'claude',name:'Claude',url:'https://claude.com/check-files',outcome:'not_detected',message:'No credential'},
  {id:'openai',name:'OpenAI',url:'https://openai.com/research/verify/',outcome:'checking',message:'Checking'},
  {id:'google',name:'Google',url:'https://synthid.com/',outcome:'manual',message:'Manual check'}];
context.fetch=async url=>({ok:true,text:async()=>JSON.stringify(url.includes('/history/') ?
  {'qa-job':{outputs:{'62':{images:[final]}},status:{completed:true,status_str:'success'}}} :
  {prompt_id:'qa-job',status:++checks===1?'checking':'complete',providers:checks===1?providers:providers.map(p=>p.id==='openai'?{...p,outcome:'unavailable',message:'The site took too long to respond.',evidence:'openai.png'}:p)})});
(async()=>{
  vm.runInContext("state.promptId='qa-job';state.running=true;state.started=Date.now();state.input={filename:'input.png'};",context);
  vm.runInContext(`state.graph={nodes:[
    {id:'62',label:'Save final image',tool:'ComfyUI',stage:5},
    {id:'verify-claude',label:'Check Claude',tool:'Claude',stage:6,details:{}},
    {id:'verify-openai',label:'Check OpenAI',tool:'OpenAI',stage:6,details:{}},
    {id:'verify-google',label:'Check Google SynthID',tool:'Google SynthID',stage:6,manual:true,details:{}},
    {id:'verify-report',label:'Save verification report',tool:'Synth Forge',stage:7,details:{}}
  ],edges:[{from:'62',to:'verify-claude'},{from:'verify-claude',to:'verify-openai'},
    {from:'62',to:'verify-google',manual:true},{from:'verify-openai',to:'verify-report'}]};
    state.states['62']={status:'finished'};layoutGraph();`,context);
  await vm.runInContext('loadResult()',context);
  assert.equal(vm.runInContext('state.phase',context),'verification');
  assert.equal(vm.runInContext('state.running',context),true);
  assert.equal(document.getElementById('runButton').disabled,true);
  assert.equal(document.getElementById('outputImage').hidden,false);
  assert.equal(vm.runInContext("state.states['verify-openai'].status",context),'running');
  assert.equal(vm.runInContext("state.states['verify-google'].status",context),'manual');
  assert.equal(document.getElementById('toolTitle').textContent,'Check OpenAI');
  assert.equal(document.getElementById('overallProgress').style.width,'50%');
  assert.ok(document.getElementById('graph').children.some(e=>e.attributes.class==='node-card running'));
  await vm.runInContext('loadResult()',context);
  assert.equal(vm.runInContext('state.running',context),false);
  assert.equal(document.getElementById('runStatus').textContent,'Image complete');
  assert.match(document.getElementById('runDetail').textContent,/Select a verification node for details/);
  assert.doesNotMatch(document.getElementById('toolDescription').textContent,/unavailable|too long/i);
  assert.equal(JSON.parse(storage.get('synth-forge-session-v1')).verification.status,'complete');
  assert.equal(checks,2);
  assert.equal(vm.runInContext("state.states['verify-openai'].status",context),'finished');
  assert.equal(vm.runInContext("state.states['verify-openai'].outcome",context),'unavailable');
  assert.equal(vm.runInContext("state.states['verify-report'].status",context),'finished');
  assert.equal(vm.runInContext("state.states['verify-google'].status",context),'manual');
  assert.equal(document.getElementById('overallProgress').style.width,'100%');
  const persisted=JSON.parse(storage.get('synth-forge-session-v1'));
  assert.equal(persisted.states['verify-google'].status,'manual');
  assert.equal(persisted.verification.providers.find(p=>p.id==='openai').outcome,'unavailable');
  const card=document.getElementById('graph').children.find(e=>e.attributes['aria-label']==='Check OpenAI: Done');
  assert.equal(card.attributes.class,'node-card finished');
  assert.ok(card.children.some(e=>e.textContent==='✓ Done'));
  card.handlers.click();
  assert.match(document.getElementById('toolDescription').textContent,/No verification result returned/);
  assert.match(document.getElementById('toolDescription').textContent,/The site took too long to respond/);
  assert.equal(document.getElementById('nodeActions').hidden,false);
  assert.equal(document.getElementById('nodeActions').children.length,2);
  assert.ok(document.getElementById('nodeActions').children.some(e=>e.textContent==='View captured result ↗'));
  vm.runInContext("showTool('verify-report')",context);
  assert.ok(document.getElementById('nodeActions').children.some(e=>e.textContent==='↓ Save report'));
  assert.ok(!fs.readFileSync(require.resolve('../static/index.html'),'utf8').includes('id="verificationPanel"'));
  context.fetch=async()=>({ok:false,status:404,text:async()=>'404: Not Found'});
  vm.runInContext("state.running=true;state.phase='verification';state.verification=null;",context);
  await vm.runInContext('verifyResult()',context);
  assert.equal(vm.runInContext('state.running',context),false);
  assert.equal(document.getElementById('runStatus').textContent,'Image complete');
  assert.match(document.getElementById('runDetail').textContent,/Select a verification node/);
  assert.equal(vm.runInContext("state.states['verify-claude'].status",context),'finished');
  assert.equal(vm.runInContext("state.states['verify-report'].status",context),'finished');
  vm.runInContext("showTool('verify-claude')",context);
  assert.match(document.getElementById('toolDescription').textContent,/Restart Synth Forge/);
  const restoredGraph=vm.runInContext('state.graph',context);
  context.WebSocket={OPEN:1,CONNECTING:0};
  context.fetch=async url=>({ok:true,text:async()=>JSON.stringify(url==='/api/health' ?
    {ready:true,verification:true,devices:[]} : url==='/api/graph' ? restoredGraph :
    {prompt_id:'qa-job',status:'complete',message:'Saved verification pass finished.',providers:providers.map(p=>p.id==='openai'?{...p,outcome:'unavailable'}:p)})});
  vm.runInContext('state.graph=null;state.socket={readyState:1};',context);
  await vm.runInContext('health()',context);
  assert.equal(vm.runInContext('state.verification.status',context),'complete');
  assert.equal(vm.runInContext("state.states['verify-claude'].outcome",context),'not_detected');
  assert.equal(document.getElementById('notice').hidden,true);
  assert.match(document.getElementById('runDetail').textContent,/Select a verification node/);
  console.log('Verification completion labels, click-only details, retained outcomes, report access, and lifecycle passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
