// Two independent devices share a mocked GitHub file. No real network/data writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {chromium}=createRequire(path.join(process.env.HEALTH_TEST_NODE_MODULES,'_two.cjs'))('playwright');
const out=path.resolve(__dirname,'../test-results',process.env.HEALTH_TEST_RUN||'20260907-mobile-sync'),results=[];
let browser,server,origin,remote=null,rev=0,gets=0,puts=0;
async function check(name,fn){try{await fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:e.message});}console.log(results.at(-1).status+' '+name);}
async function device(){
  const ctx=await browser.newContext({serviceWorkers:'block'});await ctx.route('**/*',async r=>{
    const q=r.request(),u=new URL(q.url());if(u.origin===origin)return r.continue();if(u.origin!=='https://api.github.com')return r.abort();
    if(q.method()==='GET'){gets++;return r.fulfill({status:remote?200:404,contentType:'application/json',body:remote?JSON.stringify({sha:String(rev),content:Buffer.from(JSON.stringify(remote)).toString('base64')}):'{}'});}
    if(q.method()==='PUT'){const body=q.postDataJSON();if(remote&&body.sha!==String(rev))return r.fulfill({status:409,body:'{}'});puts++;remote=JSON.parse(Buffer.from(body.content,'base64').toString());rev++;return r.fulfill({status:200,body:'{}'});}
    return r.abort();
  });const p=await ctx.newPage();await p.goto(origin);await p.evaluate(()=>{D.settings.github={owner:'synthetic',repo:'synthetic',path:'data.json',token:'synthetic-token'};save(true);renderSet();});return p;
}
const sync=p=>p.evaluate(()=>doSync(true));
const counts=p=>p.evaluate(()=>Object.fromEntries(Object.entries(getDay().meals).map(([k,v])=>[k,v.length])));
async function record(p,meal,name){await p.evaluate(({meal,name})=>{getDay().meals[meal].push({name,c:20,p:10,f:5});touch(todayStr());}, {meal,name});}
(async()=>{
  fs.mkdirSync(out,{recursive:true});server=http.createServer((q,s)=>{s.setHeader('Content-Type','text/html;charset=utf-8');s.end(fs.readFileSync(path.resolve(__dirname,'../index.html')));});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});const pc=await device(),phone=await device();
  await check('电脑录入后手机首次同步获得同一份饮食',async()=>{await record(pc,'breakfast','电脑早餐');await sync(pc);await sync(phone);assert.equal((await counts(phone)).breakfast,1);assert.equal(remote.days[await phone.evaluate(()=>todayStr())].meals.breakfast.length,1);});
  await check('手机修改后电脑重新拉取获得更新',async()=>{await record(phone,'lunch','手机午餐');await sync(phone);await sync(pc);assert.equal((await counts(pc)).lunch,1);assert.deepEqual(await counts(pc),await counts(phone));});
  await check('两端离线修改不同餐次，合并后均保留',async()=>{await record(pc,'dinner','电脑晚餐');await record(phone,'snack','手机加餐');await sync(pc);await sync(phone);await sync(pc);assert.deepEqual(await counts(pc),{breakfast:1,lunch:1,dinner:1,snack:1});assert.deepEqual(await counts(pc),await counts(phone));});
  await check('手机修改当日体重后电脑旧值不覆盖新值',async()=>{await pc.evaluate(()=>{D.weights=[{d:todayStr(),kg:80,updatedAt:100}];save();});await sync(pc);await sync(phone);await phone.evaluate(()=>{document.getElementById('weightInput').value='79';addWeight();});await sync(phone);await sync(pc);assert.equal(await pc.evaluate(()=>D.weights.at(-1).kg),79);});
  await check('前台恢复事件主动拉取另一端新记录',async()=>{await record(pc,'dinner','电脑晚餐补记');await sync(pc);const before=gets;await phone.evaluate(()=>{syncStarted=0;window.dispatchEvent(new Event('focus'));});await phone.waitForFunction(()=>!syncBusy);assert.ok(gets>before);assert.equal((await counts(phone)).dinner,2);});
  await check('没有健康数据变化时只拉取，不重复创建提交',async()=>{await sync(pc);await sync(phone);const before=puts;await sync(pc);await sync(phone);assert.equal(puts,before);});
  await check('两端同时修改同一餐时提示冲突并保留旧版本',async()=>{await record(pc,'breakfast','电脑同时编辑');await record(phone,'breakfast','手机同时编辑');await sync(pc);await sync(phone);assert.match(await phone.locator('#syncState').innerText(),/冲突/);assert.equal(await phone.evaluate(()=>D.dayHistory.some(x=>x.day.meals.breakfast.some(f=>f.name==='电脑同时编辑'||f.name==='手机同时编辑'))),true);});
  await check('自动同步不覆盖正在编辑的配置输入',async()=>{await phone.locator('[data-page="set"]').click();await phone.locator('#aiModel').fill('尚未保存的模型');const before=gets;await phone.evaluate(()=>{syncStarted=0;window.dispatchEvent(new Event('online'));});assert.equal(gets,before);assert.equal(await phone.locator('#aiModel').inputValue(),'尚未保存的模型');});
  await check('本机密钥和同步基线不进入云端文件',async()=>{assert.equal(remote.settings.github.token,undefined);assert.equal(remote.syncBaseDays,undefined);assert.equal(remote.lastSync,undefined);});
})().catch(e=>results.push({name:'harness',status:'FAIL',error:e.message})).finally(async()=>{await browser?.close();server?.close();const report={date:new Date().toISOString(),syntheticOnly:true,realDataWrites:0,gets,mockedPuts:puts,results,pass:results.filter(x=>x.status==='PASS').length,fail:results.filter(x=>x.status==='FAIL').length};fs.writeFileSync(path.join(out,'two-device-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,fail:report.fail}));process.exitCode=report.fail?1:0;});
