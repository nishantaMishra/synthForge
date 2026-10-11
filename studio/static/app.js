import {createTextMode} from './text-mode.mjs?v=text-workflow-2';
const $ = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';
const storageKey = 'synth-studio-session-v1';
let leavingPage = false;
window.addEventListener('pagehide', () => { leavingPage = true; });
const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
const settingsKey = 'synth-studio-settings-v1';
const savedSettings = JSON.parse(localStorage.getItem(settingsKey) || 'null');
const state = {clientId: saved?.clientId || crypto.randomUUID(), promptId: saved?.promptId || null,
  input: saved?.input || null, output: saved?.output || null, running: saved?.running || false,
  started: saved?.started || null, ended: saved?.ended || null, states: saved?.states || {},
  log: saved?.log || [], graph: null, current: null, ready: false, socketReady: false,
  socket: null, showAll: false, follow: true, zoom: 1, positions: {}, previewUrl: null,
  mode: localStorage.getItem('synth-studio-view') || 'process', cpuMode:false,
  runSettings:saved?.runSettings || null, phase:saved?.phase || 'generation', verification:saved?.verification || null};
let verificationLoading = false;
let textMode=null;
state.media=saved?.media || 'image';state.sessions=saved?.sessions || {};state.textOptions=saved?.textOptions || {model:null,edit_limit:.12};
const verificationCompletionText='Your result is ready. Select a verification node for details.';
const verificationOutcomeLabels={pending:'Waiting',checking:'Checking',detected:'Signal detected',not_detected:'No signal detected',
  unavailable:'No verification result returned',inconclusive:'Result needs review',manual:'Manual check needed',cancelled:'Check cancelled'};

function readSettings() {
  return {adaptive_level:Number($('adaptiveLevel').value),denoise_min:Number($('denoiseMin').value),denoise_max:Number($('denoiseMax').value)};
}
function saveSettings() {
  localStorage.setItem(settingsKey,JSON.stringify(readSettings()));
}
function applyRunSettings() {
  const node=describe('595');
  if (node && state.runSettings) node.details={...node.details,...state.runSettings};
}
function isSvgInput(input) {return /\.svg$/i.test(input?.filename || input?.name || '');}
function configureInputGraph() {
  if (!state.graph) return;
  state.graph.nodes=state.graph.nodes.filter(node=>node.id!=='prepare-svg');
  state.graph.edges=state.graph.edges.filter(edge=>edge.from!=='prepare-svg' && edge.to!=='prepare-svg');
  if (isSvgInput(state.input) && describe('11')) {
    state.graph.nodes.push({id:'prepare-svg',type:'SVGRasterization',label:'Rasterize SVG',tool:'Browser SVG renderer',stage:0,
      description:'Render the SVG to PNG pixels for the image engine while retaining the original SVG for preview.',
      details:{source:state.input.filename}});
    state.graph.edges.push({from:'prepare-svg',to:'11',input:'PNG image'});
  }
  layoutGraph();
}
async function prepareEngineInput(input) {
  if (!isSvgInput(input)) return input;
  if (input.engineImage) return input.engineImage;
  const image=new Image();image.src=imageUrl(input);
  await image.decode();
  const canvas=document.createElement('canvas');
  canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const context=canvas.getContext('2d');
  if (!context || !canvas.width || !canvas.height) throw new Error('The SVG could not be rendered into pixels.');
  context.drawImage(image,0,0);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value ? resolve(value) : reject(new Error('The SVG could not be converted to PNG.')),'image/png'));
  const data=new FormData();
  data.append('image',blob,(input.filename || input.name).replace(/\.svg$/i,'.png'));
  data.append('type','input');data.append('subfolder','studio/rendered');data.append('overwrite','false');
  const result=await request('/comfy/upload/image',{method:'POST',body:data});
  input.engineImage={...result,filename:result.name,width:canvas.width,height:canvas.height};
  if (state.input===input) persist();
  return input.engineImage;
}
const initialSettings = state.running ? state.runSettings || savedSettings : savedSettings;
if(initialSettings) for(const [id,key] of [['adaptiveLevel','adaptive_level'],['denoiseMin','denoise_min'],['denoiseMax','denoise_max']]) {
  if(initialSettings[key] !== undefined) $(id).value=initialSettings[key];
}
for(const id of ['adaptiveLevel','denoiseMin','denoiseMax']) $(id).addEventListener('input',saveSettings);

