const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');

const root = path.resolve(__dirname, '../..');
const artifacts = path.join(root, 'studio/qa/artifacts');
const url = 'http://127.0.0.1:8190';

(async () => {
  await fs.mkdir(artifacts, {recursive:true});
  const browser = await chromium.launch({headless:true, executablePath:'/home/nishant/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome', args:['--no-sandbox']});
  const page = await browser.newPage({viewport:{width:1536,height:1120}});
  const failures=[];page.on('pageerror',e=>failures.push(e.message));
  await page.goto(url);
  await page.waitForFunction(()=>document.getElementById('connectionText').textContent==='Engine connected');
  assert.equal(await page.locator('.node-card').count(),0);
  await page.screenshot({path:path.join(artifacts,'process-empty.png'),fullPage:true});
  await page.getByRole('button',{name:'Show full graph',exact:true}).click();
  assert.ok(await page.locator('.node-card').count()>35);
  await page.getByRole('button',{name:'Reveal as it runs',exact:true}).click();
  assert.equal(await page.locator('.node-card').count(),0);
  const realGraph=await (await page.request.get(url+'/api/graph')).json();
  await page.route('**/api/graph',route=>route.fulfill({json:{
    nodes:realGraph.nodes.filter(n=>['11','568','62'].includes(n.id)),
    edges:[{from:'11',to:'568',input:'image'},{from:'568',to:'62',input:'images'}]
  }}));
  await page.reload();
  await page.waitForFunction(()=>document.getElementById('connectionText').textContent==='Engine connected');
  await page.locator('#fileInput').setInputFiles(path.join(root,'ComfyUI/input/Water-Cooled Ceremonial Lamp Engineering Diagram.png'));
  await page.waitForFunction(()=>!document.getElementById('runButton').disabled);

  // Exercise the real upload, socket, history, image and download paths using a
  // lightweight CPU graph. The full diffusion prompt is validated separately.
  await page.route('**/api/run',async route=>{
    const body=route.request().postDataJSON();
    const response=await page.request.post('http://127.0.0.1:8191/prompt',{data:{
      client_id:body.client_id,prompt_id:body.prompt_id,prompt:{
        '11':{class_type:'LoadImage',inputs:{image:body.image}},
        '568':{class_type:'ImageScaleBy',inputs:{image:['11',0],upscale_method:'lanczos',scale_by:.5}},
        '62':{class_type:'SaveImage',inputs:{images:['568',0],filename_prefix:'Studio-QA'}}
      }}});
    await route.fulfill({status:response.status(),body:await response.text(),contentType:'application/json'});
  });
  await page.getByRole('button',{name:'Run image',exact:false}).click();
  await page.waitForFunction(()=>document.getElementById('runStatus').textContent==='Image complete',{timeout:60000});
  assert.ok(await page.locator('.node-card').count()>=3);
  assert.ok(await page.locator('.graph-link').count()>0);
  await page.locator('#outputImage').evaluate(img=>img.decode());
  await page.screenshot({path:path.join(artifacts,'process-complete.png'),fullPage:true});
  await page.locator('#compareSlider').fill('27');
  assert.match(await page.locator('#comparisonImages').getAttribute('style'),/27%/);
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Save comparison',exact:false}).click();
  const download=await downloadPromise;await download.saveAs(path.join(artifacts,'comparison.png'));
  assert.equal((await fs.stat(path.join(artifacts,'comparison.png'))).size>10000,true);
  await page.getByRole('button',{name:'Minimal',exact:false}).click();
  assert.equal(await page.locator('#processSection').isVisible(),false);
  assert.equal(await page.locator('#outputImage').isVisible(),true);
  const finalSession=await page.evaluate(()=>JSON.parse(localStorage.getItem('synth-forge-session-v1')));
  const cancellation=await page.request.post(url+`/comfy/api/jobs/${finalSession.promptId}/cancel`);
  assert.equal(cancellation.status(),200);
  assert.equal((await cancellation.json()).cancelled,false);
  const crossOrigin=await page.request.post(url+'/api/run',{headers:{Origin:'http://example.invalid'},data:{}});
  assert.equal(crossOrigin.status(),403);
  await page.screenshot({path:path.join(artifacts,'minimal-complete.png'),fullPage:true});
  await page.reload();
  await page.waitForFunction(()=>document.getElementById('connectionText').textContent==='Engine connected');
  assert.equal(await page.locator('#processSection').isVisible(),false);
  assert.equal(await page.locator('#outputImage').isVisible(),true);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(artifacts,'mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(failures,[]);
  await page.close();

  // An isolated event fixture tests a long-running sampler, view switching,
  // cancellation, cached nodes, and error messaging without GPU inference.
  const live=await browser.newPage({viewport:{width:1536,height:1120}});
  live.on('pageerror',e=>failures.push(e.message));
  let socket,submitted,restarted=false;
  await live.routeWebSocket('**/comfy/ws**',ws=>{socket=ws;});
  await live.route('**/api/run',async route=>{
    submitted=route.request().postDataJSON();
    await route.fulfill({json:{prompt_id:submitted.prompt_id,number:0,node_errors:{}}});
    socket.send(JSON.stringify({type:'execution_start',data:{prompt_id:submitted.prompt_id}}));
    socket.send(JSON.stringify({type:'execution_cached',data:{prompt_id:submitted.prompt_id,nodes:['605','12']}}));
    for(const id of ['11','595','608','564','8','551','552','3']){
      socket.send(JSON.stringify({type:'executing',data:{prompt_id:submitted.prompt_id,node:id}}));
    }
    socket.send(JSON.stringify({type:'progress',data:{prompt_id:submitted.prompt_id,node:'3',value:2,max:4}}));
  });
  await live.route('**/comfy/history/**',route=>route.fulfill({json:{}}));
  await live.route(/\/comfy\/api\/jobs\/[a-f0-9-]+$/,route=>route.fulfill(restarted ?
    {status:404,json:{error:'Job not found'}} : {json:{status:'running'}}));
  await live.route('**/comfy/api/jobs/*/cancel',async route=>{
    await route.fulfill({json:{cancelled:true}});
    socket.send(JSON.stringify({type:'execution_interrupted',data:{prompt_id:submitted.prompt_id}}));
  });
  await live.goto(url);
  await live.waitForFunction(()=>document.getElementById('connectionText').textContent==='Engine connected');
  await live.locator('#fileInput').setInputFiles(path.join(root,'ComfyUI/input/example.png'));
  await live.waitForFunction(()=>!document.getElementById('runButton').disabled);
  await live.getByRole('button',{name:'Run image',exact:false}).click();
  await live.waitForFunction(()=>document.getElementById('toolProgressText').textContent==='Step 2 of 4');
  assert.ok(await live.locator('.node-card.running').count()>0);
  assert.equal(await live.locator('.node-card.cached').count(),2);
  assert.match(await live.locator('#toolPackage').textContent(),/Qwen Image/);
  await live.waitForTimeout(600);
  await live.screenshot({path:path.join(artifacts,'process-live-fixture.png'),fullPage:true});
  await live.getByRole('button',{name:'Minimal',exact:false}).click();
  assert.equal(await live.locator('#stopButton').isVisible(),true);
  await live.getByRole('button',{name:'Stop run',exact:true}).click();
  await live.waitForFunction(()=>document.getElementById('runStatus').textContent==='Run stopped');
  assert.equal(await live.locator('#runButton').isEnabled(),true);
  await live.getByRole('button',{name:'Process',exact:false}).click();
  await live.getByRole('button',{name:'Run image',exact:false}).click();
  await live.waitForFunction(()=>document.getElementById('toolProgressText').textContent==='Step 2 of 4');
  socket.send(JSON.stringify({type:'execution_error',data:{prompt_id:submitted.prompt_id,node_id:'3',node_type:'KSampler',exception_message:'QA: simulated model failure'}}));
  await live.waitForFunction(()=>document.getElementById('runStatus').textContent==='Processing failed');
  assert.match(await live.locator('#notice').textContent(),/simulated model failure/);
  await live.unroute('**/api/run');
  await live.route('**/api/run',async route=>{
    submitted=route.request().postDataJSON();
    await route.fulfill({json:{prompt_id:submitted.prompt_id,number:0,node_errors:{}}});
  });
  const queuedResponse=live.waitForResponse(response=>response.url().endsWith('/api/run') && response.status()===200);
  await live.getByRole('button',{name:'Run image',exact:false}).click();
  await (await queuedResponse).finished();
  await live.waitForTimeout(100);
  await live.waitForFunction(()=>document.getElementById('runStatus').textContent==='Queued');
  restarted=true;
  await live.reload();
  try {
    await live.waitForFunction(()=>document.getElementById('runStatus').textContent==='Run unavailable');
  } catch(error) {
    console.log(await live.evaluate(()=>({status:document.getElementById('runStatus').textContent,
      session:JSON.parse(localStorage.getItem('synth-forge-session-v1'))})),failures);
    throw error;
  }
  assert.equal(await live.locator('#runButton').isEnabled(),true);
  assert.deepEqual(failures,[]);
  await live.close();await browser.close();
  console.log('PASS: real CPU execution, progressive graph, upload/output, comparison download, reload, mobile, sampling progress, cache display, cancellation, and failure messaging.');
})().catch(error=>{console.error(error);process.exit(1);});
