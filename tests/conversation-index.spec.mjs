import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store} from '../electron/store.mjs';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
let app,page,dir;
const time='2026-10-02T00:00:00.000Z';
const msg=(id,role,content,extra={})=>({id,role,content,status:'complete',createdAt:time,...extra});
const conversation=(id,title,messages,extra={})=>({id,title,messages,mode:'single',connectionIds:[],createdAt:time,updatedAt:time,archived:false,folder:'',tags:[],...extra});
test.beforeEach(async()=>{
 dir=mkdtempSync(join(tmpdir(),'awb-index-'));
 const store=new Store(dir);
 const qa=Array.from({length:36},(_,i)=>[
  msg('u'+i,'user',i===2?'重复的问题':i===8?'重复的问题':'第 '+(i+1)+' 个问题：如何安排学习和项目？'),
  msg('a'+i,'assistant','## 建议 '+(i+1)+'\n\n'+('先从一个可以验证的小项目开始。\n\n'.repeat(7)),{replyTo:'u'+i,connectionName:'DeepSeek'}),
  msg('b'+i,'assistant','另一个模型的观点 '+(i+1),{replyTo:'u'+i,connectionName:'Gemini'})
 ]).flat();
 store.put('conversation',conversation('group','多模型索引测试',qa,{mode:'group'}));
 store.put('conversation',conversation('yuanbao','元宝索引测试',qa.filter(m=>!m.id.startsWith('b')),{webChat:{provider:'yuanbao',url:'https://yuanbao.tencent.com/chat/index-test'}}));
 const chunks=Array.from({length:3},(_,i)=>msg('t'+i,'assistant',Array.from({length:4},(_,j)=>'我：\n存档提问 '+(i*4+j+1)+'\n\nGrok：\n'+('这是一段有价值的讨论。\n\n'.repeat(8))).join('\n\n'),{replyTo:'import',isTranscript:true,connectionName:'Grok'}));
 store.put('conversation',conversation('archive','Grok 分页索引测试',[msg('import','user','保存的原文'),...chunks]));
 store.put('conversation',conversation('unknown','未标注原文',[msg('unknown-parent','user','保存的原文'),msg('unknown-text','assistant','没有角色标记的原文内容',{isTranscript:true,replyTo:'unknown-parent'})]));
 store.close();
 app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});
 page=await app.firstWindow();await page.setViewportSize({width:1440,height:1000});
 await expect(page.locator('.conversation-item')).toHaveCount(4);
});
test.afterEach(async()=>{if(app)await app.close();if(dir)rmSync(dir,{recursive:true,force:true});});
async function open(title){await page.locator('.conversation-item').filter({hasText:title}).click();}
async function atTop(id,selector){
 await expect.poll(()=>page.locator(selector).evaluate((el,id)=>{
  const target=document.getElementById(id),sticky=el.querySelector('.archive-pagination')?.offsetHeight||0;
  return Math.abs(target.getBoundingClientRect().top-el.getBoundingClientRect().top-sticky-16);
 },id)).toBeLessThan(4);
}
test('question index previews, jumps, follows scrolling and supports keyboard without changing content',async()=>{
 await expect(page.getByRole('navigation',{name:'对话索引'})).toHaveCount(0);
 await open('多模型索引测试');
 const nav=page.getByRole('navigation',{name:'对话索引'}),ticks=nav.getByRole('button');
 await expect(ticks).toHaveCount(36);
 await ticks.nth(8).click();await atTop('message-u8','.message-scroll');
 await expect(ticks.nth(8)).toHaveAttribute('aria-current','location');
 await page.mouse.move(300,70);await ticks.nth(8).hover();await expect(nav.getByRole('tooltip')).toContainText('重复的问题');
 await expect(nav.getByRole('tooltip')).toContainText('Gemini');
 await ticks.nth(8).focus();await page.keyboard.press('Home');await expect(ticks.first()).toBeFocused();
 await page.keyboard.press('Enter');await atTop('message-u0','.message-scroll');
 await ticks.first().focus();await page.keyboard.press('ArrowDown');await expect(ticks.nth(1)).toBeFocused();
 await page.keyboard.press('Escape');await expect(nav.getByRole('tooltip')).toHaveCount(0);
 await page.locator('.message-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
 await expect(ticks.last()).toHaveAttribute('aria-current','location');
 await page.setViewportSize({width:1024,height:740});
 await page.mouse.move(300,70);await ticks.last().hover();await expect(nav.getByRole('tooltip')).toBeVisible();
 const box=await nav.getByRole('tooltip').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(1024);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await open('未标注原文');await expect(nav.getByRole('button')).toHaveCount(1);await expect(nav.getByRole('button')).toHaveAccessibleName(/原文片段/);
});
test('archive index addresses internal turns across pages and leaves raw content intact',async()=>{
 await open('Grok 分页索引测试');
 const nav=page.getByRole('navigation',{name:'对话索引'}),ticks=nav.getByRole('button');
 await expect(ticks).toHaveCount(12);
 await ticks.nth(10).click();await expect(page.locator('.archive-pagination')).toContainText('第 2 / 2 页');
 await atTop('transcript-t2-4','.message-scroll');
 await expect(ticks.nth(10)).toHaveAttribute('aria-current','location');
 await page.getByRole('button',{name:'查看原始文本'}).click();
 await expect(page.locator('.transcript-raw')).toHaveCount(1);
 await ticks.nth(9).click();await atTop('transcript-t2-2','.message-scroll');
 await expect(page.locator('.transcript-raw')).toHaveCount(0);
 await ticks.nth(1).click();await expect(page.locator('.archive-pagination')).toContainText('第 1 / 2 页');await atTop('transcript-t0-2','.message-scroll');
 const snapshot=await page.evaluate(()=>window.workbench.call('snapshot'));expect(snapshot.conversations.find(c=>c.id==='archive').messages.filter(m=>m.isTranscript)).toHaveLength(3);
 await page.mouse.move(300,70);await ticks.nth(1).hover();await expect(nav.getByRole('tooltip')).toBeVisible();mkdirSync(join(root,'artifacts'),{recursive:true});await page.screenshot({path:join(root,'artifacts/conversation-index-archive.png')});
});
test('Yuanbao uses the same index with a fixed composer and accurate reading position',async()=>{
 await open('元宝索引测试');
 const nav=page.getByRole('navigation',{name:'对话索引'}),ticks=nav.getByRole('button');
 await expect(ticks).toHaveCount(36);
 await ticks.nth(2).click();await atTop('message-u2','.yuanbao-messages');
 await expect(ticks.nth(2)).toHaveAttribute('aria-current','location');
 await expect(page.getByLabel('发给元宝的问题')).toBeVisible();
 await page.mouse.move(300,70);await ticks.nth(2).hover();await expect(nav.getByRole('tooltip')).toContainText('重复的问题');
 mkdirSync(join(root,'artifacts'),{recursive:true});await page.screenshot({path:join(root,'artifacts/conversation-index-yuanbao.png')});
 await ticks.first().focus();await page.keyboard.press('End');await page.keyboard.press('Enter');
 await expect(ticks.last()).toHaveAttribute('aria-current','location');
 await expect(page.getByLabel('发给元宝的问题')).toBeVisible();
});

test('web chat folds enlarge reading area, keep drafts and index, and persist across restart',async()=>{
 await page.setViewportSize({width:1440,height:900});await open('元宝索引测试');
 const pair=JSON.parse((await page.evaluate(()=>window.workbench.call('browserBridgeInfo'))).pairing);
 const r=await fetch(pair.url+'/web-chat/bind',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pair.token},body:JSON.stringify({clientId:'12345678-1234-1234-1234-123456789abc',url:'https://yuanbao.tencent.com/chat/index-test',ready:true})});expect(r.ok).toBe(true);const binding=await r.json();
 await expect(page.locator('.web-chat-badge')).toHaveText('已连接');
 const editor=page.getByLabel('发给元宝的问题'),viewport=page.locator('.yuanbao-chat>.conversation-viewport');
 await editor.fill('折叠后保留我的草稿');
 const full=(await viewport.boundingBox()).height;
 mkdirSync(join(root,'artifacts'),{recursive:true});
 await page.screenshot({path:join(root,'artifacts/web-chat-expanded.png')});
 await page.getByRole('button',{name:'收起顶部信息',exact:true}).click();
 await expect(page.getByRole('button',{name:'自动加载并同步历史',exact:true})).toBeHidden();
 const folded=(await viewport.boundingBox()).height;expect(folded-full).toBeGreaterThan(70);
 await page.getByRole('button',{name:'收起输入区',exact:true}).click();
 await expect(editor).toBeHidden();expect((await viewport.boundingBox()).height-folded).toBeGreaterThan(80);
 await page.getByRole('navigation',{name:'对话索引'}).getByRole('button').nth(2).click();await atTop('message-u2','.yuanbao-messages');
 await page.screenshot({path:join(root,'artifacts/web-chat-reading.png')});
 await page.getByRole('button',{name:'展开输入区',exact:true}).click();await expect(editor).toHaveValue('折叠后保留我的草稿');
 await page.getByRole('button',{name:'收起输入区',exact:true}).click();
 await page.evaluate(bindingId=>window.workbench.call('webChatSend',{bindingId,text:'折叠状态的停止测试'}),binding.bindingId);
 await page.getByRole('button',{name:'停止接收',exact:true}).click();
 await expect(page.getByRole('button',{name:'停止接收',exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.workbench.call('webChatDisconnect'));
 await expect(page.locator('.web-chat-notice')).toContainText('连接');
 await page.setViewportSize({width:980,height:700});
 const box=await viewport.boundingBox();expect(box.height).toBeGreaterThan(450);
 expect(await page.locator('.yuanbao-chat').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:join(root,'artifacts/web-chat-reading-small.png')});
 await app.close();app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});page=await app.firstWindow();await open('元宝索引测试');
 await expect(page.getByRole('button',{name:'展开顶部信息',exact:true})).toHaveAttribute('aria-expanded','false');
 await expect(page.getByRole('button',{name:'展开输入区',exact:true})).toHaveAttribute('aria-expanded','false');
 await page.getByRole('button',{name:'展开顶部信息',exact:true}).click();
 await expect(page.getByRole('button',{name:'打开元宝网页',exact:true})).toBeVisible();
});
