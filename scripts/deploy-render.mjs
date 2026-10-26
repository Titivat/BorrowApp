const { RENDER_API_KEY:key, RENDER_SERVICE_ID:service, DEPLOY_SHA:sha } = process.env;
if (!key || !/^srv-[a-z0-9]+$/.test(service || '') || !/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Configure Render credentials and a full commit SHA.');
const base = `https://api.render.com/v1/services/${service}/deploys`;
const headers = { Authorization:`Bearer ${key}`, 'Content-Type':'application/json', Accept:'application/json' };
const response = await fetch(base,{method:'POST',headers,body:JSON.stringify({commitId:sha,clearCache:'do_not_clear'})});
if (!response.ok) throw new Error(`Render deploy failed: HTTP ${response.status}`);
const deploy = await response.json();
console.log(`Deployment started: ${deploy.id}`);
for (let count=0;count<100;count++) {
  await new Promise(resolve=>setTimeout(resolve,10000));
  const statusResponse = await fetch(`${base}/${deploy.id}`,{headers});
  if (!statusResponse.ok) throw new Error(`Cannot check Render deployment: HTTP ${statusResponse.status}`);
  const status = await statusResponse.json();
  if (status.status === 'live') { console.log(`Deployment live at commit ${sha}`); process.exit(0); }
  if (['build_failed','update_failed','pre_deploy_failed','canceled','deactivated'].includes(status.status)) throw new Error(`Deployment ${status.status}`);
}
throw new Error('Deployment timed out. Check the Render dashboard before retrying.');
