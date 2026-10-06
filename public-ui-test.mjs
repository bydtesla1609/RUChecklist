import assert from "node:assert/strict";
import {createServer} from "node:http";
import {once} from "node:events";
import {readFile,mkdir} from "node:fs/promises";
import trial from "./trial-worker.mjs";
process.env.TRIAL_UI_FIXTURE="1";
const {trialFixture}=await import("./trial-test.mjs");
const {env,database,invites,client}=await trialFixture();
await client().api("/api/register","POST",{username:"original_user",password:"Ab1234",invite:invites[0]});env.PUBLIC_REGISTRATION="true";env.CLOUD_ENCRYPTION_KEY="12".repeat(32);
env.ASSETS={async fetch(request){const name=new URL(request.url).pathname.slice(1) || "index.html";return new Response(await readFile(new URL(`./static/${name}`,import.meta.url)),{headers:{"Content-Type":name.endsWith(".html")?"text/html":name.endsWith(".js")?"text/javascript":name.endsWith(".css")?"text/css":"image/svg+xml"}});}};
const server=createServer(async(req,res)=>{
  const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!["GET","HEAD"].includes(req.method)?{body:req,duplex:"half"}:{})});
  const result=await trial.fetch(request,env);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
});
server.listen(0,"127.0.0.1");await once(server,"listening");const origin=`http://localhost:${server.address().port}`;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || "playwright");const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.matchMedia;});
  await page.goto(origin);await page.locator('#login').waitFor();
  assert.equal(await page.locator('#public-user-count').textContent(),'1');
  await page.screenshot({path:'data/screenshots/public-login-desktop.png',fullPage:true,animations:'disabled'});
  for(const width of [320,390,768]){
    await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'landing overflow '+width);
  }
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'data/screenshots/public-login-mobile.png',fullPage:true,animations:'disabled'});
  await page.locator('#auth-register').click();assert.equal(await page.locator('#invite-field').isVisible(),false);
  assert.equal(await page.locator('#password-label').textContent(),'密码');assert.equal(await page.locator('#password').getAttribute('placeholder'),'至少 6 位，含英文和数字');
  await page.locator('#username').fill('public_student');await page.locator('#password').fill('Ab1234');await page.locator('#remember-login').check();
  await page.locator('#login-form button[type=submit]').click();await page.locator('#recovery-dialog').waitFor();
  assert.ok((await context.cookies()).find(c=>c.name==='trial_session').expires>Date.now()/1000+29*86400);
  const id=database.prepare("SELECT id FROM trial_users WHERE username='public_student'").get().id;
  await page.evaluate(id=>localStorage.setItem('ruchecklist-demo:'+id,'seen'),id);
  const download=page.waitForEvent('download');await page.locator('#download-recovery').click();await download;await page.locator('#recovery-done').click();
  await page.waitForFunction(()=>messageReady);if(await page.locator('#messages-dialog').isVisible())await page.locator('#messages-read').click();
  assert.equal(await page.locator('#user-card-name').textContent(),'public_student');
  await page.evaluate(async()=>{await api('/api/logout','POST',{});showLogin();});
  await page.locator('#auth-login').click();await page.locator('#username').fill('original_user');await page.locator('#password').fill('Ab1234');await page.locator('#remember-login').uncheck();
  await page.locator('#login-form button[type=submit]').click();await page.locator('#workspace').waitFor();
  assert.equal((await context.cookies()).find(c=>c.name==='trial_session').expires,-1);
  assert.equal(await page.locator('#user-card-name').textContent(),'original_user');
  assert.equal(database.prepare('SELECT count(*) n FROM trial_users').get().n,2);
  assert.deepEqual(errors,[]);console.log('PASS: public signup without invite, real count, original login, opt-in persistent/session cookies, and responsive landing page.');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();}
