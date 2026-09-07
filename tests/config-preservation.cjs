// Synthetic credentials in isolated browser contexts; external requests blocked or mocked.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {chromium}=createRequire(path.join(process.env.HEALTH_TEST_NODE_MODULES,'_config.cjs'))('playwright');
const out=path.resolve(__dirname,'../test-results',process.env.HEALTH_TEST_RUN||'20260907-config'),results=[];
const settings={github:{owner:'synthetic-owner',repo:'synthetic-repo',path:'custom.json',token:'synthetic-gh'},ai:{base:'https://chat.invalid',key:'synthetic-chat',model:'chat'},aiVision:{base:'https://vision.invalid',key:'synthetic-vision',model:'vision'},aiVoice:{base:'https://voice.invalid',key:'synthetic-voice',model:'voice'}};
const legacy={ver:5,settings,foods:[],combos:[],days:{},split:[{key:'custom',name:'合成训练',ex:['合成动作']}],splitUpd:100};
let browser,server,origin;
async function check(name,fn){
  const ctx=await browser.newContext({serviceWorkers:'block'});
  await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const p=await ctx.newPage();p.on('dialog',d=>d.dismiss());
  try{await p.goto(origin);await fn(p,ctx);results.push({name,status:'PASS'});}
  catch(e){results.push({name,status:'FAIL',error:e.message});}
  finally{await ctx.close();console.log(results.at(-1).status+' '+name);}
}
async function seed(p,d=legacy,extra={}){
  await p.evaluate(({d,extra})=>{
    localStorage.clear();localStorage.setItem('ht_data_v1',JSON.stringify(d));
    for(const [k,v] of Object.entries(extra))localStorage.setItem(k,typeof v==='string'?v:JSON.stringify(v));
  },{d,extra});await p.reload();
}
async function same(p,expected=settings){assert.deepEqual(await p.evaluate(()=>D.settings),expected);}
(async()=>{
  fs.mkdirSync(out,{recursive:true});server=http.createServer((q,s)=>{s.setHeader('Content-Type','text/html; charset=utf-8');s.end(fs.readFileSync(path.resolve(__dirname,'../index.html')));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
  await check('真实v5存储形态升级，原JSON备份及全部配置保留',async p=>{
    await seed(p);await same(p);assert.equal(await p.evaluate(()=>localStorage.getItem('ht_backup_before_v6')),JSON.stringify(legacy));
    await p.reload();await same(p);assert.equal(await p.evaluate(()=>D.split[0].key),'custom');
  });
  await check('v6首次迁入独立配置存储，刷新逐项一致',async p=>{
    await seed(p,{...legacy,ver:6});await same(p);await p.reload();await same(p);
    assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('ht_settings_v1')).settings),settings);
  });
  await check('健康JSON配置缺失时从独立存储恢复',async p=>{
    await seed(p);await p.evaluate(()=>{const d=JSON.parse(localStorage.getItem('ht_data_v1'));delete d.settings;localStorage.setItem('ht_data_v1',JSON.stringify(d));});
    await p.reload();await same(p);
  });
  await check('主配置存储损坏时从本机备份恢复',async p=>{
    await seed(p);await p.evaluate(()=>{localStorage.setItem('ht_settings_v1','{invalid');localStorage.removeItem('ht_data_v1');});
    await p.reload();await same(p);
  });
  await check('首次恢复旧备份缺失插槽，保留刚填写的新AI配置',async p=>{
    const ai={base:'https://new.invalid',key:'synthetic-new',model:'new'};
    await seed(p,{...legacy,ver:6,settings:{ai}},{ht_backup_before_v6:legacy});await same(p,{...settings,ai});
  });
  await check('部分新配置不混入旧服务商密钥',async p=>{
    await seed(p,{...legacy,ver:6,settings:{ai:{base:'https://new.invalid'}}},{ht_backup_before_v6:legacy});
    assert.deepEqual(await p.evaluate(()=>D.settings.ai),{base:'https://new.invalid',key:'',model:''});
  });
  await check('设置页主动修改及清空模型，刷新不复活旧值',async p=>{
    await seed(p);await p.locator('[data-page="set"]').click();
    await p.locator('#aiKey').fill('synthetic-manual');await p.locator('#viBase').fill('');await p.locator('#viKey').fill('');await p.locator('#viModel').fill('');
    await p.getByRole('button',{name:'保存全部',exact:true}).click();await p.reload();
    await same(p,{...settings,ai:{...settings.ai,key:'synthetic-manual'},aiVision:{base:'',key:'',model:''}});
  });
  await check('导入远端配置不覆盖本机，普通导出无凭据和聊天',async p=>{
    await seed(p);await p.evaluate(()=>{mergeData({settings:{github:{token:'synthetic-remote'},ai:{key:'synthetic-remote'}}});D.aiChat=[{text:'synthetic-private-chat'}];save();});
    await p.reload();await same(p);const exported=await p.evaluate(()=>publicData());
    assert.equal(exported.aiChat,undefined);assert.equal(exported.settingsUpdatedAt,undefined);assert.equal(exported.settings.github.token,undefined);
    for(const k of ['ai','aiVision','aiVoice'])assert.equal(exported.settings[k].key,undefined);
    await same(p);
  });
  await check('手动GitHub同步保存输入，模拟请求成功且上传无凭据',async(p,ctx)=>{
    await seed(p);await p.locator('[data-page="set"]').click();await p.locator('#ghRepo').fill('synthetic-new-repo');let pushed;
    await ctx.route('https://api.github.com/**',async r=>{
      if(r.request().method()==='PUT'){pushed=JSON.parse(Buffer.from(r.request().postDataJSON().content,'base64').toString());await r.fulfill({status:200,body:'{}'});}
      else await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({sha:'synthetic',content:Buffer.from(JSON.stringify({ver:6,settings:{ai:{key:'remote'}}})).toString('base64')})});
    });
    await p.evaluate(()=>doSync(false));assert.ok(pushed);assert.equal(pushed.settings.github.token,undefined);assert.equal(pushed.settings.ai.key,undefined);
    await p.reload();await same(p,{...settings,github:{...settings.github,repo:'synthetic-new-repo'}});
  });
  await check('旧标签页保存健康记录不回写另一标签页的新配置',async(p,ctx)=>{
    await seed(p);const p2=await ctx.newPage();await p2.goto(origin);
    await p2.evaluate(()=>{D.settings.ai.key='synthetic-new-tab';D.settings.github.path='new-tab.json';save(true);});
    await p.evaluate(()=>{D.weights.push({d:'2026-09-01',kg:80});save();});await p.reload();
    await same(p,{...settings,ai:{...settings.ai,key:'synthetic-new-tab'},github:{...settings.github,path:'new-tab.json'}});
    assert.equal(await p.evaluate(()=>D.weights.length),1);
  });
  await check('后台自动同步不从旧表单覆盖新配置',async(p,ctx)=>{
    await seed(p);const p2=await ctx.newPage();await p2.goto(origin);
    await p2.evaluate(()=>{D.settings.github.path='latest.json';save(true);});
    await p.evaluate(()=>doSync(true));await p.reload();await same(p,{...settings,github:{...settings.github,path:'latest.json'}});
  });
  await check('配置备份写入失败时保留原健康JSON',async p=>{
    await seed(p);const before=await p.evaluate(()=>localStorage.getItem('ht_data_v1'));
    assert.equal(await p.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='ht_settings_backup_v1')throw new DOMException('Synthetic quota','QuotaExceededError');return original.call(this,k,v);};try{D.settings.ai.key='synthetic-quota';save(true);return false;}catch{return true;}finally{Storage.prototype.setItem=original;}}),true);
    assert.equal(await p.evaluate(()=>localStorage.getItem('ht_data_v1')),before);await p.reload();await same(p,{...settings,ai:{...settings.ai,key:'synthetic-quota'}});
  });
})().catch(e=>results.push({name:'harness',status:'FAIL',error:e.message})).finally(async()=>{
  await browser?.close();server?.close();const report={date:new Date().toISOString(),syntheticOnly:true,realDataWrites:0,results,pass:results.filter(x=>x.status==='PASS').length,fail:results.filter(x=>x.status==='FAIL').length};
  fs.writeFileSync(path.join(out,'config-preservation-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,fail:report.fail}));process.exitCode=report.fail?1:0;
});
