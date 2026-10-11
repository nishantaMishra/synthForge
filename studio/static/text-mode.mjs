const sessionFields=['input','output','promptId','started','ended','states','log','runSettings','phase','verification'];
const textStages=['01 Read','02 Model','03 Edit','04 Meaning','05 Save','06 Verify','07 Report'];
const imageStages=['01 Prepare','02 Load models','03 Reconstruct','04 Detect regions','05 Refine','06 Save','07 Verify','08 Report'];

export function createTextMode(api) {
  const {state,$,request,persist,notice,log,renderLog,renderGraph,layoutGraph,showTool,followNode,updateButtons,setStatus,finish,syncVerificationGraph,updateGraphProgress,configureInputGraph}=api;
  let polling=false, loadingOutput=null, restoredInput=null, cancelPending=false;
  state.sessions ||= {};
  state.textOptions ||= {model:null,edit_limit:.12};

  function render() {
    if(state.media!=='text')return;
    $('textInputPreview').value=state.input?.text?.slice(0,50000) || '';
    $('textInputName').textContent=state.input?.filename || 'No text file selected';
    $('textInputSize').textContent=state.input ? `${state.input.words} words · ${state.input.characters} characters`:'—';
    $('textUploadHint').hidden=!!state.input;
    $('textInputPreview').hidden=!state.input;
    $('textOutputPreview').value=state.output?.text?.slice(0,50000) || '';
    $('textOutputHint').hidden=!!state.output;
    $('textOutputPreview').hidden=!state.output;
    $('textOutputName').textContent=state.output?.filename || (state.running?'Processing your text':'Waiting for a run');
    $('textOutputSize').textContent=state.output ? `${state.output.words} words · ${state.output.characters} characters`:'—';
    $('downloadText').hidden=!state.output;
    if(state.output){$('downloadText').href=`/api/text/jobs/${state.promptId}/output`;$('downloadText').download=state.output.filename;}
    $('textDiff').replaceChildren();
    for(const span of state.output?.diff || []) {
      const element=document.createElement(span.kind==='removed'?'del':span.kind==='added'?'ins':'span');
      element.textContent=span.text;$('textDiff').append(element);
    }
    $('textCompareHint').hidden=!!state.output;
    $('textDiff').hidden=!state.output;
    const truncated=(state.input?.text?.length || state.input?.characters || 0)>50000 || (state.output?.text?.length || 0)>50000 || state.output?.preview_truncated;
    $('textPreviewNote').hidden=!truncated;
    $('textCompareSummary').textContent=state.output ? `${state.output.changed_passages} passage(s) changed · additions in green, removals struck through`:'Changes appear here';
  }

  function applyWorkspace() {
    const text=state.media==='text';
    $('imageWorkspace').hidden=text;$('textWorkspace').hidden=!text;
    $('settings').hidden=text;$('settingsButton').hidden=text;
    $('textSettings').hidden=!text;
    $('workspaceEyebrow').textContent=text?'TEXT WORKSPACE':'IMAGE WORKSPACE';
    $('graphTitle').textContent=text?'Follow the text workflow':'Watch your image take shape';
    $('graphEmptyTitle').textContent=text?'The graph unfolds as your text runs':'The graph unfolds as your image runs';
    $('graphEmptyDescription').textContent=text?'Each step appears as it runs. Connections follow the text through editing, meaning checks, and verification.':'Each tool appears when it starts working. Connections show how the image travels between steps.';
    $('workspaceTitle').textContent=text?'Your text. Small, reviewable edits.':'Your image. Every step, visible.';
    $('workspaceDescription').textContent=text?'Light edits, a comparison you can review, and a local Desklib check.':'Follow the reconstruction as it happens, or keep your focus on the result.';
    $('workflowName').textContent=text?'Text reconstruction':'Image reconstruction';
    $('workflowDescription').textContent=text?'Light wording edits → meaning checks → text file → Desklib':'Reconstruction → final image → provenance checks';
    $('engineBanner').hidden=true;
    $('footerProcessing').textContent=text?'Text processing and Desklib scoring run locally':'Generation runs locally · final image checked with Claude and uploaded to OpenAI for verification';
    for(const media of ['image','text']) {
      $(media+'Mode').classList.toggle('selected',media===state.media);
      $(media+'Mode').setAttribute('aria-pressed',String(media===state.media));
    }
    const stages=text?textStages:imageStages;
    document.querySelectorAll('.stages span').forEach((span,index)=>{span.hidden=index>=stages.length;span.textContent=stages[index] || '';span.classList.toggle('active',false);});
    if(text)render();else api.renderImages();
    renderLog();updateButtons();
  }

  async function health() {
    if(state.media!=='text')return;
    const info=await request('/api/text/health');
    if(state.media!=='text')return;
    state.ready=info.ready;state.cpuMode=false;
    $('connectionText').textContent=info.message;$('connectionDot').classList.toggle('ready',info.ready);
    $('deviceName').textContent='Local text engine · CPU';
    const select=$('textModel'), selected=state.textOptions.model || info.default_model;
    if([...select.options].map(option=>option.value).join('|')!==(info.models || []).join('|')) {
      select.replaceChildren();
      for(const model of info.models || []){const option=document.createElement('option');option.value=model;option.textContent=model;select.append(option);}
    }
    select.value=(info.models || []).includes(selected)?selected:info.default_model || '';
    state.textOptions.model=select.value;
    $('textEditLimit').value=100*state.textOptions.edit_limit;
    if(!state.graph) {
      const graph=await request('/api/text/graph');
      if(state.media!=='text')return;
      state.graph=graph;layoutGraph();renderGraph();syncVerificationGraph();
    }
    if(state.input && restoredInput!==state.input.id) {
      restoredInput=state.input.id;
      try {state.input=await request(`/api/text/uploads/${state.input.id}`);render();persist();}
      catch(error){notice(error.message);}
    }
    if(state.promptId && (state.running || (state.output && loadingOutput!==state.promptId))) await poll();
    updateButtons();
  }

  async function switchTo(media) {
    if(state.running || !['text','image'].includes(media) || media===state.media)return;
    state.sessions[state.media]=Object.fromEntries(sessionFields.map(field=>[field,state[field]]));
    const session=state.sessions[media] || {input:null,output:null,promptId:null,started:null,ended:null,states:{},log:[],phase:'generation',verification:null};
    for(const field of sessionFields)state[field]=session[field] ?? (field==='states'?{}:field==='log'?[]:null);
    state.media=media;state.graph=null;state.current=null;state.ready=false;state.cpuMode=false;
    loadingOutput=null;restoredInput=null;
    notice();$('graph').replaceChildren();$('graphEmpty').hidden=true;
    $('overallProgress').style.width='0%';$('elapsed').textContent='00:00';
    applyWorkspace();persist();
    setStatus(state.output ? (media==='text'?'Text complete':'Image complete'):'Ready when you are',state.input?.filename || 'Choose a file to begin');
    await api.health();
  }

  async function upload(file) {
    if(!file || state.running)return;
    if(!/\.(txt|md|text)$/i.test(file.name))return notice('Choose a .txt, .md, or .text file.');
    if(file.size>2*1024**2)return notice('Choose a text file no larger than 2 MB.');
    notice();setStatus('Reading text file',file.name);
    try {
      const body=new FormData();body.append('file',file);
      const input=await request('/api/text/upload',{method:'POST',body});
      if(state.media!=='text')return;
      state.input=input;state.output=null;state.promptId=null;state.states={};state.log=[];state.verification=null;
      state.started=null;state.ended=null;state.current=null;loadingOutput=null;restoredInput=input.id;
      render();renderGraph();renderLog();updateButtons();
      setStatus('Ready to run',input.filename);log('Text file uploaded',`${input.words} words · ${input.encoding}`);persist();
    } catch(error){notice(error.message);setStatus('Upload failed','Choose a supported text file.');}
  }

  async function run() {
    if(state.running || !state.input || !state.ready)return;
    const edit_limit=Number($('textEditLimit').value)/100, model=$('textModel').value;
    if(!Number.isFinite(edit_limit) || edit_limit<0 || edit_limit>1 || !model)return notice('Select a model and a wording-change limit from 0 to 100%.');
    state.textOptions={model,edit_limit};state.running=true;state.started=Date.now();state.ended=null;
    cancelPending=false;state.current=null;
    state.output=null;state.promptId=null;state.states={};state.log=[];state.verification=null;state.phase='text';
    render();renderGraph();updateButtons();notice();setStatus('Queued','Waiting for the local text engine');persist();
    $('nodeActions').hidden=true;$('toolDetails').hidden=true;
    $('toolTitle').textContent='Waiting for the text engine';$('toolDescription').textContent='Preparing a conservative edit of your text file.';
    try {
      const report=await request('/api/text/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input_id:state.input.id,model,edit_limit})});
      state.promptId=report.id;persist();if(cancelPending)await stop();else await poll();
    }catch(error){finish('Text processing failed',error.message,true);}
  }

  async function poll() {
    if(polling || state.media!=='text' || !state.promptId)return;
    polling=true;
    const identifier=state.promptId;
    try {
      const report=await request(`/api/text/jobs/${identifier}`);
      if(state.media!=='text' || state.promptId!==identifier)return;
      for(const [id,node]of Object.entries(report.nodes)) {
        if(state.states[id]?.status!==node.status && node.status!=='running')log(`${state.graph?.nodes.find(n=>n.id===id)?.label || id} · ${node.status==='finished'?'done':node.status}`,'Select the node for details.');
        state.states[id]={status:node.status,message:node.message,value:node.details?.value,max:node.details?.max,outcome:node.details?.outcome};
        const description=state.graph?.nodes.find(n=>n.id===id);
        if(description)description.details={...description.details,...node.details};
      }
      state.verification=report.verification || null;
      if(report.verification)syncVerificationGraph();else {renderGraph();updateGraphProgress();}
      if(state.running && report.current) {
        const changed=state.current!==report.current;state.current=report.current;showTool(report.current,true);
        if(changed)followNode(report.current);
        const node=state.graph?.nodes.find(n=>n.id===report.current);
        document.querySelectorAll('.stages span').forEach((span,index)=>span.classList.toggle('active',index===node?.stage));
        setStatus(report.status==='checking'?'Checking text':'Processing text',node?.label || 'Working');
      }
      if(report.output && loadingOutput!==identifier) {
        loadingOutput=identifier;
        const preview=await request(`/api/text/jobs/${identifier}/preview`);
        if(state.media==='text' && state.promptId===identifier){state.output={...report.output,...preview};render();}
      }
      if(state.media!=='text' || state.promptId!==identifier)return;
      if(state.running && ['complete','error','cancelled'].includes(report.status)) {
        finish(report.status==='complete'?'Text complete':report.status==='cancelled'?'Run stopped':'Text processing failed',report.message,report.status==='error');
      }
      persist();
    } catch(error){if(state.promptId===identifier){loadingOutput=null;notice(error.message);}}
    finally{polling=false;}
  }

  async function stop() {
    if(!state.promptId){cancelPending=true;setStatus('Stopping run','Cancelling the text job as soon as it is queued.');return;}
    await request(`/api/text/jobs/${state.promptId}/cancel`,{method:'POST'});await poll();
  }

  $('imageMode').onclick=()=>switchTo('image').catch(error=>notice(error.message));
  $('textMode').onclick=()=>switchTo('text').catch(error=>notice(error.message));
  $('chooseText').onclick=()=>$('textFileInput').click();
  $('textFileInput').onchange=event=>upload(event.target.files[0]);
  $('textDropZone').ondragover=event=>{event.preventDefault();};
  $('textDropZone').ondrop=event=>{event.preventDefault();upload(event.dataTransfer.files[0]);};
  $('textEditLimit').oninput=()=>{state.textOptions.edit_limit=Number($('textEditLimit').value)/100;persist();};
  $('textModel').onchange=()=>{state.textOptions.model=$('textModel').value;persist();};
  applyWorkspace();
  return {health,render,run,poll,stop,switchTo};
}
