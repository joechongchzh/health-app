// Migration, merge, recovery and service-worker transition tests. No real API writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {chromium}=createRequire(path.join(process.env.HEALTH_TEST_NODE_MODULES,'_test.cjs'))('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results',process.env.HEALTH_TEST_RUN||'20260907-fix');
const results=[];let browser,server,oldVersion=false;
const oldWorker=`self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(new Response('<html><body>OLD V3 CACHE</body></html>',{headers:{'Content-Type':'text/html'}}));});`;
async function check(id,name,fn){try{await fn();results.push({id,name,status:'PASS'});}catch(e){results.push({id,name,status:'FAIL',error:e.message.slice(0,250)});}console.log(results.at(-1).status+' '+id+' '+name);}
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  server=http.createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.url.split('?')[0]==='/health-app/sw.js'){res.setHeader('Content-Type','application/javascript');res.end(oldVersion?oldWorker:fs.readFileSync(path.join(root,'sw.js')));}
    else {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(oldVersion?'<html><body>OLD V3 NETWORK</body></html>':fs.readFileSync(path.join(root,'index.html')));}
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,url=origin+'/health-app/';
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
  const ctx=await browser.newContext({serviceWorkers:'block'});await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const page=await ctx.newPage();await page.goto(url);
  const base=await page.evaluate(()=>JSON.parse(JSON.stringify(D)));
  const reset=async()=>page.evaluate(b=>{D=JSON.parse(JSON.stringify(b));D.foods=[];D.combos=[];D.days={};D.weights=[];D.pending=[];D.removedFoods=[];D.removedCombos=[];D.libraryTrash={foods:[],combos:[]};D.aiChat=[];save();},base);
  const food={name:'测试原餐',serv:'100g',servG:100,c:10,p:20,f:5,cat:'自定义',user:true,ts:100,uses:0};
  await check('P01','删除、回收站恢复、陈旧副本重同步不丢记录',async()=>{
    await reset();assert.deepEqual(await page.evaluate(f=>{D.foods=[f];getDay().meals.lunch=[commitItem(f,2,'gram')];const old=publicData();aiExec({type:'delete_food',name:f.name});const deleted=D.foods.length;mergeData(old);const stillDeleted=D.foods.length;restoreLibraryEntry('foods',0);mergeData(old);return [deleted,stillDeleted,D.foods.length,D.foods[0].c,getDay().meals.lunch[0].c,D.libraryTrash.foods.length>0];},food),[0,0,1,10,20,true]);
  });
  await check('P02','重复合并和相反顺序合并得到相同库内容',async()=>{
    await reset();assert.equal(await page.evaluate(f=>{const a=publicData();a.foods=[f];const b=JSON.parse(JSON.stringify(a));b.foods[0].c=77;b.foods[0].updatedAt=300;D=JSON.parse(JSON.stringify(a));mergeData(b);const first=stableJson(D.foods);for(let i=0;i<10;i++)mergeData(a);const repeated=stableJson(D.foods);D=b;mergeData(a);return first===repeated&&first===stableJson(D.foods);},food),true);
  });
  await check('P03','同时间冲突稳定收敛且落选版本进入回收站',async()=>{
    await reset();assert.equal(await page.evaluate(f=>{const a=publicData();a.foods=[f];const b=JSON.parse(JSON.stringify(a));b.foods[0].c=88;D=JSON.parse(JSON.stringify(a));mergeData(b);const first=stableJson(D.foods);const archived=D.libraryTrash.foods.length;D=b;mergeData(a);return first===stableJson(D.foods)&&archived===1&&D.libraryTrash.foods.length===1;},food),true);
  });
  await check('P04','旧文件活跃条目与旧删除标记冲突时首次导入完整保留',async()=>{
    await reset();assert.deepEqual(await page.evaluate(f=>{mergeData({ver:5,foods:[f],removedFoods:[{n:f.name,ts:200}]});const count=D.foods.length;deleteLibraryEntry('foods',f.name);mergeData({ver:5,foods:[f],removedFoods:[{n:f.name,ts:200}]});return [count,D.foods.length,D.libraryTrash.foods.length>0];},food),[1,0,true]);
  });
  await check('P05','非法远端日期数据拒绝且回滚整个合并',async()=>{
    await reset();assert.equal(await page.evaluate(f=>{D.foods=[f];const before=stableJson(D);try{mergeData({foods:[],days:{bad:{}}});return false;}catch{return stableJson(D)===before;}},food),true);
  });
  await check('P06','库更新和整餐重算的连续AI卡片预览及确认一致',async()=>{
    await reset();assert.deepEqual(await page.evaluate(f=>{D.foods=[f];const acts=prepareAiActions([{type:'update_food',name:f.name,c:42,p:18,f:7,servG:100},{type:'set_meal',meal:'lunch',items:[{name:f.name,amt:'200g',c:1,p:1,f:1}]}]);const untouched=D.foods[0].c;aiPush({role:'assistant',text:'确认',cards:acts.map(action=>({action,status:'pending'}))});aiConfirm(0,0);aiConfirm(0,1);return [untouched,acts[1].items[0].c,getDay().meals.lunch[0].c,D.aiChat[0].cards.every(c=>c.status==='done')];},food),[10,84,84,true]);
  });
  await check('P07','确认前库已变化时先重算卡片再次确认才写入',async()=>{
    await reset();assert.deepEqual(await page.evaluate(f=>{D.foods=[f];const a=prepareAiAction({type:'log_food',meal:'lunch',items:[{name:f.name,amt:'200g',c:20,p:40,f:10}]});aiPush({role:'assistant',text:'确认',cards:[{action:a,status:'pending'}]});D.foods[0].c=30;aiConfirm(0,0);const n=getDay().meals.lunch.length;aiConfirm(0,0);return [n,getDay().meals.lunch[0].c];},food),[0,60]);
  });
  await check('P08','删除库后编辑历史餐次仍使用当时的份量快照',async()=>{
    await reset();assert.equal(await page.evaluate(f=>{D.foods=[f];getDay().meals.lunch=[commitItem(f,2,'gram')];deleteLibraryEntry('foods',f.name);editFood('lunch',0);confirmAddFood();return getDay().meals.lunch[0].c;},food),20);
  });
  await check('P09','不同时点日记录合并保留被覆盖的完整日快照',async()=>{
    await reset();assert.equal(await page.evaluate(()=>{const d=getDay();d.updatedAt=100;d.meals.lunch=[{name:'旧记录',c:1,p:2,f:3}];const rd=JSON.parse(JSON.stringify(d));rd.updatedAt=200;rd.meals.lunch=[];mergeData({days:{[todayStr()]:rd}});return D.dayHistory.some(x=>x.day.meals.lunch[0]?.name==='旧记录')&&getDay().meals.lunch.length===0;}),true);
  });
  await check('P10','非法云端JSON时同步不推送且原本地记录保留',async()=>{
    await reset();assert.deepEqual(await page.evaluate(async f=>{D.foods=[f];D.settings.github={owner:'fixture',repo:'fixture',path:'data.json',token:'synthetic'};save(true);renderSet();let gets=0,puts=0;window.fetch=async(u,o={})=>{if(o.method==='PUT'){puts++;return new Response('{}');}gets++;return new Response(JSON.stringify({sha:'fixture',content:b64encode('invalid json')}));};await doSync(true);return [gets,puts,D.foods[0].c];},food),[1,0,10]);await page.reload();
  });
  await check('P11','旧版升级备份精确保存且刷新不复活已删食物',async()=>{
    await reset();const legacy={...base,ver:5,foods:[food],removedFoods:[{n:food.name,ts:500}],days:{},settings:{},split:[{key:'own',name:'自定',ex:['自定动作']}],splitUpd:900};
    const raw=JSON.stringify(legacy);await page.evaluate(raw=>{localStorage.removeItem('ht_backup_before_v6');localStorage.setItem(LS_KEY,raw);},raw);await page.reload();
    assert.deepEqual(await page.evaluate(raw=>[D.foods.length,D.ver,D.split[0].name,localStorage.getItem('ht_backup_before_v6')===raw],raw),[1,6,'自定',true]);
    await page.evaluate(()=>{deleteLibraryEntry('foods','测试原餐');save();});await page.reload();assert.equal(await page.evaluate(()=>D.foods.length),0);
  });
  await check('P12','损坏本地JSON不被默认值覆盖',async()=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.name));page.on('dialog',d=>d.dismiss());await page.evaluate(()=>localStorage.setItem('ht_data_v1','{invalid'));await page.reload();assert.equal(await page.evaluate(()=>localStorage.getItem('ht_data_v1')),'{invalid');assert.ok(errors.length);await page.evaluate(()=>localStorage.removeItem('ht_data_v1'));await page.reload();
  });
  if(process.env.HEALTH_PRIVATE_FIXTURE)await check('P13','真实备份副本的全部餐次、训练、体重、套餐、食物逐项保留',async()=>{
    // Credentials removed before entering browser; no record values appear in reports.
    const legacy=JSON.parse(fs.readFileSync(process.env.HEALTH_PRIVATE_FIXTURE,'utf8'));legacy.settings={};legacy.aiChat=[];
    await page.evaluate(d=>{localStorage.removeItem('ht_backup_before_v6');localStorage.setItem('ht_data_v1',JSON.stringify(d));},legacy);await page.reload();
    const summary=await page.evaluate(before=>{
      const subset=(a,b)=>Object.keys(a).every(k=>JSON.stringify(a[k])===JSON.stringify(b[k]));
      return {days:Object.entries(before.days).every(([k,v])=>subset(v,D.days[k])),weights:JSON.stringify(before.weights)===JSON.stringify(D.weights),combos:before.combos.every(c=>D.combos.some(n=>subset(c,n))),foods:before.foods.every(f=>D.foods.some(n=>subset(f,n))),split:JSON.stringify(before.split)===JSON.stringify(D.split),counts:[Object.keys(before.days).length,before.foods.length,before.combos.length,before.weights.length]};
    },legacy);
    assert.ok(summary.days&&summary.weights&&summary.combos&&summary.foods&&summary.split,'Record preservation mismatch (values withheld)');
    await page.evaluate(()=>save());await page.reload();assert.equal(await page.evaluate(()=>D.foods.length),legacy.foods.length);
    await reset();await page.evaluate(d=>{mergeData(d);save();},legacy);assert.equal(await page.evaluate(()=>D.foods.length),legacy.foods.length);
  });
  await ctx.close();
  await check('P14','v3旧缓存切换至单HTML及离线启动保留原LocalStorage和IndexedDB',async()=>{
    oldVersion=true;const swctx=await browser.newContext();const p=await swctx.newPage();await p.goto(url);
    await p.evaluate(async()=>{
      localStorage.setItem('ht_data_v1',JSON.stringify({ver:5,foods:[],days:{},settings:{}}));localStorage.setItem('preservation-probe','unchanged');
      await new Promise((resolve,reject)=>{const r=indexedDB.open('v3-preservation-probe',1);r.onupgradeneeded=()=>r.result.createObjectStore('records');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction('records','readwrite');t.objectStore('records').put('unchanged','record');t.oncomplete=()=>{db.close();resolve();};};});
      await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;
    });await p.waitForFunction(()=>!!navigator.serviceWorker.controller);await p.reload();assert.ok((await p.textContent('body')).includes('OLD V3 CACHE'));
    oldVersion=false;
    // The browser's normal registration update fetches the replacement worker.
    await p.evaluate(async()=>{
      const old=navigator.serviceWorker.controller;
      const changed=new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',()=>{if(navigator.serviceWorker.controller!==old)resolve();},{once:true}));
      const r=await navigator.serviceWorker.getRegistration();await r.update();await changed;
    });
    await p.reload();assert.equal(await p.locator('meta[name="health-app-version"]').getAttribute('content'),'2.8.3');
    const unchanged=()=>p.evaluate(async()=>[localStorage.getItem('preservation-probe'),await new Promise((resolve,reject)=>{const r=indexedDB.open('v3-preservation-probe');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,q=db.transaction('records').objectStore('records').get('record');q.onsuccess=()=>{db.close();resolve(q.result);};};})]);
    assert.deepEqual(await unchanged(),['unchanged','unchanged']);await swctx.setOffline(true);await p.reload();assert.equal(await p.locator('meta[name="health-app-version"]').getAttribute('content'),'2.8.3');assert.deepEqual(await unchanged(),['unchanged','unchanged']);await swctx.close();
  });
})().catch(e=>{results.push({id:'HARNESS',status:'FAIL',error:e.message});}).finally(async()=>{
  await browser?.close();server?.close();const report={date:new Date().toISOString(),realDataWrites:0,results,pass:results.filter(x=>x.status==='PASS').length,fail:results.filter(x=>x.status==='FAIL').length};fs.writeFileSync(path.join(out,'preservation-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,fail:report.fail}));process.exitCode=report.fail?1:0;
});
