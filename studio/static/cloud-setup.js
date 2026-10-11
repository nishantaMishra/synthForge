const $=id=>document.getElementById(id);
let csrf=null;
let quotaReady=false;
let awsReady=false;
let deploymentState=null;
let deploymentInFlight=false;

async function refresh(){
  awsReady=false;
  $('accountStatus').textContent='Checking sign-in…';
  $('cpuStatus').textContent='Checking CPU quota…';
  $('quotaStatus').textContent='Checking quota…';
  $('requestQuota').disabled=true;
  try{
    const response=await fetch('/api/cloud/setup/status',{cache:'no-store'});
    if(!response.ok) throw new Error('Could not read AWS setup status. Restart Synth Forge to load the new setup API.');
    const status=await response.json();
    csrf=status.csrf;
    $('workspaceUrl').value=status.workspaceUrl || '';
    $('workspaceStatus').textContent=status.workspaceUrl ? `Connected: ${status.workspaceUrl}` : 'No address connected';
    if(!status.signedIn){
      $('accountStatus').textContent=status.authError || 'Sign-in needed';
      $('cpuStatus').textContent='Sign in to check CPU quota.';
      $('quotaStatus').textContent='Sign in to check GPU quota.';
      return;
    }
    $('accountStatus').textContent=`Connected to account ${status.account} as ${status.identity || 'an AWS identity'}.`+
      (status.identity==='root'?' Create a dedicated role before deployment.':'');
    awsReady=Number(status.cpuQuota)>=4;
    $('cpuStatus').textContent=status.cpuQuotaError ||
      (Number(status.cpuQuota)>=4
        ? `CPU demo possible: ${status.cpuQuota} standard vCPUs available in us-east-1. Deployment has not started.`
        : `CPU quota: ${status.cpuQuota ?? 'unknown'} standard vCPUs. Four are needed for the proposed demo instance.`);
    if(status.quotaError){$('quotaStatus').textContent=status.quotaError;return;}
    const current=Number(status.quota);
    const latest=status.quotaRequest;
    const pending=latest && ['PENDING','CASE_OPENED'].includes(latest.status) && Number(latest.desired)>=status.quotaTarget;
    quotaReady=current>=status.quotaTarget;
    $('quotaStatus').textContent=quotaReady
      ? `Available: ${current} vCPUs. GPU quota is sufficient.`
      : pending
        ? `Available: ${current} vCPUs. Request for ${latest.desired} vCPUs: ${latest.status.toLowerCase().replace('_',' ')}.`
        : `Available: ${current} vCPUs. Request ${status.quotaTarget} to run one proposed GPU worker.`;
    $('requestQuota').disabled=quotaReady || Boolean(pending);
  }catch(error){
    $('accountStatus').textContent=error.message;
    $('cpuStatus').textContent='CPU quota could not be checked.';
    $('quotaStatus').textContent='Quota could not be checked.';
  }finally{
    updateDeploymentButtons();
  }
}

$('copyLogin').onclick=async()=>{
  try{await navigator.clipboard.writeText('aws login');$('message').textContent='Copied: aws login';}
  catch{$('message').textContent='Run this command in a terminal: aws login';}
};
$('refresh').onclick=refresh;
$('saveWorkspace').onclick=async()=>{
  $('message').textContent='Saving workspace address…';
  try{
    const response=await fetch('/api/cloud/setup/workspace',{
      method:'POST',headers:{'Content-Type':'application/json','X-Synth-Setup':csrf},
      body:JSON.stringify({url:$('workspaceUrl').value})
    });
    if(!response.ok) throw new Error(await response.text());
    const result=await response.json();
    $('workspaceStatus').textContent=`Connected: ${result.url}`;
    $('message').textContent=result.message;
  }catch(error){$('message').textContent=error.message || 'Address could not be saved.';}
};
$('requestQuota').onclick=async()=>{
  $('requestQuota').disabled=true;
  $('message').textContent='Sending quota request to AWS…';
  try{
    const response=await fetch('/api/cloud/setup/quota',{
      method:'POST',headers:{'Content-Type':'application/json','X-Synth-Setup':csrf},
      body:JSON.stringify({desiredVcpus:4})
    });
    const result=response.ok?await response.json():{message:await response.text()};
    $('message').textContent=result.message;
  }catch{$('message').textContent='AWS quota request could not be sent.';}
  await refresh();
};
function updateDeploymentButtons(){
  const data=deploymentState;
  const running=deploymentInFlight || Boolean(data?.running);
  const status=data?.deployment?.status;
  const exists=Boolean(status) && status!=='deleted';
  const ready=status==='ready';
  const approved=$('allowCloudCharges').checked;
  $('prepareDemo').disabled=running;
  $('launchDemo').disabled=running || !awsReady || exists || !approved;
  $('enableOwner').disabled=running || !ready || data?.ownerConfigured || !$('ownerEmail').value.trim() || !approved;
  $('stopDemo').disabled=running || !exists || status==='stopped';
  $('cleanupDemo').disabled=running || !exists || !$('deleteDemoData').checked;
}

