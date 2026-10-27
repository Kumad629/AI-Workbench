import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const out=join(root,'artifacts','appearance');
const question='如何把一个想法，变成真正可用的作品？';
const answer='## 从一个真实问题开始\n\n先做一个小而完整的原型，再逐步迭代。\n\n1. **明确场景**\n\n   找到一个你自己反复遇到的问题。\n\n2. **完成闭环**\n\n   让提问、筛选和保存真正连起来。\n\n3. **持续验证**\n\n   记录反馈，让每一次迭代都有依据。\n\n最终，**先验证需求，再投入开发。**';
let app,page,dir,server,requests,errors;
async function skin(name){await page.getByRole('button',{name:'切换外观',exact:true}).click();const d=page.getByRole('dialog',{name:'工作台外观'});await d.getByRole('radio',{name:new RegExp('^'+name)}).check();await d.getByRole('button',{name:'关闭弹窗'}).click();}
async function shot(name){if(await page.getByLabel('关闭提示').isVisible())await page.getByLabel('关闭提示').click();await page.screenshot({path:join(out,name+'.png')});}
async function assertFits(){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);for(const sel of ['.composer','.yuanbao-compose form']){const el=page.locator(sel);if(await el.isVisible()){const r=await el.boundingBox();const size=page.viewportSize();expect(r.x).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(size.width);expect(r.y+r.height).toBeLessThanOrEqual(size.height);}}}
test.beforeEach(async()=>{
 mkdirSync(out,{recursive:true});dir=mkdtempSync(join(tmpdir(),'awb-appearance-'));requests=[];errors=[];
 server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;requests.push(JSON.parse(body));res.writeHead(200,{'Content-Type':'text/event-stream'});for(const content of answer.match(/.{1,80}/gs)){res.write('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\n');await new Promise(r=>setTimeout(r,12));}res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir},timeout:30000});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1760,height:894});await expect(page.getByRole('heading',{name:'你的问题，更多视角。'})).toBeVisible();
});
test.afterEach(async()=>{if(app)await app.close();if(server)await new Promise(r=>server.close(r));if(dir)rmSync(dir,{recursive:true,force:true});expect(errors).toEqual([]);});

test('skins preserve live conversation, drafts, bookmarks and classic layout; controls work at both sizes',async()=>{
 test.setTimeout(150000);
 await expect(page.locator('html')).toHaveAttribute('data-appearance','minimal');await expect(page.locator('.inspector')).toHaveCount(0);await shot('minimal-welcome');
 await page.getByRole('button',{name:'连接第一个模型'}).click();const d=page.getByRole('dialog',{name:'添加模型连接'});
 await d.getByLabel('连接名称').fill('DeepSeek');await d.getByLabel('模型 ID').fill('sample');await d.getByLabel('API 基础地址').fill('http://127.0.0.1:'+server.address().port+'/v1');await d.getByLabel('API Key').fill('local-fixture-only');await d.getByRole('button',{name:'保存连接',exact:true}).click();
 await page.getByLabel('输入问题').fill(question);await page.getByRole('button',{name:'发送问题'}).click();await expect(page.getByTestId('answer-card').locator('.answer-status')).toHaveText('已完成');expect(requests).toHaveLength(1);
 const id=await page.evaluate(()=>window.workbench.call('snapshot').then(s=>s.conversations[0].id));
 await page.evaluate(async(id)=>{await window.workbench.call('updateConversation',{id,title:'从想法，到作品',folder:'作品与研究'});for(const title of ['如何讲清楚一个产品','整理这次研究的关键线索','视频脚本与展示顺序','一次有价值的追问','收藏与笔记的整理方式']){const c=await window.workbench.call('createConversation',{mode:'single',connectionIds:[]});await window.workbench.call('updateConversation',{id:c,title});}},id);
 await expect(page.locator('.breadcrumb strong')).toHaveText('从想法，到作品');await shot('minimal-chat');await assertFits();
 await page.getByLabel('输入问题').fill('这段草稿切换后还在');await shot('minimal-chat-ready');await skin('经典');await expect(page.locator('html')).toHaveAttribute('data-appearance','classic');await expect(page.locator('.inspector')).toBeVisible();await expect(page.getByLabel('输入问题')).toHaveValue('这段草稿切换后还在');await expect(page.getByTestId('answer-card')).toContainText('从一个真实问题开始');
 expect(await page.locator('.sidebar').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(244, 245, 249)');await shot('classic-chat');
 await skin('暖米');await expect(page.getByLabel('输入问题')).toHaveValue('这段草稿切换后还在');expect(await page.locator('.sidebar').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(247, 245, 236)');await shot('warm-chat');
 await skin('简约');await page.getByLabel('输入问题').fill('');
 await page.getByTestId('answer-card').getByRole('button',{name:'收藏',exact:true}).click();const save=page.getByRole('dialog',{name:'保存到精选库'});await save.getByLabel('标题').fill('从想法，到作品');await save.getByLabel('标签').fill('产品，灵感');await save.getByLabel('我的笔记').fill('先验证需求，再投入开发。');await save.getByRole('button',{name:'保存精选'}).click();
 await page.getByRole('button',{name:/^精选库/}).click();await expect(page.getByRole('heading',{name:'从想法，到作品'})).toBeVisible();await shot('minimal-library');await page.getByRole('button',{name:'回到原对话'}).click();
 await page.getByRole('button',{name:'语音输入',exact:true}).click();await expect(page.getByRole('dialog',{name:'语音输入'})).toBeVisible();await shot('minimal-voice');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();await expect(page.locator('.sidebar')).toBeHidden();await skin('经典');await expect(page.locator('.sidebar')).toBeVisible();await skin('简约');await expect(page.locator('.sidebar')).toBeHidden();await page.getByRole('button',{name:'展开侧边栏',exact:true}).click();
 await page.getByRole('button',{name:'搜索',exact:true}).click();await page.getByLabel('搜索会话').fill('视频脚本');await expect(page.locator('.conversation-item')).toHaveCount(1);await page.getByRole('button',{name:'清除搜索',exact:true}).click();
 await page.getByLabel('文件夹筛选').selectOption('作品与研究');await expect(page.locator('.conversation-item')).toHaveCount(1);await page.getByLabel('文件夹筛选').selectOption('');
 await page.setViewportSize({width:1024,height:740});await shot('minimal-compact');await assertFits();
 await page.getByRole('button',{name:'显示或隐藏会话面板'}).click();await expect(page.locator('.inspector')).toBeVisible();await assertFits();await shot('minimal-compact-panel');await page.getByRole('button',{name:'显示或隐藏会话面板'}).click();
 await page.getByRole('button',{name:/^连接与设置/}).click();await expect(page.getByRole('radiogroup',{name:'工作台外观'})).toBeVisible();await shot('minimal-settings');await skin('经典');await skin('简约');await expect(page.getByRole('radio',{name:/^简约/})).toBeChecked();
 await page.getByRole('radio',{name:/^暖米/}).check();await app.close();app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});page=await app.firstWindow();await expect(page.locator('html')).toHaveAttribute('data-appearance','warm');const snap=await page.evaluate(()=>window.workbench.call('snapshot'));expect(snap.excerpts).toHaveLength(1);expect(snap.conversations.find(c=>c.id===id).messages).toHaveLength(2);expect(snap.connections).toHaveLength(1);
});

