// Single-pass checks through the providers' public upload interfaces.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function browserExecutable(chromium) {
  if (process.env.SYNTH_VERIFY_BROWSER) return process.env.SYNTH_VERIFY_BROWSER;
  try {await fs.access(chromium.executablePath());return chromium.executablePath();} catch {}
  // Existing Studio installations may have a different cached Chromium revision.
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  let versions=[];
  try {versions=(await fs.readdir(cache)).filter(name=>/^chromium-\d+$/.test(name)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1]));} catch {}
  for (const version of versions) {
    for (const binary of ['chrome-linux64/chrome','chrome-linux/chrome']) {
      const executable=path.join(cache,version,binary);
      try {await fs.access(executable);return executable;} catch {}
    }
  }
}

const providers = [
  {id:'claude', name:'Claude', url:'https://claude.com/check-files'},
  {id:'openai', name:'OpenAI', url:'https://openai.com/research/verify/'},
];

// Only classify explicit result language, never an explanatory FAQ or filename.
function classify(text, provider) {
  if (/\b(?:checking|processing|verifying|loading|pending)\b/i.test(text)) return 'inconclusive';
  const lines = text.split('\n').map(line=>line.trim()).filter(Boolean);
  if (provider==='claude' && lines.some(line=>/^We didn['’]t find any signs this file was processed by Claude\.$/i.test(line))) return 'not_detected';
  for (let i=1;i<lines.length;i++) {
    if (/^(?:C2PA(?: metadata)?|SynthID(?: watermark)?|OpenAI provenance signals?)$/i.test(lines[i-1]) && /^(?:not )?detected[.!]?$/i.test(lines[i])) {
      lines[i]=lines[i-1]+' '+lines[i];
    }
  }
  const negative = provider === 'claude'
    ? /^(?:no (?:claude )?(?:content )?credentials? (?:found|detected)|(?:this )?file (?:was )?not (?:made|processed) (?:with|by) claude)[.!]?$/i
    : /^(?:no (?:supported |openai |provenance )?signals? (?:found|detected)|(?:openai provenance |c2pa |synthid )?(?:not detected))[.!]?$/i;
  const positive = provider === 'claude'
    ? /^(?:(?:claude )?(?:content )?credentials? (?:found|detected)|(?:this )?file (?:may have been |was )?(?:made|processed) (?:with|by) claude)[.!]?$/i
    : /^(?:(?:openai(?:-generated)? (?:content|provenance|signals?)|c2pa(?: metadata)?|synthid(?: watermark)?) (?:found|detected))[.!]?$/i;
  if (lines.some(line=>positive.test(line))) return 'detected';
  if (lines.some(line=>negative.test(line)) && !lines.some(line=>/^detected[.!]?$/i.test(line))) return 'not_detected';
  return 'inconclusive';
}

async function check(page, provider, image, evidenceDirectory) {
  await page.goto(provider.url, {waitUntil:'domcontentloaded', timeout:25000});
  const input = page.locator('input[type=file]');
  await input.waitFor({state:'attached', timeout:15000});
  // The card encloses the upload and result UI; exclude the site's explanatory text.
  let card = provider.id === 'claude'
    ? page.locator('div[class*="UploadCard"][class*="__card"]')
    : page.locator('section').filter({has:input});
  if (await card.count() !== 1) throw new Error('The provider changed its verification interface.');
  if (provider.id === 'openai') {
    // Keep the same section even if its upload input disappears during analysis.
    const index=await card.evaluate(element=>Array.from(document.querySelectorAll('section')).indexOf(element));
    card=page.locator('section').nth(index);
  }
  const before = await card.innerText();
  await input.setInputFiles(image, {timeout:10000});
  const until = Date.now()+45000;
  let resultText = '';
  while (Date.now()<until) {
    const text = await card.innerText();
    // Claude places its verdict in aria-live; OpenAI replaces the upload card.
    resultText = provider.id === 'claude'
      ? await card.locator('[aria-live]').innerText()
      : text.split('\n').filter(line=>!before.split('\n').includes(line) && line.trim()!==path.basename(image)).join('\n');
    const outcome = classify(resultText, provider.id);
    if (outcome !== 'inconclusive') {
      await page.screenshot({path:path.join(evidenceDirectory, provider.id+'.png'), fullPage:true});
      return {outcome, message:resultText.slice(0,8000), evidence:provider.id+'.png'};
    }
    if (/\b(?:error|failed|try again|rate limit|unsupported|too large)\b/i.test(resultText)) {
      await page.screenshot({path:path.join(evidenceDirectory, provider.id+'.png'), fullPage:true});
      return {outcome:'unavailable', message:resultText.slice(0,8000), evidence:provider.id+'.png'};
    }
    await page.waitForTimeout(500);
  }
  await page.screenshot({path:path.join(evidenceDirectory, provider.id+'.png'), fullPage:true});
  return {outcome:resultText ? 'inconclusive':'unavailable',
    message:resultText || 'The site did not return a verdict within 45 seconds. It may require sign-in or a browser challenge.', evidence:provider.id+'.png'};
}

async function main() {
  const [image, evidenceDirectory] = process.argv.slice(2);
  const emit = value=>process.stdout.write(JSON.stringify(value)+'\n');
  let browser;
  try {
    let playwright;
    try { playwright = require('playwright'); }
    catch { playwright = require('./qa/node_modules/playwright'); }
    browser = await playwright.chromium.launch({headless:true,
      executablePath:await browserExecutable(playwright.chromium)});
  } catch(error) {
    for (const provider of providers) emit({...provider, outcome:'unavailable',
      message:'Verification browser could not start. Check Synth Forge’s Playwright/Chromium setup and browser permissions. '+error.message.slice(0,400)});
    return;
  }
  process.once('SIGTERM', async()=>{await browser.close();process.exit(0);});
  try {
    for (const provider of providers) {
      emit({...provider, outcome:'checking', message:'Checking the final image…'});
      const page = await browser.newPage();
      try { emit({...provider, ...await check(page,provider,image,evidenceDirectory)}); }
      catch(error) {
        let evidence;
        try {await page.screenshot({path:path.join(evidenceDirectory,provider.id+'.png'),fullPage:true,timeout:5000});evidence=provider.id+'.png';} catch {}
        let visible='';
        try {visible=(await page.locator('body').innerText({timeout:3000})).slice(0,1200);} catch {}
        emit({...provider, outcome:'unavailable',
          message:'The provider page could not complete the check. It may require sign-in, a browser challenge, or be temporarily unavailable.'+(visible ? '\n\nPage response:\n'+visible : ''),
          ...(evidence ? {evidence}: {})});
      }
      finally { await page.close(); }
    }
  } finally { await browser.close(); }
}

module.exports = {classify, check, providers};
if (require.main === module) main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
