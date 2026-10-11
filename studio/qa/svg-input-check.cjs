const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function element(){const selectors=new Map();return {style:{setProperty(){}},classList:{toggle(){}},children:[],textContent:'',
  addEventListener(){},setAttribute(){},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},
  scrollTo(){},querySelector(selector){if(!selectors.has(selector))selectors.set(selector,element());return selectors.get(selector);}};}
const elements=new Map();
let canvas,decodeWait=null,decodes=0;
const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},
  querySelectorAll:()=>[],createElementNS:element,createElement(tag){
    if(tag!=='canvas')return element();
    canvas={getContext:()=>({drawImage(image){assert.equal(image.naturalWidth,680);}}),
      toBlob(callback,type){assert.equal(type,'image/png');callback(new Blob(['PNG fixture'],{type}));}};
    return canvas;
  }};
class SvgImage {naturalWidth=680;naturalHeight=560;decode(){decodes++;return decodeWait || Promise.resolve();}}
const storage=new Map();
const context=vm.createContext({document,Image:SvgImage,Blob,FormData,URLSearchParams,Date,console,
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  window:{addEventListener(){}},crypto:{randomUUID:()=> 'svg-qa-job'},setInterval(){}});
const source=fs.readFileSync(require.resolve('../static/app.js'),'utf8').replace(/^import .*;$/gm,'');
vm.runInContext(source.split("$('processView').onclick=")[0],context);
vm.runInContext(source.slice(source.indexOf("$('stopButton').onclick=async()=>{"),source.indexOf("$('revealButton').onclick=")),context);
for(const [id,value]of [['adaptiveLevel','6'],['denoiseMin','0.08'],['denoiseMax','0.15']])document.getElementById(id).value=value;
let uploads=0;
const submitted=[];
context.fetch=async(url,options)=>{
  if(url==='/comfy/upload/image'){
    uploads++;
    assert.equal(options.body.get('image').name,'smiling_monkey.png');
    assert.equal(options.body.get('image').type,'image/png');
    assert.equal(options.body.get('subfolder'),'studio/rendered');
    return {ok:true,text:async()=>JSON.stringify({name:'smiling_monkey.png',subfolder:'studio/rendered',type:'input'})};
  }
  if(url==='/api/run'){
    submitted.push(JSON.parse(options.body));
    return {ok:true,text:async()=>JSON.stringify({prompt_id:'svg-qa-job'})};
  }
  throw new Error('Unexpected request during SVG preparation: '+url);
};
(async()=>{
  vm.runInContext(`state.ready=true;state.socketReady=true;state.input={filename:'smiling_monkey.svg',subfolder:'studio',type:'input'};
    state.graph={nodes:[{id:'11',label:'Read input image',tool:'ComfyUI',stage:0,details:{}},
      {id:'62',label:'Save final image',tool:'ComfyUI',stage:5,details:{}}],edges:[{from:'11',to:'62'}]};configureInputGraph();`,context);
  assert.equal(vm.runInContext("describe('prepare-svg').label",context),'Rasterize SVG');
  assert.ok(vm.runInContext("state.graph.edges.some(e=>e.from==='prepare-svg'&&e.to==='11')",context));
  await vm.runInContext('startRun()',context);
  assert.equal(canvas.width,680);assert.equal(canvas.height,560);
  assert.equal(submitted[0].image,'studio/rendered/smiling_monkey.png');
  assert.equal(vm.runInContext('state.input.filename',context),'smiling_monkey.svg');
  assert.equal(vm.runInContext("state.states['prepare-svg'].status",context),'finished');
  const persisted=JSON.parse(storage.get('synth-forge-session-v1'));
  assert.equal(persisted.input.engineImage.filename,'smiling_monkey.png');
  vm.runInContext("event({type:'execution_error',data:{prompt_id:state.promptId,node_id:'11',node_type:'LoadImage',exception_message:'Fixture decoder failure'}})",context);
  assert.equal(vm.runInContext('state.running',context),false);
  assert.equal(document.getElementById('outputName').textContent,'Waiting for a run');
  assert.equal(document.getElementById('outputHint').querySelector('strong').textContent,'Your result appears here');
  await vm.runInContext('startRun()',context);
  assert.equal(uploads,1);assert.equal(decodes,1);
  assert.equal(vm.runInContext("state.states['prepare-svg'].status",context),'cached');
  vm.runInContext("finish('Run stopped','Fixture stop');delete state.input.engineImage;",context);
  let resume;
  decodeWait=new Promise(resolve=>{resume=resolve;});
  const pending=vm.runInContext('startRun()',context);
  assert.equal(vm.runInContext('state.phase',context),'preparation');
  assert.equal(await vm.runInContext('loadResult()',context),false);
  await document.getElementById('stopButton').onclick();
  resume();await pending;
  assert.equal(submitted.length,2,'Cancelled preparation must not submit an engine job');
  assert.equal(vm.runInContext('state.running',context),false);
  assert.equal(vm.runInContext("state.states['prepare-svg'].status",context),'cancelled');
  console.log('SVG input preparation, cached PNG reuse, cancellation, and failure UI passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
