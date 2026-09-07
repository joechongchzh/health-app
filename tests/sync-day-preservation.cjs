// Reproduce a new device opening an empty day before its first sync. Synthetic data only.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {chromium}=createRequire(path.join(process.env.HEALTH_TEST_NODE_MODULES,'_day.cjs'))('playwright');
const out=path.resolve(__dirname,'../test-results',process.env.HEALTH_TEST_RUN||'20260907-mobile-sync'),results=[];
let browser,server,origin;
async function check(name,fn){
  const ctx=await browser.newContext({serviceWorkers:'block'});await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const p=await ctx.newPage();try{await p.goto(origin);await fn(p);results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:e.message});}finally{await ctx.close();console.log(results.at(-1).status+' '+name);}
}
async function sync(p,mode){return p.evaluate(async mode=>{
  const date=mode==='historical'?dateOffset(todayStr(),-1):todayStr();
  if(mode==='historical'){curDate=date;renderAll();}
  const remoteDay={type:'rest',trainTime:'evening',meals:{breakfast:[{name:'合成早餐',c:30,p:15,f:8}],lunch:[],dinner:[],snack:[]},workouts:[],supps:{},updatedAt:Date.now()-60000};
  if(mode==='deleted'){D.days[date]=JSON.parse(JSON.stringify(remoteDay));D.days[date].meals.breakfast=[];touch(date);}
  D.settings.github={owner:'synthetic',repo:'synthetic',path:'data.json',token:'synthetic-token'};save(true);renderSet();let pushed,gets=0;
  window.fetch=async(u,o={})=>{if(o.method==='PUT'){pushed=JSON.parse(b64decode(JSON.parse(o.body).content));return new Response('{}');}gets++;return new Response(JSON.stringify({sha:'synthetic-sha',content:b64encode(JSON.stringify({ver:6,days:{[date]:remoteDay}}))}));};
  await doSync(false);
  return {gets,local:D.days[date].meals.breakfast.length,uploaded:pushed?.days[date].meals.breakfast.length,history:D.dayHistory.some(x=>x.date===date&&x.day.meals.breakfast.length===1),status:document.getElementById('syncState').textContent};
},mode);}
(async()=>{
  fs.mkdirSync(out,{recursive:true});server=http.createServer((q,s)=>{s.setHeader('Content-Type','text/html;charset=utf-8');s.end(fs.readFileSync(path.resolve(__dirname,'../index.html')));});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
  await check('新设备打开今日后首次同步保留云端饮食及上传内容',async p=>{const r=await sync(p,'today');assert.equal(r.gets,1);assert.equal(r.local,1);assert.equal(r.uploaded,1);assert.match(r.status,/已同步/);await p.reload();assert.equal(await p.evaluate(()=>getDay().meals.breakfast.length),1);});
  await check('仅浏览历史日期不覆盖云端已有记录',async p=>{const r=await sync(p,'historical');assert.equal(r.local,1);assert.equal(r.uploaded,1);});
  await check('用户实际清空餐次仍可同步且原内容进入历史副本',async p=>{const r=await sync(p,'deleted');assert.equal(r.local,0);assert.equal(r.uploaded,0);assert.equal(r.history,true);});
})().catch(e=>results.push({name:'harness',status:'FAIL',error:e.message})).finally(async()=>{await browser?.close();server?.close();const report={date:new Date().toISOString(),syntheticOnly:true,realDataWrites:0,results,pass:results.filter(x=>x.status==='PASS').length,fail:results.filter(x=>x.status==='FAIL').length};fs.writeFileSync(path.join(out,'sync-day-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,fail:report.fail}));process.exitCode=report.fail?1:0;});