function showDeployment(data){
  deploymentState=data;
  if(data.csrf) csrf=data.csrf;
  const {status,url,expiresAt}=data.deployment || {};
  $('deploymentStatus').textContent=data.running
    ? `Running ${data.action}… This can take several minutes.`
    : status==='ready' ? `Workspace deployed. Demo ends at ${new Date(expiresAt).toLocaleString()}.`
    : status==='expired' ? 'Demo expired. Clean up the remaining resources.'
    : status==='stopped' ? 'Demo stopped. Storage remains until cleanup.'
    : status==='deleted' ? 'Demo resources deleted.'
    : status ? 'Deployment is incomplete. Stop and clean up before trying again.'
    : 'Prepared for deployment. No AWS demo has been launched.';
  $('deploymentPlan').replaceChildren();
  for(const key of ['web','worker','model','identity','storage','limits','expiry','costEstimate','remainingCosts','monetization']){
    const item=document.createElement('li');
    item.textContent=data.plan[key];
    $('deploymentPlan').append(item);
  }
  $('deploymentMessage').textContent=data.failure || (data.running
    ? `Progress is being saved to ${data.logPath}.`
    : data.action==='build' ? 'Container preparation finished locally.'
    : 'Launch creates billable AWS resources. Review the plan and your credits first.');
  $('ownerStatus').textContent=data.ownerConfigured ? 'Your confirmed account is enabled for one job.'
    : status==='ready' ? 'Sign in at the cloud workspace and confirm your email, then enable your test here.'
    : 'Deploy the workspace first.';
  $('openDemo').hidden=status!=='ready' || !url;
  if(url) $('openDemo').href=url;
  if(status==='ready' && url){
    $('workspaceUrl').value=url;
    $('workspaceStatus').textContent=`Connected: ${url}`;
  }else if(['stopped','expired','deleted'].includes(status)){
    $('workspaceStatus').textContent='This demo is closed.';
  }
  updateDeploymentButtons();
}

async function pollDeployment(){
  try{
    const response=await fetch('/api/cloud/setup/deployment',{cache:'no-store'});
    if(!response.ok) throw new Error('Restart Synth Forge to load the deployment controls.');
    showDeployment(await response.json());
  }catch(error){
    $('deploymentStatus').textContent=error.message;
  }
  setTimeout(pollDeployment,3000);
}

async function deploymentAction(action){
  deploymentInFlight=true;
  updateDeploymentButtons();
  try{
    const response=await fetch('/api/cloud/setup/deployment',{
      method:'POST',headers:{'Content-Type':'application/json','X-Synth-Setup':csrf},
      body:JSON.stringify({action,allowAwsCharges:$('allowCloudCharges').checked,
        ownerEmail:$('ownerEmail').value.trim(),deleteDemoData:$('deleteDemoData').checked})
    });
    if(!response.ok) throw new Error(await response.text());
    showDeployment(await response.json());
  }catch(error){
    $('deploymentMessage').textContent=error.message;
  }finally{
    deploymentInFlight=false;
    updateDeploymentButtons();
  }
}

$('allowCloudCharges').onchange=updateDeploymentButtons;
$('deleteDemoData').onchange=updateDeploymentButtons;
$('ownerEmail').oninput=updateDeploymentButtons;
$('prepareDemo').onclick=()=>deploymentAction('build');
$('launchDemo').onclick=()=>deploymentAction('deploy');
$('enableOwner').onclick=()=>deploymentAction('enable-owner');
$('stopDemo').onclick=()=>deploymentAction('stop');
$('cleanupDemo').onclick=()=>deploymentAction('destroy');
refresh();
pollDeployment();
