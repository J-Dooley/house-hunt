// Optional browser smoke test: run in an environment with Playwright + Chromium.
const {chromium}=require('playwright');
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const file=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',file.endsWith('.mjs')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>!document.querySelector('#automation-status').textContent.startsWith('Loading'));
  assert.equal(await page.locator('#total').innerText(),'80');
  assert.equal(await page.locator('.card').count(),0,'Unverified records must not show as active');
  await page.getByRole('button',{name:'Saved archive',exact:true}).click();
  assert.equal(await page.locator('.card').count(),80);
  const before=await page.locator('#faves').innerText();
  await page.locator('[data-kind="favorites"]').first().click();
  assert.equal(Number(await page.locator('#faves').innerText()),Number(before)+1);
  await page.reload({waitUntil:'networkidle'});
  assert.equal(Number(await page.locator('#faves').innerText()),Number(before)+1,'Local favorites survive reload');
  assert.equal(await page.locator('.card').count(),0);
  await page.screenshot({path:'/tmp/househunt-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/househunt-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:await page.locator('#automation-status').innerText(),saved:80,active:0,errors}));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
