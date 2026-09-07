// Runs the single-file app in a fresh browser with synthetic data only.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const runtime = process.env.HEALTH_TEST_NODE_MODULES;
if (!runtime) throw new Error('Set HEALTH_TEST_NODE_MODULES to a directory containing playwright.');
const { chromium } = createRequire(path.join(runtime, '_health_test.cjs'))('playwright');
const app = path.resolve(__dirname, '..', 'index.html');
const out = path.resolve(__dirname, '..', 'test-results', process.env.HEALTH_TEST_RUN || '20260907-fix');
const html = fs.readFileSync(app);
const results = [];
let browser, server;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: process.platform==='win32'?'msedge':undefined, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
  const blocked = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin)) return route.continue();
    blocked.push(new URL(route.request().url()).origin);
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin);
  const baseline = await page.evaluate(() => JSON.parse(JSON.stringify(D)));
  async function reset() {
    await page.reload();
    await page.evaluate(base => {
      D = JSON.parse(JSON.stringify(base));
      D.foods = []; D.combos = []; D.days = {}; D.weights = []; D.pending = [];
      D.removedFoods = []; D.removedCombos = []; D.recent = []; D.aiChat = [];
      D.settings = { github: {owner:'',repo:'',path:'data.json',token:''}, ai:{base:'',key:'',model:''}, aiVision:{}, aiVoice:{} };
      curDate = todayStr(); sheetMeal = 'lunch'; sheetCat = '常用'; editCtx = null;
      save(); renderAll();
      window.testFood = (name='测试鸡肉', extra={}) => ({name,cat:'AI估算',serv:'1份100g',servG:100,c:10,p:20,f:5,uses:1,ts:100,...extra});
      window.testItem = (name='测试鸡肉', extra={}) => ({name,amt:'100g',qty:1,mode:'gram',c:10,p:20,f:5,...extra});
    }, baseline);
  }
  async function test(id, name, expected, fn) {
    await reset();
    const start = Date.now();
    try {
      const actual = await fn(page);
      assert.deepEqual(actual, expected);
      results.push({id,name,status:'PASS',expected,actual,ms:Date.now()-start});
    } catch(e) {
      results.push({id,name,status:'FAIL',expected,actual:e.actual,error:e.message.slice(0,900),ms:Date.now()-start});
    }
    console.log(`${results.at(-1).status} ${id} ${name}`);
  }
  const ev = fn => p => p.evaluate(fn);
  await test('F01','手工入库并记入午餐',[1,1,30,150],ev(() => {
    document.getElementById('foodSearch').value='测试手工餐';
    for(const [id,v] of Object.entries({mC:30,mP:20,mF:10,mG:150})) document.getElementById(id).value=v;
    addManualFood(); return [D.foods.length,getDay(curDate).meals.lunch.length,D.foods[0].c,D.foods[0].servG];
  }));
  await test('F02','按克记录150g按基准正确缩放',[15,30,7.5,'150g'],ev(() => {
    D.foods=[testFood()]; pickFood('测试鸡肉'); setQtyMode('gram'); document.getElementById('gramInput').value=150; gramChanged(); confirmAddFood();
    const it=getDay(curDate).meals.lunch[0]; return [it.c,it.p,it.f,it.amt];
  }));
  await test('F03','快捷复用沿用上次克重',[20,40,10,'200g'],ev(() => {
    D.foods=[testFood('测试鸡肉',{lastQty:2,lastMode:'gram'})]; quickAdd('测试鸡肉');
    const it=getDay(curDate).meals.lunch[0]; return [it.c,it.p,it.f,it.amt];
  }));
  await test('F04','同名手工入库应防重复',1,ev(() => {
    document.getElementById('foodSearch').value='测试重复餐'; addManualFood(); addManualFood();
    return D.foods.filter(f=>f.name==='测试重复餐').length;
  }));
  await test('F05','重新加载保留AI食物及已更新数值',[true,33],async p => {
    await p.evaluate(() => {D.foods=[testFood('测试需持久保存',{c:33})];save();});
    await p.reload(); return p.evaluate(() => {const f=D.foods.find(f=>f.name==='测试需持久保存');return [!!f,f?.c??null];});
  });
  await test('F06','库内修正用于后续快捷复用',[45,25,8],ev(() => {
    D.foods=[testFood()];aiExec({type:'update_food',name:'测试鸡肉',c:45,p:25,f:8});quickAdd('测试鸡肉');
    const it=getDay(curDate).meals.lunch[0];return [it.c,it.p,it.f];
  }));
  await test('F07','更新食物库不悄悄追改已有餐次',10,ev(() => {
    D.foods=[testFood()];quickAdd('测试鸡肉');aiExec({type:'update_food',name:'测试鸡肉',c:45,p:25,f:8});return getDay(curDate).meals.lunch[0].c;
  }));
  await test('F08','跨设备接受同名食物的新修正',55,ev(() => {
    D.foods=[testFood()];mergeData({foods:[testFood('测试鸡肉',{c:55,ts:200})]});return D.foods.find(f=>f.name==='测试鸡肉').c;
  }));
  await test('F09','远端删除后重建应替换本地旧条目',300,ev(() => {
    D.foods=[testFood()];mergeData({foods:[testFood('测试鸡肉',{ts:300})],removedFoods:[{n:'测试鸡肉',ts:200}]});return D.foods.find(f=>f.name==='测试鸡肉')?.ts??null;
  }));
  await test('F10','远端重复名称不会重复入库',1,ev(() => {
    mergeData({foods:[testFood(),testFood()]});return D.foods.filter(f=>f.name==='测试鸡肉').length;
  }));
  await test('F11','同步保留自建标志及上次用量',[true,2,'gram'],ev(() => {
    mergeData({foods:[testFood('测试自建',{user:true,lastQty:2,lastMode:'gram'})]});
    const f=D.foods.find(f=>f.name==='测试自建');return [f.user??null,f.lastQty??null,f.lastMode??null];
  }));
  await test('F12','新删除墓碑阻止旧食物复活',false,ev(() => {
    D.foods=[testFood()];mergeData({removedFoods:[{n:'测试鸡肉',ts:200}]});mergeData({foods:[testFood()]});return D.foods.some(f=>f.name==='测试鸡肉');
  }));
  await test('F13','本地重建晚于墓碑可保留',300,ev(() => {
    D.foods=[testFood('测试鸡肉',{ts:300})];mergeData({removedFoods:[{n:'测试鸡肉',ts:200}]});return D.foods.find(f=>f.name==='测试鸡肉')?.ts;
  }));
  await test('F14','已删除库条目不能拿来自动填待估算餐',[true,0,1],ev(() => {
    getDay(curDate).meals.lunch=[{name:'测试鸡肉',c:0,p:0,f:0,pending:true,pid:'p1'}];D.pending=[{id:'p1',name:'测试鸡肉',date:curDate,meal:'lunch'}];
    mergeData({foods:[testFood()],removedFoods:[{n:'测试鸡肉',ts:200}]});
    const it=getDay(curDate).meals.lunch[0];return [it.pending,it.c,D.pending.length];
  }));
  await test('F15','明确删除一餐条目不删除食物库',[0,1],ev(() => {
    D.foods=[testFood()];quickAdd('测试鸡肉');delFood('lunch',0);return [getDay(curDate).meals.lunch.length,D.foods.length];
  }));
  await test('F16','拒绝删除不存在的食物库条目',false,ev(() => aiValidate({type:'delete_food',name:'测试鸡肉'})));
  await test('C01','保存套餐再复用逐项展开',[1,4],ev(() => {
    getDay(curDate).meals.lunch=[testItem(),testItem('测试米饭')];openComboSave('lunch');document.getElementById('comboName').value='测试套餐';saveCombo();addCombo('测试套餐');
    return [D.combos.length,getDay(curDate).meals.lunch.length];
  }));
  await test('C02','套餐是保存时快照，更新库不改套餐',10,ev(() => {
    D.foods=[testFood()];D.combos=[{name:'测试套餐',items:[testItem()],ts:100}];aiExec({type:'update_food',name:'测试鸡肉',c:50,p:30,f:8});addCombo('测试套餐');return getDay(curDate).meals.lunch[0].c;
  }));
  await test('C03','套餐删除后旧远端副本不复活',false,ev(() => {
    const cb={name:'测试套餐',items:[testItem()],ts:100};D.combos=[cb];delCombo('测试套餐');mergeData({combos:[cb]});return D.combos.some(c=>c.name==='测试套餐');
  }));
  await test('C04','远端新建套餐应胜过本地旧版本',300,ev(() => {
    D.combos=[{name:'测试套餐',items:[testItem()],ts:100}];mergeData({combos:[{name:'测试套餐',items:[testItem()],ts:300}],removedCombos:[{n:'测试套餐',ts:200}]});return D.combos.find(c=>c.name==='测试套餐')?.ts??null;
  }));
  await test('C05','复制昨天使用快照且不共享对象',[2,10],ev(() => {
    const y=dateOffset(curDate,-1);getDay(y).meals.lunch=[testItem(),testItem('测试米饭')];copyYesterday('lunch');getDay(curDate).meals.lunch[0].c=99;return [getDay(curDate).meals.lunch.length,getDay(y).meals.lunch[0].c];
  }));
  await test('A01','JSON协议及代码块解析',2,ev(() => ['{"reply":"ok","actions":[]}','```json\n{"reply":"ok","actions":[]}\n```'].filter(x=>aiParse(x)?.reply==='ok').length));
  await test('A02','未知动作和负营养量被拒绝',[false,false],ev(() => [aiValidate({type:'nonsense'}),aiValidate({type:'log_food',meal:'lunch',items:[{name:'测试',c:-1,p:1,f:1}]})]));
  await test('A03','未来日期动作被拒绝',false,ev(() => aiValidate({type:'log_weight',date:'2099-01-01',kg:80})));
  await test('A04','不存在的日历日期应被拒绝',false,ev(() => aiValidate({type:'log_weight',date:'2026-02-31',kg:80})));
  await test('A05','新食物没有单份基准不应通过',false,ev(() => aiValidate({type:'log_food',meal:'lunch',items:[{name:'测试新食品',c:1,p:1,f:1,is_new:true}]})));
  await test('A06','非法单份基准应被拒绝',false,ev(() => aiValidate({type:'log_food',meal:'lunch',items:[{name:'测试新食品',c:1,p:1,f:1,is_new:true,lib:{servG:-10,c:-20,p:99999,f:0}}]})));
  await test('A07','新增食物异常巨大数值应被拒绝',false,ev(() => aiValidate({type:'add_food',name:'测试',c:100000000,p:1,f:1})));
  await test('A08','AI单份基准中的零值必须保留',[0,20,0],ev(() => {
    aiExec({type:'log_food',meal:'lunch',items:[{name:'测试零脂食品',c:5,p:40,f:2,is_new:true,lib:{serv:'100g',servG:100,c:0,p:20,f:0}}]});
    const f=D.foods[0];return [f.c,f.p,f.f];
  }));
  await test('A09','AI已有食物记录不重复入库',1,ev(() => {
    D.foods=[testFood()];aiExec({type:'log_food',meal:'lunch',items:[{name:'测试鸡肉',c:20,p:40,f:10,is_new:true,lib:{c:10,p:20,f:5,servG:100}}]});return D.foods.length;
  }));
  await test('A10','AI记录200g后直接保存编辑应保持营养量',[20,40,10],ev(() => {
    D.foods=[testFood()];aiExec({type:'log_food',meal:'lunch',items:[{name:'测试鸡肉',amt:'200g',c:20,p:40,f:10,is_new:false}]});
    editFood('lunch',0);confirmAddFood();const it=getDay(curDate).meals.lunch[0];return [it.c,it.p,it.f];
  }));
  await test('A11','AI提示词应包含库内单份数值供精确复用',true,ev(() => {
    D.foods=[testFood('测试精确基准',{c:37.2,p:19.3,f:6.7,servG:123})];const s=aiSystemPrompt();return s.includes('37.2')&&s.includes('19.3')&&s.includes('123');
  }));
  await test('A12','未确认的AI动作不落盘，确认一次只执行一次',[0,1],ev(() => {
    const a={type:'add_food',name:'测试待确认',c:10,p:20,f:5};aiPush({role:'assistant',text:'请确认',cards:[{action:a,status:'pending'}]});
    const before=D.foods.length;aiConfirm(0,0);aiConfirm(0,0);return [before,D.foods.length];
  }));
  await test('A13','取消AI动作后不可再执行',[0,'no'],ev(() => {
    aiPush({role:'assistant',text:'请确认',cards:[{action:{type:'add_food',name:'测试取消',c:10,p:20,f:5},status:'pending'}]});aiCancel(0,0);aiConfirm(0,0);return [D.foods.length,D.aiChat[0].cards[0].status];
  }));
  await test('A14','整餐替换不会变为追加',1,ev(() => {
    getDay(curDate).meals.lunch=[testItem(),testItem('测试第二项')];aiExec({type:'set_meal',meal:'lunch',items:[testItem('测试替换')]});return getDay(curDate).meals.lunch.length;
  }));
  await test('A15','清空整餐应同时清除待估算项及其队列',[0,0],ev(() => {
    getDay(curDate).meals.lunch=[testItem(),{name:'测试待估',pending:true,pid:'p1',c:0,p:0,f:0}];D.pending=[{id:'p1',name:'测试待估',date:curDate,meal:'lunch'}];
    aiExec({type:'set_meal',meal:'lunch',items:[]});return [getDay(curDate).meals.lunch.length,D.pending.length];
  }));
  await test('A16','回看历史时AI默认仍记真实今天',[0,1],ev(() => {
    curDate=dateOffset(todayStr(),-1);aiExec({type:'log_food',meal:'lunch',items:[testItem()]});return [getDay(curDate).meals.lunch.length,getDay(todayStr()).meals.lunch.length];
  }));
  await test('A17','显式日期支持历史补记',[1,0],ev(() => {
    const date=dateOffset(todayStr(),-1);aiExec({type:'log_food',date,meal:'lunch',items:[testItem()]});return [getDay(date).meals.lunch.length,getDay(todayStr()).meals.lunch.length];
  }));
  await test('A18','AI更新动作确认前后目标变化应重新校验',true,ev(() => {
    D.foods=[testFood()];const a={type:'update_food',name:'测试鸡肉',c:20,p:30,f:10};aiPush({role:'assistant',text:'请确认',cards:[{action:a,status:'pending'}]});D.foods=[];
    try{aiConfirm(0,0);return true;}catch{return false;}
  }));
  await test('A19','食物名称按文字显示，不执行HTML',false,ev(async () => {
    D.foods=[testFood('<img src=x onerror="window.__healthProbe=true">')];sheetCat='其他';renderFoodList();await new Promise(r=>setTimeout(r,100));return window.__healthProbe===true;
  }));
  await test('A20','餐次份量和补剂用量按文字显示，不执行HTML',false,ev(async()=>{
    const payload='<img src=x onerror="window.__unsafeAmount=true">';
    getDay(curDate).meals.lunch=[testItem('测试餐',{amt:payload})];
    D.suppDefs=[{id:'safe',name:'测试补剂',dose:payload,times:['早餐后']}];
    renderToday();await new Promise(r=>setTimeout(r,100));return window.__unsafeAmount===true;
  }));
  await test('N01','AI网络失败重试一次',2,ev(async () => {
    let calls=0;window.fetch=async()=>{calls++;if(calls===1)throw Error('synthetic offline');return new Response(JSON.stringify({choices:[{message:{content:'{"reply":"ok","actions":[]}'}}]}));};
    await aiCall({base:'https://model.invalid',key:'synthetic',model:'fixture'},[]);return calls;
  }));
  await test('N02','AI协议错误重试修复后生成待确认卡',[2,1,'pending',0],ev(async () => {
    let calls=0;D.settings.ai={base:'https://model.invalid',key:'synthetic',model:'fixture'};
    window.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:calls===1?'格式错误':JSON.stringify({reply:'请确认',actions:[{type:'add_food',name:'测试修复',c:1,p:1,f:1}]})}}]}));};
    aiPush({role:'user',text:'测试输入'});await aiRequest(null);const m=D.aiChat.at(-1);return [calls,m.cards.length,m.cards[0].status,D.foods.length];
  }));
  await test('N03','AI越界动作被丢弃',[0,true],ev(async () => {
    D.settings.ai={base:'https://model.invalid',key:'synthetic',model:'fixture'};window.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({reply:'test',actions:[{type:'drop_database'}]})}}]}));
    aiPush({role:'user',text:'测试输入'});await aiRequest(null);const m=D.aiChat.at(-1);return [m.cards.length,m.text.includes('1个动作未通过校验')];
  }));
  await test('N04','食物面板估算应拒绝负值',0,ev(async () => {
    D.settings.ai={base:'https://model.invalid',key:'synthetic',model:'fixture'};document.getElementById('foodSearch').value='测试坏估算';
    window.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({unit:'100g',servG:100,c:-50,p:20,f:3})}}]}));await aiEstimate();return D.foods.length;
  }));
  await test('N05','GitHub同步409重拉并重推',[2,2,'sha2'],ev(async () => {
    D.settings.github={owner:'synthetic',repo:'fixture',path:'data.json',token:'synthetic'};renderSet();let gets=0,puts=0,lastSha=null;
    window.fetch=async(url,opt={})=>{if(opt.method==='PUT'){puts++;lastSha=JSON.parse(opt.body).sha;return new Response('{}',{status:puts===1?409:200});}gets++;return new Response(JSON.stringify({sha:'sha'+gets,content:b64encode('{}')}));};
    await doSync(true);return [gets,puts,lastSha];
  }));
  await test('N06','同步JSON不得夹带模型Key或GitHub令牌',[false,false,false],ev(async () => {
    D.settings.github={owner:'synthetic',repo:'fixture',path:'data.json',token:'SYNTHETIC_GH_TOKEN'};D.settings.ai={base:'https://model.invalid',key:'SYNTHETIC_AI_KEY',model:'fixture'};D.aiChat=[{role:'user',text:'SYNTHETIC_CHAT'}];renderSet();let payload='';
    window.fetch=async(url,opt={})=>{if(opt.method==='PUT'){payload=b64decode(JSON.parse(opt.body).content);return new Response('{}');}return new Response('{}',{status:404});};
    await doSync(true);return [payload.includes('SYNTHETIC_AI_KEY'),payload.includes('SYNTHETIC_GH_TOKEN'),payload.includes('SYNTHETIC_CHAT')];
  }));
  await test('N07','同步失败仍保留本地记录',[1,true],ev(async () => {
    D.foods=[testFood()];quickAdd('测试鸡肉');D.settings.github={owner:'synthetic',repo:'fixture',path:'data.json',token:'synthetic'};renderSet();window.fetch=async()=>{throw Error('synthetic offline');};await doSync(true);
    return [JSON.parse(localStorage.getItem(LS_KEY)).days[curDate].meals.lunch.length,document.getElementById('syncState').textContent.includes('失败')];
  }));
  await test('U01','五个导航页面能切换',5,async p => {
    let count=0;for(const name of ['today','train','trend','ai','set']){await p.locator(`.nav button[data-page="${name}"]`).click();if(await p.locator(`#page-${name}`).isVisible())count++;}return count;
  });
  await test('U02','可见界面手动添加并搜索复用',[1,2],async p => {
    await p.evaluate(()=>openFoodSheet('lunch','午餐'));
    await p.locator('#foodSearch').fill('测试界面餐');
    await p.evaluate(()=>renderFoodList());
    await p.locator('[onclick="showManualFood()"]').click();
    await p.locator('#mC').fill('30');await p.locator('#mP').fill('20');await p.locator('#mF').fill('10');await p.locator('#mG').fill('200');
    await p.locator('[onclick="addManualFood()"]').click();
    await p.evaluate(()=>openFoodSheet('lunch','午餐'));await p.locator('#foodSearch').fill('测试界面餐');await p.evaluate(()=>renderFoodList());
    await p.locator('#foodList .addbtn').click();return p.evaluate(()=>[D.foods.filter(f=>f.name==='测试界面餐').length,getDay(curDate).meals.lunch.length]);
  });
  await test('U03','界面确认AI动作后才写入',[0,1],async p => {
    await p.evaluate(()=>{switchPage('ai');aiPush({role:'assistant',text:'测试待确认',cards:[{action:{type:'add_food',name:'测试按钮确认',c:10,p:20,f:5},status:'pending'}]});});
    const before=await p.evaluate(()=>D.foods.length);await p.locator('[onclick="aiConfirm(0,0)"]').click();return [before,await p.evaluate(()=>D.foods.length)];
  });
  await test('S01','力量记录包含重量次数组数并切换力量日',['train',40,10,3],ev(() => {
    wtype=D.split[0].key;renderTrain();document.getElementById('w0').value=40;document.getElementById('r0').value=10;document.getElementById('s0').value=3;document.getElementById('strMin').value=60;saveStrength();
    const d=getDay(curDate),e=d.workouts[0].entries[0];return [d.type,e.w,e.r,e.s];
  }));
  await test('S02','有氧记录切换有氧日并计入消耗',[true,true],ev(() => {
    wtype='cardio';renderTrain();document.getElementById('cardioMin').value=30;saveCardio();const d=getDay(curDate);return [d.type==='cardio',d.workouts[0].kcal>0];
  }));
  await test('S03','力量加有氧仍保留力量日并补偿碳水',[true,true],ev(() => {
    const d=getDay(curDate);d.type='train';const before=quotas(d).c;wtype='cardio';renderTrain();document.getElementById('cardioMin').value=30;saveCardio();return [d.type==='train',quotas(d).c>before];
  }));
  await test('S04','同日体重更新不重复且联动档案',[1,85],ev(() => {
    document.getElementById('weightInput').value=86;addWeight();document.getElementById('weightInput').value=85;addWeight();return [D.weights.length,D.profile.weight];
  }));
  await test('S05','补剂多时点用量保存',[2,'2粒'],ev(() => {
    openSuppMg();suppTimePicked=new Set(SUPP_TIMES.slice(0,2));document.getElementById('newSuppName').value='测试补剂';document.getElementById('newSuppDose').value='2粒';addSupp();const s=D.suppDefs.at(-1);return [s.times.length,s.dose];
  }));
  await test('S06','补剂勾选可开关',[true,false],ev(() => {
    toggleSupp('test');const before=getDay(curDate).supps.test;toggleSupp('test');return [before,getDay(curDate).supps.test];
  }));
  await test('S07','重新加载保留自定义训练方案','测试独立训练日',async p => {
    await p.evaluate(()=>{D.split=[{key:'custom',name:'测试独立训练日',ex:['测试动作']}];D.splitUpd=999;save();});await p.reload();return p.evaluate(()=>D.split[0].name);
  });
  await test('S08','已删除的原白名单食物不再被强制补回',false,ev(() => {
    const f=RESTORED_FOODS[0];D.removedFoods=[{n:f.name,ts:Date.now()}];mergeData({});return D.foods.some(x=>x.name===f.name);
  }));
  await reset();
  await page.evaluate(()=>{D.foods=[testFood()];quickAdd('测试鸡肉');openFoodSheet('lunch','午餐');document.getElementById('foodSearch').value='测试';renderFoodList();});
  await page.screenshot({path:path.join(out,'legacy-mobile-food-library.png'),fullPage:false,animations:'disabled'});
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{closeSheets();switchPage('today');});
  await page.screenshot({path:path.join(out,'legacy-desktop.png'),fullPage:true});
  const report={sourceSha256:crypto.createHash('sha256').update(html).digest('hex'),browser:await browser.version(),date:new Date().toISOString(),syntheticDataOnly:true,blockedExternalOrigins:[...new Set(blocked)],results,pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length,pageErrors:errors};
  fs.writeFileSync(path.join(out,'regression-results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({pass:report.pass,fail:report.fail,total:results.length}));
  process.exitCode=report.fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=2;}).finally(async()=>{await browser?.close();server?.close();});
