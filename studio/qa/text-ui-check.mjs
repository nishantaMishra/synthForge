import assert from 'node:assert/strict';
import {createTextMode} from '../static/text-mode.mjs';

function element(){return {children:[],hidden:false,value:'',textContent:'',style:{},classList:{toggle(){}},
  setAttribute(){},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},
  get options(){return this.children;},click(){}};}
const elements=new Map(), stages=Array.from({length:8},element);
const $=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
globalThis.document={createElement:element,querySelectorAll:()=>stages};
const image={filename:'original.png'}, imageOutput={filename:'processed.png'};
const state={media:'image',input:image,output:imageOutput,promptId:'image-job',states:{},log:[],started:1,ended:2,
  running:false,phase:'generation',sessions:{},textOptions:{model:null,edit_limit:.12}};
let model, requestCount=0;
const report={id:'text-job',status:'complete',message:'Your text is ready.',current:'verify-report',
  nodes:{'text-save':{status:'finished',details:{}},'verify-desklib':{status:'finished',details:{outcome:'not_detected'}}},
  output:{filename:'source-processed.txt',words:3,characters:17,changed_passages:1},
  verification:{providers:[{id:'desklib',outcome:'not_detected',message:'Fixture estimate'}]}};
const request=async path=>{
  requestCount++;
  if(path==='/api/text/health')return{ready:true,models:['qwen2.5:7b'],default_model:'qwen2.5:7b',message:'Local text engine ready'};
  if(path==='/api/text/graph')return{nodes:[{id:'text-save',label:'Save text',stage:4,details:{}},{id:'verify-desklib',label:'Check Desklib',stage:5,details:{}},{id:'verify-report',label:'Save report',stage:6,details:{}}],edges:[]};
  if(path==='/api/text/uploads/text-input')return{id:'text-input',filename:'source.txt',text:'Original wording.',words:2,characters:17};
  if(path==='/api/text/jobs/text-job')return report;
  if(path==='/api/text/jobs/text-job/preview')return{text:'Modified wording.',diff:[{kind:'removed',text:'Original'},{kind:'added',text:'Modified'},{kind:'same',text:' wording.'}]};
  throw new Error('Unexpected route: '+path);
};
const api={state,$,request,persist(){},notice(){},log(){},renderLog(){},renderGraph(){},layoutGraph(){},showTool(){},followNode(){},updateButtons(){},setStatus(){},syncVerificationGraph(){},updateGraphProgress(){},configureInputGraph(){},renderImages(){},
  finish(title,message){state.running=false;model.render();},async health(){if(state.media==='text')await model.health();}};
model=createTextMode(api);
await model.switchTo('text');
assert.equal($('imageWorkspace').hidden,true);
assert.equal($('textWorkspace').hidden,false);
assert.equal($('textSettings').hidden,false);
assert.equal($('textModel').value,'qwen2.5:7b');
state.input={id:'text-input',filename:'source.txt'};state.promptId='text-job';state.output={filename:'source-processed.txt'};
await model.health();
assert.equal($('textInputPreview').value,'Original wording.');
assert.equal($('textOutputPreview').value,'Modified wording.');
assert.equal($('downloadText').href,'/api/text/jobs/text-job/output');
assert.equal($('textDiff').children[0].textContent,'Original');
assert.equal($('textDiff').children[1].textContent,'Modified');
assert.equal(state.verification.providers[0].outcome,'not_detected');
const count=requestCount;
await model.health();
assert.equal(requestCount,count+1,'A completed output should not be re-polled every health check');
await model.switchTo('image');
assert.equal(state.input,image);
assert.equal(state.output,imageOutput);
assert.equal(state.promptId,'image-job');
assert.equal($('textWorkspace').hidden,true);
await model.switchTo('text');
assert.equal(state.input.id,'text-input');
state.running=true;
await model.switchTo('image');
assert.equal(state.media,'text','Workspace switching must be locked during a run');
console.log('Text workspace, preview/diff/download, restoration, and image-session isolation passed.');