function persist() {
  localStorage.setItem(storageKey, JSON.stringify({clientId: state.clientId, promptId: state.promptId,
    input: state.input, output: state.output, running: state.running, started: state.started,
    ended: state.ended, states: state.states, log: state.log.slice(-250),runSettings:state.runSettings,
    phase:state.phase, verification:state.verification,media:state.media,sessions:state.sessions,textOptions:state.textOptions},
    (key,value)=>['text','diff'].includes(key)?undefined:value));
}
async function request(path, options = {}) {
  const response = await fetch(path, options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) {
    const nodes = body?.node_errors ? Object.values(body.node_errors).flatMap(n => n.errors.map(e => `${n.class_type}: ${e.message} ${e.details || ''}`)) : [];
    const error=new Error(nodes.join('\n') || body?.error?.message || body || `Request failed (${response.status})`);
    error.status=response.status;
    throw error;
  }
  return body;
}
function notice(message = '') {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}
function imageUrl(image) {
  return `/comfy/view?${new URLSearchParams({filename: image.filename || image.name,
    subfolder: image.subfolder || '', type: image.type || 'input'})}`;
}
function describe(id) { return state.graph?.nodes.find(n => n.id === String(id)); }
function updateButtons() {
  const text=state.media==='text';
  $('runButton').disabled = !state.ready || (!text && !state.socketReady) || !state.input || state.running;
  $('runButton').textContent = state.running ? (state.cpuMode ? 'Processing on CPU…' : 'Processing…') : (state.cpuMode ? '▶ Run image on CPU (slow)' : '▶ Run image');
  if (state.running && state.phase === 'verification') $('runButton').textContent = 'Checking provenance…';
  if(text)$('runButton').textContent=state.running?'Processing text…':'▶ Run text';
  $('stopButton').hidden = !state.running;
  $('stopButton').textContent = state.phase === 'verification' ? 'Stop checks' : 'Stop run';
  $('replaceButton').disabled = state.running;
  $('fileInput').disabled = state.running;
  for(const id of ['imageMode','textMode','textFileInput','chooseText','textModel','textEditLimit'])$(id).disabled=state.running;
  for (const id of ['adaptiveLevel', 'denoiseMin', 'denoiseMax']) $(id).disabled = state.running;
  $('settingsRunHint').textContent=state.running ? 'Settings are locked for this run; change them after it finishes or is stopped.' : 'Exact text may still change.';
}
function setView(mode) {
  state.mode = mode;
  document.body.classList.toggle('minimal', mode === 'minimal');
  for (const name of ['process', 'minimal']) {
    $(name + 'View').classList.toggle('selected', name === mode);
    $(name + 'View').setAttribute('aria-pressed', String(name === mode));
  }
  localStorage.setItem('synth-studio-view', mode);
}
function setStatus(title, detail) {
  $('runStatus').textContent = title;
  $('runDetail').textContent = (state.running && state.cpuMode ? 'CPU · ' : '') + detail;
  $('runDot').classList.toggle('running', state.running);
}
function duration(ms) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
setInterval(() => {
  if (state.started) $('elapsed').textContent = duration((state.ended || Date.now()) - state.started);
}, 1000);
function log(title, message = '', kind = '') {
  state.log.push({title, message, kind, time: Date.now()});
  renderLog(); persist();
}
function renderLog() {
  $('logCount').textContent = `${state.log.length} events`;
  if (!state.log.length) return;
  $('activityLog').replaceChildren();
  for (const entry of state.log.slice(-150).reverse()) {
    const providerEntry=entry.title.match(/^(Claude|OpenAI|Google SynthID) · (.+)$/);
    const verificationEnd=['Image complete','Verification unavailable'].includes(entry.title) && /verification/i.test(entry.message);
    const verificationResult=providerEntry && providerEntry[2]!=='checking';
    const displayTitle=verificationResult ? `${providerEntry[1]} · ${providerEntry[2].startsWith('manual')?'manual check':providerEntry[2]==='cancelled'?'cancelled':'done'}` : verificationEnd?'Image complete':entry.title;
    const displayMessage=verificationResult?'Select the node for details.':verificationEnd?verificationCompletionText:entry.message;
    const li = document.createElement('li'); li.className = verificationResult || verificationEnd ? '' : entry.kind;
    const title = document.createElement('span'); title.className = 'log-title'; title.textContent = displayTitle;
    const time = document.createElement('span'); time.className = 'log-time';
    time.textContent = new Date(entry.time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
    li.append(title, time);
    if (displayMessage) { const text = document.createElement('span'); text.className = 'log-message'; text.textContent = displayMessage; li.append(text); }
    $('activityLog').append(li);
  }
}
function showTool(id, live = false) {
  const node = describe(id); if (!node) return;
  const verification=node.id.startsWith('verify-');
  const progress = state.states[id];
  const outcomeLabel=id==='verify-desklib' && ['detected','not_detected'].includes(progress?.outcome)?'Desklib statistical estimate':verificationOutcomeLabels[progress?.outcome];
  $('toolTitle').textContent = node.label;
  $('toolPackage').textContent = `${node.tool} · node ${node.id}`;
  $('toolDescription').textContent = verification && live ? node.description :
    verification && progress?.outcome && outcomeLabel ?
      `${outcomeLabel}.\n\n${progress.message || node.description}` : progress?.message || node.description;
  $('toolDetailsText').textContent = `${node.type}\n${JSON.stringify(node.details, null, 2)}`;
  $('toolDetails').hidden = verification && live;
  $('currentTool').querySelector('.live-label').textContent = live ? 'CURRENT TOOL' : 'SELECTED TOOL';
  $('nodeActions').replaceChildren();$('nodeActions').hidden=true;
  if (verification && !live) {
    const provider=state.verification?.providers.find(provider=>'verify-'+provider.id===id);
    if (provider || node.details?.url) {
      const link=document.createElement('a');link.href=provider?.url || node.details.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open checker ↗';$('nodeActions').append(link);
    }
    if (provider?.evidence) {
      const link=document.createElement('a');link.href=`/api/verification/${state.verification.prompt_id}/${provider.id}.png`;link.target='_blank';link.rel='noopener';link.textContent='View captured result ↗';$('nodeActions').append(link);
    }
    if (id==='verify-report' && state.verification) {
      const button=document.createElement('button');button.className='text-button';button.textContent='↓ Save report';
      button.onclick=()=>downloadBlob(new Blob([JSON.stringify(state.verification,null,2)],{type:'application/json'}),'synth-studio-verification.json');$('nodeActions').append(button);
    }
    $('nodeActions').hidden=!$('nodeActions').children.length;
  }
  $('toolProgress').hidden = !(progress?.max > 1);
  if (progress?.max > 1) {
    $('toolProgressFill').style.width = `${100 * progress.value / progress.max}%`;
    $('toolProgressText').textContent = `Step ${progress.value} of ${progress.max}`;
  }
}
function updateNode(id, status, value = 0, max = 1) {
  id = String(id); const node = describe(id); if (!node) return;
  const previous = state.states[id]?.status;
  if (previous === 'cached' && status === 'finished') return;
  if (previous === status && state.states[id]?.value === value && state.states[id]?.max === max) return;
  state.states[id] = {status, value, max};
  if (previous !== status) {
    if (status === 'running') log(node.label, node.description);
    if (status === 'finished') log(`${node.label} · complete`);
    if (status === 'cached') log(`${node.label} · cached`, 'Reusing the result from an earlier run.', 'cached');
  }
  renderGraph();
  if (state.current === id) showTool(id, state.running);
  const {done,total} = updateGraphProgress();
  if (state.running && state.current) setStatus('Processing image', `${describe(state.current)?.label || 'Working'} · ${done}/${total} tools complete`);
  persist();
}
function updateGraphProgress() {
  const automatic = state.graph?.nodes.filter(node=>!node.manual) || [];
  const terminal = ['finished','cached','unavailable','inconclusive','cancelled','error'];
  const done = automatic.filter(node=>terminal.includes(state.states[node.id]?.status)).length;
  $('overallProgress').style.width = `${automatic.length ? 100*done/automatic.length : 0}%`;
  return {done,total:automatic.length};
}
function syncVerificationGraph() {
  const report=state.verification;
  if (!state.graph || !report) return;
  const statuses={pending:'pending',checking:'running',detected:'finished',not_detected:'finished',
    inconclusive:'finished',unavailable:'finished',manual:'manual',cancelled:'cancelled'};
  for (const provider of report.providers) {
    const id='verify-'+provider.id, node=describe(id);
    if (!node) continue;
    state.states[id]={status:statuses[provider.outcome] || 'inconclusive',outcome:provider.outcome,message:provider.message};
    node.details={...node.details,outcome:provider.outcome,response:provider.message,checked_at:provider.checked_at || null};
  }
  const terminal=['complete','error','cancelled'].includes(report.status);
  if (describe('verify-report')) {
    state.states['verify-report']={status:report.status==='complete' || report.status==='error'?'finished':report.status==='cancelled'?'cancelled':'pending',
      message:report.message, outcome:report.status==='complete'?'report_saved':null};
    describe('verify-report').details={prompt_id:report.prompt_id,sha256:report.sha256 || null,status:report.status,results:report.providers};
  }
  renderGraph();updateGraphProgress();
  if (state.running && state.phase==='verification') {
    const active=report.providers.find(provider=>provider.outcome==='checking') ||
      (!terminal && report.providers.find(provider=>provider.outcome==='pending' && provider.id!=='google'));
    const id=active ? 'verify-'+active.id : terminal ? 'verify-report' : null;
    if (id && describe(id)) {
      const changed=state.current!==id;state.current=id;showTool(id,true);
      document.querySelectorAll('.stages span').forEach((el,i)=>el.classList.toggle('active',i===describe(id).stage));
      if (changed) followNode(id);
      if (!terminal) setStatus('Checking provenance',`${describe(id).label} · final image saved`);
    }
  }
}
function layoutGraph() {
  const nodes = state.graph.nodes;
  const incoming = Object.fromEntries(nodes.map(n => [n.id, []]));
  for (const edge of state.graph.edges) incoming[edge.to].push(edge.from);
  const ranks = {};
  const rank = id => ranks[id] ??= incoming[id].length ? Math.max(...incoming[id].map(rank)) + 1 : 0;
  const layers = {};
  for (const node of nodes) (layers[rank(node.id)] ??= []).push(node);
  let y = 30;
  for (const layer of Object.values(layers)) {
    layer.sort((a, b) => a.stage - b.stage || Number(a.id) - Number(b.id));
    layer.forEach((node, index) => {
      state.positions[node.id] = {x: 25 + (index % 3) * 255, y: y + Math.floor(index / 3) * 104};
    });
    y += Math.ceil(layer.length / 3) * 104 + 34;
  }
}
function svg(tag, attributes = {}, text) {
  const element = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}
function renderGraph() {
  if (!state.graph) return;
  const visible = state.graph.nodes.filter(node => state.showAll || state.states[node.id]);
  const visibleIds = new Set(visible.map(n => n.id));
  $('graphEmpty').hidden = visible.length > 0;
  const canvas = $('graph'); canvas.replaceChildren();
  const width = 790;
  const height = Math.max(460, ...visible.map(n => state.positions[n.id].y + 120));
  canvas.setAttribute('viewBox', `0 0 ${width} ${height}`);
  canvas.setAttribute('width', width * state.zoom); canvas.setAttribute('height', height * state.zoom);
  $('zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
  const defs = svg('defs'); const marker = svg('marker', {id:'arrow', markerWidth:6, markerHeight:6, refX:5, refY:3, orient:'auto'});
  marker.append(svg('path', {d:'M0 0 L6 3 L0 6',fill:'#719e88'})); defs.append(marker);canvas.append(defs);
  for (const edge of state.graph.edges) {
    if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) continue;
    const a = state.positions[edge.from], b = state.positions[edge.to];
    const mid = (a.y + 84 + b.y) / 2;
    canvas.append(svg('path', {d:`M ${a.x + 112} ${a.y + 84} C ${a.x + 112} ${mid}, ${b.x + 112} ${mid}, ${b.x + 112} ${b.y}`,
      class:`graph-link ${edge.manual ? 'manual' : state.states[edge.to]?.status || 'pending'}`, 'marker-end':'url(#arrow)'}));
  }
  for (const node of visible) {
    const position = state.positions[node.id], progress = state.states[node.id];
    const status = progress?.status || (node.manual ? 'manual' : 'pending');
    const verificationDone=node.id.startsWith('verify-') && status==='finished';
    const group = svg('g', {class:`node-card ${status}`, transform:`translate(${position.x},${position.y})`, tabindex:0, role:'button', 'aria-label':`${node.label}: ${verificationDone?'Done':status}`});
    group.append(svg('rect', {width:225,height:84,rx:10}));
    group.append(svg('text', {x:12,y:21,class:'node-label'},node.label));
    group.append(svg('text', {x:12,y:40,class:'node-tool'},node.tool));
    let text = {running:'● Working', finished:'✓ Complete', cached:'↺ Cached', pending:'Waiting', error:'× Failed',
      manual:'↗ Manual check',unavailable:'! Unavailable',inconclusive:'? Review result',cancelled:'■ Cancelled'}[status];
    if (verificationDone) text='✓ Done';
    if (status === 'running' && progress.max > 1) text += ` · ${progress.value}/${progress.max}`;
    group.append(svg('text', {x:12,y:65,class:'node-state'},text));
    if (!node.id.startsWith('verify-')) group.append(svg('text', {x:213,y:65,class:'node-id','text-anchor':'end'},`#${node.id}`));
    group.append(svg('title', {}, node.description));
    group.addEventListener('click', () => showTool(node.id));
    group.addEventListener('keydown', event => {if (event.key === 'Enter') showTool(node.id);});
    canvas.append(group);
  }
  $('nodeCount').textContent = `${Object.keys(state.states).length} / ${state.graph.nodes.length} tools revealed`;
}
function followNode(id) {
  if (!state.follow || state.mode !== 'process') return;
  const p = state.positions[id]; if (!p) return;
  const viewport = $('graphViewport');
  viewport.scrollTo({top: Math.max(0, p.y * state.zoom - viewport.clientHeight / 2 + 42),
    left: Math.max(0, p.x * state.zoom - viewport.clientWidth / 2 + 112), behavior: 'smooth'});
}
async function upload(file) {
  if (!file || state.running) return;
  if (!state.ready) return notice('The image engine is still starting. Wait for “Engine connected”, then choose your image.');
  if (!file.type.startsWith('image/')) return notice('Choose an image file.');
  if (file.size > 100 * 1024**2) return notice('Choose an image smaller than 100 MB.');
  notice(); $('runButton').disabled = true; setStatus('Uploading image', file.name);
  try {
    const data = new FormData(); data.append('image', file); data.append('type', 'input');
    data.append('subfolder', 'studio'); data.append('overwrite', 'false');
    const result = await request('/comfy/upload/image', {method:'POST', body:data});
    state.input = {...result, filename:result.name, displayName:file.name};
    $('inputSize').textContent='—';
    state.output = null; state.promptId = null; state.states = {}; state.log = [];state.verification=null;
    configureInputGraph();
    state.started = null;state.ended = null;state.current = null;
    renderImages();renderGraph();$('activityLog').replaceChildren();$('logCount').textContent='0 events';
    $('overallProgress').style.width='0%';$('elapsed').textContent='00:00';
    setStatus('Ready to run', file.name); log('Input image uploaded', file.name); persist();
  } catch(error) {notice(error.message);setStatus('Upload failed','Please try again');}
  updateButtons();
}
function renderImages() {
  if(state.media==='text'){textMode?.render();return;}
  $('inputImage').hidden = !state.input; $('uploadHint').hidden = !!state.input;
  if (state.input) {
    $('inputName').textContent = state.input.displayName || state.input.filename;
    $('inputImage').onload = () => $('inputSize').textContent = `${$('inputImage').naturalWidth} × ${$('inputImage').naturalHeight}`;
    $('inputImage').onerror = () => $('inputSize').textContent = 'Preview unavailable';
    $('inputImage').src = imageUrl(state.input);
  }
  $('outputImage').hidden = !state.output; $('outputHint').hidden = !!state.output;
  $('outputHint').querySelector('strong').textContent = state.running ? 'Processing your image' : 'Your result appears here';
  $('outputHint').querySelector('span:last-child').textContent = state.running ? 'The final output will appear when the run finishes' : 'Upload an image and start a run';
  $('previewBadge').hidden = true;
  $('downloadOutput').hidden = !state.output;
  $('comparisonImages').hidden = !state.output || !state.input;
  $('compareHint').hidden = !!state.output && !!state.input;
  $('downloadComparison').hidden = !state.output || !state.input;
  $('compareSlider').disabled = !state.output;
  if (state.output) {
    const url = imageUrl(state.output);
    $('outputImage').src = url; $('outputName').textContent = state.output.filename;
    $('outputImage').onload = () => $('outputSize').textContent = `${$('outputImage').naturalWidth} × ${$('outputImage').naturalHeight}`;
    $('downloadOutput').href = url; $('downloadOutput').download = state.output.filename;
    $('compareAfter').src = url; $('compareBefore').src = imageUrl(state.input);
  } else { $('outputName').textContent = state.running ? 'Processing your image' : 'Waiting for a run'; $('outputSize').textContent = '—'; }
}
function preview(url) {
  if (!state.running || state.output) return;
  $('outputImage').src = url; $('outputImage').hidden = false; $('outputHint').hidden = true;
  $('previewBadge').hidden = false; $('outputName').textContent = 'Intermediate preview · not the final output';
}
async function binaryPreview(data) {
  if (!state.running) return;
  const buffer = await data.arrayBuffer(); const view = new DataView(buffer);
  if (buffer.byteLength < 8) return;
  const type = view.getUint32(0); let offset = 8, mime;
  if (type === 1) mime = view.getUint32(4) === 2 ? 'image/png' : 'image/jpeg';
  else if (type === 4) {
    const size = view.getUint32(4);
    const metadata = JSON.parse(new TextDecoder().decode(buffer.slice(8, 8 + size)));
    if (metadata.prompt_id && metadata.prompt_id !== state.promptId) return;
    mime = metadata.image_type;offset += size;
  } else return;
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(new Blob([buffer.slice(offset)], {type:mime}));
  preview(state.previewUrl);
}
async function startRun() {
  if(state.media==='text')return textMode?.run();
  if (!state.input || !state.ready || !state.socketReady || state.running) return;
  const settings=readSettings();
  if (!Number.isInteger(settings.adaptive_level) || settings.adaptive_level<1 || settings.adaptive_level>10 ||
      !Number.isFinite(settings.denoise_min) || !Number.isFinite(settings.denoise_max) ||
      settings.denoise_min<0 || settings.denoise_max>1 || settings.denoise_min>settings.denoise_max) {
    return notice('Use an adaptive level from 1 to 10 and a denoise range with 0 ≤ minimum ≤ maximum ≤ 1.');
  }
  state.runSettings=settings;saveSettings();applyRunSettings();
  notice(); state.promptId = crypto.randomUUID();state.running = true;state.started = Date.now();state.ended = null;
  const promptId = state.promptId;
  state.states = {};state.log = [];state.current = null;state.output = null;
  state.phase=isSvgInput(state.input)?'preparation':'generation';state.verification=null;$('nodeActions').hidden=true;
  $('graphViewport').scrollTo(0,0); $('overallProgress').style.width='0%';
  renderImages(); renderGraph(); updateButtons(); log('Run queued', `Adaptive level ${settings.adaptive_level} · denoise ${settings.denoise_min}–${settings.denoise_max}${state.cpuMode?' · CPU processing':''}`);
  $('toolTitle').textContent = 'Waiting for the engine';
  $('toolDescription').textContent = 'Your image is queued. The active tool appears here as execution begins.';
  $('toolPackage').textContent = 'Local processing';
  $('toolProgress').hidden = true;$('toolDetails').hidden = true;
  setStatus('Queued', 'Waiting for the image engine'); persist();
  try {
    const input=state.input;
    const cached=!!input.engineImage;
    if (isSvgInput(input)) {
      state.current='prepare-svg';updateNode('prepare-svg',cached?'cached':'running');
      showTool('prepare-svg',true);followNode('prepare-svg');
      setStatus('Preparing SVG','Rendering the SVG as PNG for the image engine');persist();
    }
    const engineInput=await prepareEngineInput(input);
    if (leavingPage || state.promptId!==promptId || !state.running) return;
    if (isSvgInput(input)) {
      const node=describe('prepare-svg');
      if (node) node.details={...node.details,png:engineInput.filename,width:engineInput.width,height:engineInput.height};
      if (!cached) updateNode('prepare-svg','finished');
    }
    state.phase='generation';state.current=null;
    const filename=engineInput.subfolder ? `${engineInput.subfolder}/${engineInput.filename}` : engineInput.filename;
    const loader=describe('11');if(loader) loader.details={...loader.details,image:filename};
    $('toolTitle').textContent='Waiting for the engine';$('toolDescription').textContent='Your image is queued.';
    setStatus('Queued','Waiting for the image engine');persist();
    await request('/api/run', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      image:filename,
      client_id:state.clientId,prompt_id:promptId,settings})});
  } catch(error) {
    if (!leavingPage && state.promptId === promptId && state.running) {
      if (state.phase==='preparation') updateNode('prepare-svg','error');
      finish('Run could not start', error.message, true);
    }
  }
}
function finish(title, message, error = false) {
  state.running = false;state.ended = Date.now();updateButtons();persist();
  renderImages();
  setStatus(title,message);log(title,message,error ? 'error' : '');
  if(error) notice(message);
  if (title === 'Image complete' || title==='Text complete') $('overallProgress').style.width='100%';
  $('currentTool').querySelector('.live-label').textContent = 'RUN STATUS';
  $('toolTitle').textContent = title;$('toolDescription').textContent = message;
  $('toolProgress').hidden = true;
  $('toolDetails').hidden=true;$('nodeActions').hidden=true;
}
async function verifyResult() {
  if (verificationLoading || !state.running || !state.output) return;
  state.phase='verification';updateButtons();persist();
  const promptId=state.promptId;
  verificationLoading=true;
  setStatus('Checking provenance','Image saved · running Claude and OpenAI checks');
  $('toolTitle').textContent='Check final image provenance';
  $('toolPackage').textContent='Claude · OpenAI · Google SynthID';
  $('toolDescription').textContent='One verification pass on the saved output. Google SynthID requires a manual check.';
  $('toolProgress').hidden=true;
  try {
    const report=await request(`/api/verification/${promptId}`,{method:'POST'});
    if (state.promptId!==promptId || !state.running) return;
    notice();
    const previous=state.verification;
    state.verification=report;syncVerificationGraph();persist();
    for (const provider of report.providers) {
      if (provider.outcome!=='pending' && provider.outcome!==previous?.providers.find(p=>p.id===provider.id)?.outcome) {
        const label=provider.outcome==='checking'?'checking':provider.outcome==='manual'?'manual check':provider.outcome==='cancelled'?'cancelled':'done';
        log(`${provider.name} · ${label}`,provider.outcome==='checking'?'Checking the final image.':'Select the node for details.');
      }
    }
    if (report.status==='complete') {
      finish('Image complete',verificationCompletionText);
    } else if (report.status==='error') finish('Image complete',verificationCompletionText);
    else if (report.status==='cancelled') finish('Verification stopped','The generated image and any completed checks are available.');
  } catch(error) {
    if (!leavingPage && state.promptId===promptId && state.running) {
      if ([400,401,403,404,405,410].includes(error.status)) {
        const message=error.status===404 || error.status===405
          ? 'Image saved, but this Studio server cannot start verification for the job. Restart Studio to load the updated server, then check the saved output.'
          : 'Image saved, but verification was rejected: '+error.message;
        state.verification={prompt_id:promptId,status:'error',message,output:state.output,providers:[
          {id:'claude',name:'Claude',url:'https://claude.com/check-files',outcome:'unavailable',message},
          {id:'openai',name:'OpenAI',url:'https://openai.com/research/verify/',outcome:'unavailable',message},
          {id:'google',name:'Google SynthID',url:'https://synthid.com/',outcome:'manual',message:'Check the saved output on Google SynthID manually.'}]};
        syncVerificationGraph();finish('Image complete',verificationCompletionText);notice();
      } else {
        setStatus('Verification connection interrupted','Image saved · reconnecting to the checks');
        notice(error.message);
      }
    }
  } finally {verificationLoading=false;}
}
async function loadResult() {
  if(state.media==='text'){await textMode?.poll();return true;}
  if (!state.promptId) return false;
  if (state.phase==='preparation') return false;
  if (state.phase==='verification') {await verifyResult();return true;}
  const promptId = state.promptId;
  const history = await request(`/comfy/history/${promptId}`);
  if (state.promptId !== promptId || !state.running) return false;
  const run = history[promptId];
  if (!run) {
    const response = await fetch(`/comfy/api/jobs/${promptId}`);
    if (state.promptId !== promptId || !state.running) return false;
    if (response.status === 404) finish('Run unavailable','The engine no longer has this job, usually because it was restarted. Run the image again.');
    return false;
  }
  const final = run.outputs?.['62']?.images?.[0];
  if(final) {state.output = final;renderImages();persist();}
  if(run.status?.completed || run.status?.status_str==='error') {
    if(run.status.status_str === 'success') {
      if (state.output) await verifyResult();
      else finish('Unable to load result','The completed job has no final output image.',true);
    }
    else {
      const failure = run.status.messages?.find(([type]) => type === 'execution_error' || type === 'execution_interrupted');
      finish(failure?.[0] === 'execution_interrupted' ? 'Run stopped' : 'Processing failed',failure?.[1]?.exception_message || 'The image engine stopped this run.',true);
    }
    return true;
  }
  return false;
}
function event(message) {
  if(state.media==='text')return;
  const {type, data} = message;
  if (data.prompt_id && data.prompt_id !== state.promptId) return;
  if (!state.promptId || !state.graph) return;
  if (state.phase === 'verification' || state.phase === 'preparation') return;
  if (!state.running && type !== 'executed') return;
  if (type === 'execution_start') {setStatus('Processing image','Preparing the workflow');log('Run started');}
  if (type === 'execution_cached') for (const id of data.nodes) updateNode(id, 'cached');
  if (type === 'executing' && data.node) {
    if(state.current && state.states[state.current]?.status === 'running') updateNode(state.current,'finished');
    state.current = String(data.display_node || data.node);updateNode(state.current,'running');showTool(state.current,true);
    document.querySelectorAll('.stages span').forEach((el,i)=>el.classList.toggle('active',i === describe(state.current)?.stage));
    followNode(state.current);
  }
  if (type === 'progress') {
    const id = String(data.node || state.current);
    if (!state.current) state.current = id;
    updateNode(id,'running',data.value,data.max);showTool(id,true);
  }
  if(type === 'progress_state') for (const [id, progress] of Object.entries(data.nodes)) {
    const displayId = String(progress.display_node_id || id);
    if (progress.state === 'running' && !state.current) {
      state.current = displayId;
      followNode(displayId);
    }
    updateNode(displayId, progress.state, progress.value, progress.max);
  }
  if(type === 'executed') {
    const id = String(data.display_node || data.node);updateNode(id,'finished');
    const image = data.output?.images?.[0];
    if(id === '62' && image) {state.output = image;renderImages();persist();}
    else if(id === '545' && image) preview(imageUrl(image));
  }
  if(type === 'execution_success') {
    if(state.current && state.states[state.current]?.status === 'running') updateNode(state.current,'finished');
    loadResult().catch(error=>finish('Unable to load result',error.message,true));
  }
  if(type === 'execution_error') {
    updateNode(data.node_id,'error');finish('Processing failed',`${describe(data.node_id)?.label || data.node_type}: ${data.exception_message}`,true);
  }
  if(type === 'execution_interrupted') finish('Run stopped','Processing was cancelled. You can start another run.');
}
function connectSocket() {
  if(state.media==='text')return;
  if (!state.ready) return;
  if (state.socket?.readyState === WebSocket.OPEN) {
    state.socketReady=true;$('connectionText').textContent='Engine connected';$('connectionDot').classList.add('ready');updateButtons();return;
  }
  if (state.socket?.readyState === WebSocket.CONNECTING) return;
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/comfy/ws?clientId=${state.clientId}`);
  state.socket = socket;
  socket.onopen = () => {
    state.socketReady = true;
    if(state.media==='text')return;
    $('connectionText').textContent='Engine connected';$('connectionDot').classList.add('ready');updateButtons();
    socket.send(JSON.stringify({type:'feature_flags', data:{supports_preview_metadata:true}}));
    if(state.running) {log('Connection restored','Checking the current run.');loadResult().catch(error=>notice(error.message));}
  };
  socket.onmessage = message => {
    if(typeof message.data === 'string') event(JSON.parse(message.data));
    else binaryPreview(message.data).catch(error=>console.warn('Preview unavailable:',error));
  };
  socket.onclose = () => {
    state.socketReady = false;if(state.media==='text')return;
    $('connectionText').textContent='Reconnecting';$('connectionDot').classList.remove('ready');updateButtons();
    if(state.running) setStatus('Connection interrupted','Reconnecting; the engine may still be processing');
    setTimeout(connectSocket,2500);
  };
}
async function health() {
  if(state.media==='text'){try{await textMode?.health();}catch(error){state.ready=false;notice(error.message);updateButtons();}return;}
  try {
    const info = await request('/api/health');
    if(state.media==='text')return;
    state.ready = info.ready;
    if(info.ready) {
      state.cpuMode=info.devices[0]?.type==='cpu';
      $('engineBanner').hidden=!state.cpuMode;
      $('deviceName').textContent = info.devices[0]?.type === 'cpu' ? 'CPU mode · slower processing' : info.devices[0]?.name.replace(/^cuda:\d+ /,'').replace(/ : .*/,'') || 'Local image engine';
      if(!state.graph || (info.verification && !describe('verify-report'))) {
        state.graph=await request('/api/graph');applyRunSettings();configureInputGraph();renderGraph();syncVerificationGraph();
        if (info.verification && state.output && state.promptId && state.verification && !state.running) {
          try {
            // Restore the saved server result without submitting the image again.
            state.verification=await request(`/api/verification/${state.promptId}`);
            syncVerificationGraph();persist();notice();
            setStatus('Image complete',verificationCompletionText);
            followNode('verify-report');
          } catch(error) {if (error.status!==404) console.warn('Report restore:',error.message);}
        }
      }
      connectSocket();
    } else {
      $('connectionText').textContent='Starting engine';$('deviceName').textContent=info.message;
      if (info.message.includes('stopped')) notice(info.message);
    }
  } catch {state.ready=false;$('connectionText').textContent='Engine unavailable';}
  updateButtons();
}
$('processView').onclick=()=>setView('process');$('minimalView').onclick=()=>setView('minimal');
$('settingsButton').onclick=()=>{$('settings').hidden=!$('settings').hidden;$('settingsButton').setAttribute('aria-expanded',String(!$('settings').hidden));$('settingsButton').textContent=$('settings').hidden?'Show settings':'Hide settings';};
$('replaceButton').onclick=()=>$('fileInput').click();
$('dropZone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('fileInput').click();}};
$('fileInput').onchange=e=>upload(e.target.files[0]);
$('dropZone').ondragover=e=>{e.preventDefault();$('dropZone').classList.add('dragging');};
$('dropZone').ondragleave=()=>$('dropZone').classList.remove('dragging');
$('dropZone').ondrop=e=>{e.preventDefault();$('dropZone').classList.remove('dragging');upload(e.dataTransfer.files[0]);};
$('runButton').onclick=startRun;
$('stopButton').onclick=async()=>{
  if(state.media==='text'){try{await textMode?.stop();}catch(error){notice(error.message);}return;}
  if (state.phase==='preparation') {
    updateNode('prepare-svg','cancelled');
    finish('Run stopped','SVG preparation was cancelled. No image job was submitted.');
    return;
  }
  if (state.phase==='verification') {
    try {await request(`/api/verification/${state.promptId}/cancel`,{method:'POST'});await verifyResult();}
    catch(error){notice(error.message);}
    return;
  }
  try { const result=await request(`/comfy/api/jobs/${state.promptId}/cancel`,{method:'POST'});
    if(result.cancelled) {log('Stop requested','Waiting for the active tool to stop.');setStatus('Stopping run','Finishing the current operation');}
    else await loadResult();
  } catch(error){notice(error.message);}
};
$('revealButton').onclick=()=>{state.showAll=!state.showAll;$('revealButton').setAttribute('aria-pressed',String(state.showAll));$('revealButton').textContent=state.showAll?'Reveal as it runs':'Show full graph';renderGraph();};
$('followButton').onclick=()=>{state.follow=!state.follow;$('followButton').classList.toggle('selected',state.follow);$('followButton').setAttribute('aria-pressed',String(state.follow));if(state.current)followNode(state.current);};
$('zoomOut').onclick=()=>{state.zoom=Math.max(.4,state.zoom-.1);renderGraph();};
$('zoomIn').onclick=()=>{state.zoom=Math.min(1.6,state.zoom+.1);renderGraph();};
$('compareSlider').oninput=e=>$('comparisonImages').style.setProperty('--split',`${e.target.value}%`);
function downloadBlob(blob, name) {
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
$('downloadLog').onclick=()=>downloadBlob(new Blob([JSON.stringify(state.log,null,2)],{type:'application/json'}),'synth-studio-activity.json');
$('downloadComparison').onclick=async()=>{
  try {
    const images=await Promise.all([state.input,state.output].map(image=>new Promise((resolve,reject)=>{
      const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Unable to load comparison images'));img.src=imageUrl(image);
    })));
    const width=Math.max(...images.map(i=>i.naturalWidth)),height=Math.max(...images.map(i=>i.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=width*2;canvas.height=height+60;
    const context=canvas.getContext('2d');context.fillStyle='#141a1b';context.fillRect(0,0,canvas.width,canvas.height);
    images.forEach((img,i)=>{const scale=Math.min(width/img.naturalWidth,height/img.naturalHeight);
      context.drawImage(img,i*width+(width-img.naturalWidth*scale)/2,60+(height-img.naturalHeight*scale)/2,img.naturalWidth*scale,img.naturalHeight*scale);
      context.fillStyle='#c0f88b';context.font='22px sans-serif';context.fillText(i?'OUTPUT':'INPUT',i*width+22,39);});
    canvas.toBlob(blob=>downloadBlob(blob,'synth-studio-comparison.png'),'image/png');
  } catch(error){notice(error.message);}
};
textMode=createTextMode({state,$,request,persist,notice,log,renderLog,renderGraph,layoutGraph,showTool,followNode,updateButtons,setStatus,finish,syncVerificationGraph,updateGraphProgress,configureInputGraph,renderImages,health});
setView(state.mode);renderImages();renderLog();
if(state.running && state.phase==='preparation') finish('Run stopped','SVG preparation was interrupted by the page reload. Start the run again.');
else if(state.running)setStatus('Restoring run','Reconnecting to the local image engine');
else if(state.output)setStatus(state.media==='text'?'Text complete':'Image complete','Your result is ready to download and compare.');
else if(state.input)setStatus('Ready to run',state.input.displayName||state.input.filename);
health();setInterval(health,10000);
setInterval(()=>{if(state.running && (state.media==='text' || state.socketReady || state.phase==='verification'))loadResult().catch(error=>console.warn('Run check:',error.message));},2000);