test('web chat draft and controls survive theme switching; group controls remain reachable',async()=>{
 await page.getByRole('button',{name:'网页账号',exact:true}).click();await page.getByRole('button',{name:'进入豆包网页聊天',exact:true}).click();const input=page.getByRole('textbox',{name:'发给豆包的问题'});await input.fill('网页草稿需要保留');await skin('经典');await expect(input).toHaveValue('网页草稿需要保留');await skin('简约');await expect(input).toHaveValue('网页草稿需要保留');await expect(page.getByRole('button',{name:'发送给豆包',exact:true})).toBeDisabled();await shot('minimal-webchat');
 await page.getByRole('button',{name:'收起顶部信息'}).click();await page.setViewportSize({width:1024,height:740});await assertFits();await shot('minimal-webchat-compact');await page.getByRole('button',{name:'展开顶部信息'}).click();
 await page.getByRole('button',{name:'新建对话',exact:true}).click();await page.getByLabel('对话模式',{exact:true}).selectOption('group');await page.getByRole('button',{name:'选择参与模型',exact:true}).click();await expect(page.locator('.inspector')).toBeVisible();await expect(page.getByRole('button',{name:'添加模型连接',exact:true})).toBeVisible();await assertFits();
});


test('minimal group chat routes follow-ups and explicit quotes while keeping controls inside the window',async()=>{
 await page.getByLabel('对话模式',{exact:true}).selectOption('group');
 await page.getByRole('button',{name:'选择参与模型',exact:true}).click();
 for(const name of ['模型甲','模型乙']){
  await page.getByRole('button',{name:'添加模型连接',exact:true}).click();const d=page.getByRole('dialog',{name:'添加模型连接'});
  await d.getByLabel('连接名称').fill(name);await d.getByLabel('模型 ID').fill(name==='模型甲'?'model-a':'model-b');await d.getByLabel('API 基础地址').fill('http://127.0.0.1:'+server.address().port+'/v1');await d.getByLabel('API Key').fill('local-fixture-only');await d.getByRole('button',{name:'保存连接',exact:true}).click();
 }
 await page.getByRole('button',{name:'显示或隐藏会话面板'}).click();
 await page.getByLabel('输入问题').fill(question);await page.getByRole('button',{name:'发送问题'}).click();await expect(page.locator('.answer-status.complete')).toHaveCount(2);expect(requests).toHaveLength(2);
 await page.getByTestId('answer-card').first().getByRole('button',{name:'引用',exact:true}).click();
 await page.getByLabel('发送给',{exact:true}).selectOption({label:'@模型乙'});await page.getByLabel('输入问题').fill('这个建议可行吗？');await page.setViewportSize({width:1024,height:740});await assertFits();await shot('minimal-group');
 await page.getByRole('button',{name:'发送问题'}).click();await expect(page.locator('.answer-status.complete')).toHaveCount(3);expect(requests).toHaveLength(3);expect(requests[2].model).toBe('model-b');expect(JSON.stringify(requests[2].messages)).toContain('这个建议可行吗');
 await page.locator('.sidebar-more summary').click();await page.getByRole('button',{name:'已归档',exact:true}).click();await expect(page.locator('.breadcrumb strong')).toHaveText('已归档');
});
