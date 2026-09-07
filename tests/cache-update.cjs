// Exercise real service-worker fetch/update behavior with isolated synthetic storage.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {chromium}=createRequire(path.join(process.env.HEALTH_TEST_NODE_MODULES,'_cache.cjs'))('playwright');
const root=path.resolve(process.env.HEALTH_CACHE_ROOT||path.join(__dirname,'..'));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const version=html.match(/name="health-app-version" content="([^"]+)"/)[1];
const next=version.split('.').map(Number);next[2]++;const nextVersion=next.join('.');next[2]++;const finalVersion=next.join('.');
const out=path.resolve(__dirname,'../test-results',process.env.HEALTH_TEST_RUN||'20260907-stale-client'),results=[];
let browser,server,htmlVersion=version,workerVersion=version,badHtml=false;
async function check(name,fn){try{await fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:e.message});}console.log(results.at(-1).status+' '+name);}
(async()=>{
  fs.mkdirSync(out,{recursive:true});server=http.createServer((q,s)=>{
    s.setHeader('Cache-Control','no-store');
    if(q.url.split('?')[0].endsWith('/sw.js')){s.setHeader('Content-Type','application/javascript');s.end(worker.replaceAll(version,workerVersion));}
    else {s.setHeader('Content-Type','text/html;charset=utf-8');s.end(badHtml?'<html>Temporary deploy error</html>':html.replaceAll(version,htmlVersion));}
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});const ctx=await browser.newContext();
  await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());const p=await ctx.newPage();await p.goto(origin+'/health-app/');
  await p.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const settings=await p.evaluate(()=>{D.settings.github={owner:'',repo:'',path:'data.json',token:'synthetic-kept-token'};D.settings.ai={base:'https://synthetic.invalid',model:'synthetic-model',key:'synthetic-kept-key'};getDay().meals.lunch=[{name:'合成午餐',c:20,p:10,f:5}];touch(todayStr());save(true);return D.settings;});
  const unchanged=async()=>{assert.deepEqual(await p.evaluate(()=>D.settings),settings);assert.equal(await p.evaluate(()=>getDay().meals.lunch[0].name),'合成午餐');};
  await check('旧worker收到新版HTML直接显示新版，不再退回旧缓存',async()=>{
    htmlVersion=nextVersion;await p.reload();assert.equal(await p.locator('meta[name="health-app-version"]').getAttribute('content'),nextVersion);await unchanged();
  });
  await check('新版页面离线重开，饮食及Token/API Key完整保留',async()=>{
    await ctx.setOffline(true);await p.reload();assert.equal(await p.locator('meta[name="health-app-version"]').getAttribute('content'),nextVersion);await unchanged();await ctx.setOffline(false);
  });
  await ctx.setOffline(false);
  await check('部署暂时返回错误HTML时保留最近可用版本',async()=>{
    badHtml=true;await p.reload();assert.equal(await p.locator('meta[name="health-app-version"]').getAttribute('content'),nextVersion);await unchanged();badHtml=false;
  });
  badHtml=false;
  if(!process.env.HEALTH_CACHE_ROOT)await check('后台worker更新提示用户，不丢失尚未保存的输入',async()=>{
    await p.locator('[data-page="set"]').click();await p.locator('#aiModel').fill('尚未保存的输入');htmlVersion=finalVersion;workerVersion=finalVersion;
    await p.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await reg.update();});await p.locator('#appUpdate').waitFor({state:'visible'});
    assert.equal(await p.locator('#aiModel').inputValue(),'尚未保存的输入');await unchanged();
    await p.locator('#appUpdate button').click();await p.waitForFunction(v=>document.querySelector('meta[name="health-app-version"]').content===v,finalVersion);await unchanged();
  });
})().catch(e=>results.push({name:'harness',status:'FAIL',error:e.message})).finally(async()=>{
  await browser?.close();server?.close();const report={date:new Date().toISOString(),version,syntheticOnly:true,realDataWrites:0,results,pass:results.filter(x=>x.status==='PASS').length,fail:results.filter(x=>x.status==='FAIL').length};
  fs.writeFileSync(path.join(out,'cache-update-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,fail:report.fail}));process.exitCode=report.fail?1:0;
});
