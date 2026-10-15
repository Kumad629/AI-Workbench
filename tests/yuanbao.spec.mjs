import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {yuanbaoCommand} from '../browser-extension/yuanbao-adapter.js';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
let app,page,desktop,dir;
test.beforeEach(async()=>{
 dir=mkdtempSync(join(tmpdir(),'awb-yuanbao-'));
 app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});
 desktop=await app.firstWindow();await desktop.waitForFunction(()=>!!window.workbench);
 const created=app.waitForEvent('window');
 await app.evaluate(async({BrowserWindow})=>{await new BrowserWindow({width:1000,height:800,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadURL('about:blank');});
 page=await created;await page.route('https://yuanbao.tencent.com/**',r=>r.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
 await page.goto('https://yuanbao.tencent.com/chat/test');
});
test.afterEach(async()=>{if(app)await app.close();if(dir)rmSync(dir,{recursive:true,force:true});});
async function fixture(){
 await page.setContent('<main><div id="rows"><div data-conv-idx="0" data-conv-speaker="human"><div class="agent-chat__bubble__content">旧问题</div></div><div data-conv-idx="1" data-conv-speaker="ai" data-conv-outputting="false"><div class="hyc-content-md hyc-content-md-done">旧答案不应该被接回</div></div></div><div class="chat-input-editor"><div class="ql-editor" contenteditable="true" style="min-height:60px"></div></div><a id="yuanbao-send-btn" class="send-btn--disabled">发送</a></main>');
 await page.evaluate(()=>{
  window.sends=0;const editor=document.querySelector('.ql-editor'),button=document.querySelector('a');
  editor.addEventListener('input',()=>button.className=editor.innerText.trim()?'':'send-btn--disabled');
  button.onclick=()=>{window.sends++;window.lastPrompt=editor.innerText;editor.innerHTML='';button.className='stop-btn';};
 });
}
const job={id:'job-one',text:'本次问题',url:'https://yuanbao.tencent.com/chat/test'};
async function answer(html='<p>新回答</p>',done=false){
 await page.evaluate(({html,done})=>{
  document.getElementById('rows').insertAdjacentHTML('beforeend','<div data-conv-idx="2" data-conv-speaker="human"><div class="agent-chat__bubble__content"></div></div><div data-conv-idx="3" data-conv-speaker="ai" data-conv-outputting="'+!done+'"><div class="hyc-content-md '+(done?'hyc-content-md-done':'')+'">'+html+'</div></div>');
  document.querySelector('[data-conv-idx="2"] .agent-chat__bubble__content').textContent=window.lastPrompt;
  if(done)document.getElementById('yuanbao-send-btn').className='send-btn--disabled';
 },{html,done});
}
test('DOM sends once, ignores old answers, streams tables and completes only after explicit end',async()=>{
 await fixture();expect((await page.evaluate(yuanbaoCommand,{command:'probe'})).ready).toBe(true);
 expect((await page.evaluate(yuanbaoCommand,{command:'begin',job})).phase).toBe('waiting');
 await page.evaluate(yuanbaoCommand,{command:'begin',job});expect(await page.evaluate(()=>window.sends)).toBe(1);
 expect((await page.evaluate(yuanbaoCommand,{command:'tick',jobId:job.id})).content).toBe('');
 await answer('<h2>新的回答</h2><table><tr><th>阶段</th><th>时长</th></tr><tr><td>验证</td><td>一周</td></tr></table><button>复制</button>');
 const partial=await page.evaluate(yuanbaoCommand,{command:'tick',jobId:job.id});
 expect(partial.phase).toBe('streaming');expect(partial.content).toContain('| 阶段 | 时长 |');expect(partial.content).not.toContain('旧答案');expect(partial.content).not.toContain('复制');
 await page.waitForTimeout(2200);expect((await page.evaluate(yuanbaoCommand,{command:'tick',jobId:job.id})).phase).toBe('streaming');
 await page.evaluate(()=>{document.querySelector('[data-conv-idx="3"]').dataset.convOutputting='false';document.querySelector('[data-conv-idx="3"] .hyc-content-md').classList.add('hyc-content-md-done');document.getElementById('yuanbao-send-btn').className='send-btn--disabled';});
 expect((await page.evaluate(yuanbaoCommand,{command:'tick',jobId:job.id})).phase).toBe('complete');
});
test('drafts, changed pages and login dialogs are not sent; losing page state cannot resend',async()=>{
 await fixture();await page.locator('.ql-editor').fill('我的草稿');
 expect((await page.evaluate(yuanbaoCommand,{command:'begin',job})).error).toContain('草稿');
 expect(await page.locator('.ql-editor').innerText()).toBe('我的草稿');expect(await page.evaluate(()=>window.sends)).toBe(0);
 await page.locator('.ql-editor').fill('');
 await page.evaluate(()=>document.querySelector('main').insertAdjacentHTML('beforeend','<div class="style__text-area__attachment___fixture">待发送文件.pdf</div>'));
 expect((await page.evaluate(yuanbaoCommand,{command:'probe'})).reason).toContain('附件');
 await page.locator('[class*="text-area__attachment"]').evaluate(e=>e.remove());
 expect((await page.evaluate(yuanbaoCommand,{command:'begin',job:{...job,url:'https://yuanbao.tencent.com/chat/other'}})).error).toContain('切换');
 await page.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<div role="dialog">登录</div>'));
 expect((await page.evaluate(yuanbaoCommand,{command:'probe'})).ready).toBe(false);
 await page.locator('[role=dialog]').evaluate(e=>e.remove());
 await page.evaluate(yuanbaoCommand,{command:'begin',job});
 await page.evaluate(()=>delete window.__awbYuanbaoChatV1);
 expect((await page.evaluate(yuanbaoCommand,{command:'tick',jobId:job.id,url:job.url})).error).toContain('刷新');
 expect(await page.evaluate(()=>window.sends)).toBe(1);
});
test('own new-chat URL is adopted once; navigating away and multi-answer mode stop receiving',async()=>{
 await fixture();await page.locator('#rows').evaluate(e=>e.innerHTML='');await page.evaluate(yuanbaoCommand,{command:'begin',job});await answer();
 await page.evaluate(()=>history.pushState({},'', '/chat/new'));
 expect((await page.evaluate(yuanbaoCommand,{command:'tick',jobId:job.id})).url).toBe('https://yuanbao.tencent.com/chat/new');
 await page.evaluate(()=>history.pushState({},'', '/chat/unrelated'));
 expect((await page.evaluate(yuanbaoCommand,{command:'tick',jobId:job.id})).error).toContain('切换');
 await page.goto(job.url);await fixture();await page.evaluate(yuanbaoCommand,{command:'begin',job});await answer();
 await page.evaluate(()=>document.querySelector('[data-conv-idx="3"]').dataset.convMultiAnswer='true');
 expect((await page.evaluate(yuanbaoCommand,{command:'tick',jobId:job.id})).error).toContain('多答案');
});
test('desktop to authenticated bridge to webpage and back saves a usable conversation without API',async()=>{
 await fixture();
 const info=await desktop.evaluate(()=>window.workbench.call('browserBridgeInfo')),pair=JSON.parse(info.pairing);
 const clientId=crypto.randomUUID();
 const request=async(path,data)=>{const response=await fetch(pair.url+'/web-chat/'+path,{method:'POST',headers:{Connection:'close','Content-Type':'application/json',Authorization:'Bearer '+pair.token},body:JSON.stringify(data)});const result=await response.json();expect(response.ok,JSON.stringify(result)).toBe(true);return result;};
 const probe=await page.evaluate(yuanbaoCommand,{command:'probe'}),binding=await request('bind',{clientId,...probe}),auth={clientId,...binding};
 await desktop.getByRole('button',{name:'网页账号',exact:true}).click();await desktop.getByRole('button',{name:'进入元宝网页聊天'}).click();
 await expect(desktop.getByText('浏览器已连接',{exact:true})).toBeVisible();
 await desktop.getByLabel('发给元宝的问题').fill('本次问题');
 await desktop.getByRole('button',{name:'发送给元宝'}).click();
 const {job:task}=await request('poll',{...auth,...probe});expect(task.text).toBe('本次问题');
 await page.evaluate(yuanbaoCommand,{command:'begin',job:task});
 await answer('<h2>项目起步</h2><table><tr><th>事项</th><th>状态</th></tr><tr><td>原型</td><td>完成</td></tr></table>',true);
 await page.evaluate(yuanbaoCommand,{command:'tick',jobId:task.id});await page.waitForTimeout(2100);
 const event=await page.evaluate(yuanbaoCommand,{command:'tick',jobId:task.id});
 await request('report',{...auth,...event,jobId:task.id,lease:task.lease,sequence:1});
 await expect(desktop.locator('.yuanbao-messages table')).toBeVisible();
 await desktop.locator('.yuanbao-message.assistant').getByRole('button',{name:'收藏',exact:true}).click();
 const dialog=desktop.getByRole('dialog',{name:'保存到精选库'});await dialog.getByLabel('标题').fill('元宝项目');await dialog.getByRole('button',{name:'保存精选'}).click();
 await expect(dialog).not.toBeVisible();
 await expect(desktop.getByRole('button',{name:'发送给元宝'})).toBeVisible();
 if(await desktop.getByLabel('关闭提示').isVisible())await desktop.getByLabel('关闭提示').click();
 await desktop.waitForTimeout(150);
 await desktop.locator('.yuanbao-message.user').scrollIntoViewIfNeeded();
 const userBox=await desktop.locator('.yuanbao-message.user').boundingBox(),answerBox=await desktop.locator('.yuanbao-message.assistant').boundingBox();
 expect(userBox.x).toBeGreaterThan(answerBox.x);
 await desktop.screenshot({path:join(root,'artifacts/yuanbao-chat.png')});
 const data=await desktop.evaluate(()=>window.workbench.call('snapshot'));expect(data.connections).toHaveLength(0);expect(data.excerpts).toHaveLength(1);expect(data.conversations[0].messages.at(-1).status).toBe('complete');
 await app.close();app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});desktop=await app.firstWindow();
 await desktop.locator('.conversation-item').first().click();
 await expect(desktop.locator('.yuanbao-messages table')).toBeVisible();await expect(desktop.getByText('等待浏览器连接',{exact:true})).toBeVisible();
 expect((await desktop.evaluate(()=>window.workbench.call('snapshot'))).excerpts).toHaveLength(1);
});

test('persistent extension relay executes jobs and continues after report acknowledgement is lost without resending',async()=>{
 await fixture();
 const info=await desktop.evaluate(()=>window.workbench.call('browserBridgeInfo')),pair=JSON.parse(info.pairing);
 const created=app.waitForEvent('window');
 await app.evaluate(async({BrowserWindow})=>{await new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadURL('about:blank');});
 const relay=await created;
 await relay.exposeFunction('executeForTest',async args=>[{result:await page.evaluate(yuanbaoCommand,args)}]);
 await relay.addInitScript(pair=>{
  window.chrome={storage:{local:{get:async()=>({pairing:pair})}},scripting:{executeScript:async({args})=>window.executeForTest(args[0])}};
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedDiagnostics=text;}}});
 },pair);
 await relay.route('https://relay.fixture/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice(1)||'yuanbao.html';
  if(!['yuanbao.html','yuanbao-relay.js','yuanbao-adapter.js','web-relay.js','web-relay-panel.js','image-upload.js','pairing.js','popup.css'].includes(name))return route.abort();
  await route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:readFileSync(join(root,'browser-extension',name))});
 });
 let lost=false;
 await relay.route(pair.url+'/**',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
  const response=await fetch(route.request().url(),{method:'POST',headers:{Connection:'close','Content-Type':'application/json',Authorization:'Bearer '+pair.token,Origin:'chrome-extension://'+'a'.repeat(32)},body:route.request().postData()});
  const body=await response.text();
  if(route.request().url().endsWith('/report')&&!lost){lost=true;return route.abort();}
  await route.fulfill({status:response.status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body});
 });
 await relay.goto('https://relay.fixture/yuanbao.html?tabId=1');
 await expect.poll(async()=>(await desktop.evaluate(()=>window.workbench.call('webChatStatus'))).history?.phase).toBe('complete');
 const historyData=await desktop.evaluate(()=>window.workbench.call('snapshot'));
 expect(historyData.conversations[0].messages.map(m=>m.content)).toEqual(['旧问题','旧答案不应该被接回']);
 await desktop.getByRole('button',{name:'网页账号',exact:true}).click();await desktop.getByRole('button',{name:'进入元宝网页聊天'}).click();
 await expect(desktop.locator('.yuanbao-message.user')).toContainText('旧问题');
 await desktop.getByRole('button',{name:'仅同步已加载',exact:true}).click();
 await expect.poll(async()=>(await desktop.evaluate(()=>window.workbench.call('webChatStatus'))).history?.phase).toBe('complete');
 expect((await desktop.evaluate(()=>window.workbench.call('snapshot'))).conversations[0].messages).toHaveLength(2);
 await expect(desktop.locator('.yuanbao-history-status')).toContainText('新增 0 条');
 await page.evaluate(()=>document.querySelector('.hyc-content-md').textContent='网页重新加载后的另一版本');
 await desktop.getByRole('button',{name:'仅同步已加载',exact:true}).click();
 await expect(relay.locator('#status')).toContainText('历史同步失败');
 await expect(desktop.getByRole('button',{name:'将网页历史另存为新会话'})).toBeVisible();
 await relay.waitForTimeout(1500);
 await expect(relay.locator('#status')).toContainText('历史同步失败');
 const historyError=JSON.parse(await relay.locator('#diagnostics').textContent());
 expect(historyError.connection.history.code).toBe('HISTORY_ALIGNMENT');
 expect(historyError.connection.history.diagnostics.matchingQuestions).toBe(1);
 expect(historyError.connection.failedStage).toBe('desktop:history');
 await page.evaluate(()=>document.querySelector('.hyc-content-md').textContent='旧答案不应该被接回');
 await desktop.getByRole('button',{name:'仅同步已加载',exact:true}).click();
 await expect.poll(async()=>(await desktop.evaluate(()=>window.workbench.call('webChatStatus'))).history?.phase).toBe('complete');
 await expect(desktop.getByRole('button',{name:'将网页历史另存为新会话'})).toHaveCount(0);
 expect(JSON.parse(await relay.locator('#diagnostics').textContent()).connection.lastError).toBe('');
 await desktop.getByRole('button',{name:'自动加载并同步历史'}).click();
 await expect(desktop.getByRole('button',{name:'停止同步'})).toBeVisible();
 await expect.poll(async()=>(await desktop.evaluate(()=>window.workbench.call('webChatStatus'))).history?.phase,{timeout:45000}).toBe('complete');
 await expect(desktop.locator('.yuanbao-history-status')).toContainText('已自动滚动检查');
 expect((await desktop.evaluate(()=>window.workbench.call('snapshot'))).conversations[0].messages).toHaveLength(2);
 await desktop.getByRole('button',{name:'查看历史开头'}).click();
 await desktop.screenshot({path:join(root,'artifacts/yuanbao-history.png')});
 const status=await desktop.evaluate(()=>window.workbench.call('webChatStatus'));
 await desktop.evaluate(bindingId=>window.workbench.call('webChatSend',{text:'本次问题',bindingId}),status.bindingId);
 await expect.poll(()=>page.evaluate(()=>window.sends)).toBe(1);await answer('<p>经过连接页接回的回答</p>',true);
 await expect.poll(async()=>(await desktop.evaluate(()=>window.workbench.call('snapshot'))).conversations[0].messages.at(-1).status,{timeout:15000}).toBe('complete');
 expect(lost).toBe(true);expect(await page.evaluate(()=>window.sends)).toBe(1);
 expect((await desktop.evaluate(()=>window.workbench.call('snapshot'))).conversations[0].messages.at(-1).content).toBe('经过连接页接回的回答');
 const replacement=await fetch(pair.url+'/web-chat/bind',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pair.token},body:JSON.stringify({clientId:'12345678-1234-1234-1234-123456789abc',url:'https://yuanbao.tencent.com/chat/test',ready:true})});expect(replacement.status).toBe(200);
 await expect(relay.locator('#status')).toContainText('另一个元宝连接页已接管');
 const diagnostics=JSON.parse(await relay.locator('#diagnostics').textContent());
 expect(diagnostics.ready).toBe(true);expect(diagnostics.connection.httpStatus).toBe(400);
 expect(diagnostics.connection.failedStage).toBe('desktop:poll');expect(diagnostics.connection.bindingEstablished).toBe(false);
 expect(JSON.stringify(diagnostics)).not.toContain(pair.token);expect(JSON.stringify(diagnostics)).not.toContain('经过连接页接回的回答');
 const failureText=await relay.locator('#status').textContent();
 await relay.locator('#copy-diagnostics').click();await expect(relay.locator('#copy-feedback')).toContainText('已复制');
 await expect(relay.locator('#status')).toHaveText(failureText);
 expect(JSON.parse(await relay.evaluate(()=>window.copiedDiagnostics)).connection.lastError).toContain('接管');
 await relay.locator('#connect').click();
 await expect.poll(async()=>(await desktop.evaluate(()=>window.workbench.call('webChatStatus'))).history?.phase).toBe('complete');
 await desktop.evaluate(()=>window.workbench.call('webChatDisconnect'));
 await expect(relay.locator('#status')).toContainText('工作台重启或连接断开');
 await relay.locator('#connect').click();
 await expect.poll(async()=>(await desktop.evaluate(()=>window.workbench.call('webChatStatus'))).history?.phase).toBe('complete');
 expect(await page.evaluate(()=>window.sends)).toBe(1);
 await relay.close();
 await app.close();app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});desktop=await app.firstWindow();
 await desktop.locator('.conversation-item').first().click();
 await expect(desktop.locator('.yuanbao-message')).toHaveCount(4);
 await expect(desktop.locator('.yuanbao-message.user').first()).toContainText('旧问题');
 await expect(desktop.getByText('网页历史 · 原时间未提供',{exact:true})).toHaveCount(2);
});

test('new Yuanbao IM composer is recognized and sends once without including draft text in diagnostics',async()=>{
 await fixture();
 await page.evaluate(()=>{
  const e=document.querySelector('.ql-editor');e.className='yb-im-input-editor';
  e.parentElement.className='chat-command-editor-specail';
  e.parentElement.setAttribute('data-input-main-content','true');
  const b=document.getElementById('yuanbao-send-btn');
  b.className='SendButton_sendNot__sUMPk SendButton_disabled__v1PnQ';
  e.addEventListener('input',()=>b.className=e.innerText.trim()?'SendButton_sendButton__g3Lcb':'SendButton_sendNot__sUMPk');
 });
 const probe=await page.evaluate(yuanbaoCommand,{command:'probe'});
 expect(probe.ready).toBe(true);expect(probe.diagnostics.version).toBe('0.8.1');expect(probe.diagnostics.ready).toBe(true);
 expect(probe.diagnostics.editorCandidates).toBe(1);expect(probe.diagnostics.imEditors).toBe(1);
 const response=await page.evaluate(yuanbaoCommand,{command:'begin',job});
 expect(response.phase).toBe('waiting');expect(await page.evaluate(()=>window.sends)).toBe(1);
 await page.evaluate(yuanbaoCommand,{command:'begin',job});expect(await page.evaluate(()=>window.sends)).toBe(1);
 await page.evaluate(()=>document.getElementById('yuanbao-send-btn').className='SendButton_sendStop__Qj6Ko');
 expect((await page.evaluate(yuanbaoCommand,{command:'probe'})).reason).toContain('正在生成');
 await page.evaluate(()=>{
  document.getElementById('yuanbao-send-btn').className='';
  document.querySelector('.yb-im-input-editor').innerText='private-draft-123';
 });
 const draftProbe=await page.evaluate(yuanbaoCommand,{command:'probe'});
 expect(draftProbe.reason).toContain('草稿');expect(draftProbe.diagnostics.ready).toBe(false);expect(draftProbe.diagnostics.reason).toBe(draftProbe.reason);expect(JSON.stringify(draftProbe.diagnostics)).not.toContain('private-draft-123');
});
test('known composer region supports nested plaintext editor but rejects ambiguous fields and unrelated search inputs',async()=>{
 await fixture();
 await page.evaluate(()=>{
  const e=document.querySelector('.ql-editor');e.className='new-editor';e.setAttribute('contenteditable','plaintext-only');
  e.parentElement.className='new-wrapper';e.parentElement.setAttribute('data-input-main-content','true');
 });
 expect((await page.evaluate(yuanbaoCommand,{command:'probe'})).ready).toBe(true);
 await page.evaluate(()=>document.querySelector('[data-input-main-content]').insertAdjacentHTML('beforeend','<textarea>second private draft</textarea>'));
 const ambiguous=await page.evaluate(yuanbaoCommand,{command:'probe'});
 expect(ambiguous.ready).toBe(false);expect(ambiguous.reason).toContain('多个');
 expect((await page.evaluate(yuanbaoCommand,{command:'begin',job})).phase).toBe('failed');
 expect(await page.evaluate(()=>window.sends)).toBe(0);
 await page.evaluate(()=>{document.querySelector('textarea').remove();document.querySelector('[data-input-main-content]').removeAttribute('data-input-main-content');});
 const unrelated=await page.evaluate(yuanbaoCommand,{command:'probe'});
 expect(unrelated.diagnostics.editor).toBe(false);expect(unrelated.diagnostics.editableFields).toBe(1);
 expect(unrelated.reason).toContain('未识别');expect(unrelated.diagnostics.sendButtonVisible).toBe(true);
});
test('missing send button and modern disabled button produce distinct failures with no submission',async()=>{
 await fixture();
 await page.evaluate(()=>document.getElementById('yuanbao-send-btn').hidden=true);
 const hidden=await page.evaluate(yuanbaoCommand,{command:'probe'});
 expect(hidden.diagnostics.editor).toBe(true);expect(hidden.reason).toContain('发送按钮');expect(hidden.diagnostics.sendButtonVisible).toBe(false);
 await page.evaluate(()=>{
  const b=document.getElementById('yuanbao-send-btn');b.hidden=false;
  document.querySelector('.ql-editor').addEventListener('input',()=>b.className='SendButton_disabled__v1PnQ');
 });
 expect((await page.evaluate(yuanbaoCommand,{command:'begin',job})).error).toContain('未就绪');
 expect(await page.evaluate(()=>window.sends)).toBe(0);
 expect(await page.locator('.ql-editor').innerText()).toBe(job.text);
});

test('history reads old roles and tables without sending, rejects navigation and generating answers',async()=>{
 await fixture();
 await page.locator('[data-conv-idx="1"] .hyc-content-md').evaluate(e=>e.innerHTML='<h2>以前的计划</h2><table><tr><th>步骤</th><th>说明</th></tr><tr><td>一</td><td>先验证</td></tr></table>');
 const capture=await page.evaluate(yuanbaoCommand,{command:'history',url:job.url});
 expect(capture.messages.map(m=>m.role)).toEqual(['user','assistant']);
 expect(capture.messages[0].content).toBe('旧问题');expect(capture.messages[1].content).toContain('| 步骤 | 说明 |');
 expect(await page.evaluate(()=>window.sends)).toBe(0);
 expect((await page.evaluate(yuanbaoCommand,{command:'history',url:'https://yuanbao.tencent.com/chat/other'})).error).toContain('切换');
 await page.locator('[data-conv-idx="1"]').evaluate(e=>e.dataset.convOutputting='true');
 expect((await page.evaluate(yuanbaoCommand,{command:'history',url:job.url})).error).toContain('正在生成');
});

test('history conflict offers a separate webpage copy and preserves the original conversation',async()=>{
 await fixture();
 const pair=JSON.parse((await desktop.evaluate(()=>window.workbench.call('browserBridgeInfo'))).pairing);
 const request=async(action,data)=>{
  const response=await fetch(pair.url+'/web-chat/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pair.token},body:JSON.stringify(data)});
  expect(response.ok).toBe(true);return response.json();
 };
 const clientId='abcdef12-1234-1234-1234-123456789abc',url='https://yuanbao.tencent.com/chat/test';
 const first=await request('bind',{clientId,url,ready:true});
 const sent=await desktop.evaluate(bindingId=>window.workbench.call('webChatSend',{bindingId,text:'旧问题'}),first.bindingId);
 const {job}=await request('poll',{clientId,...first,url,ready:true});
 await request('report',{clientId,...first,url,jobId:job.id,lease:job.lease,sequence:1,phase:'complete',content:'与网页不一致的本地回答'});
 const original=(await desktop.evaluate(()=>window.workbench.call('snapshot'))).conversations[0];
 await desktop.evaluate(c=>window.workbench.call('saveExcerpt',{conversationId:c.id,messageId:c.messages[1].id,content:c.messages[1].content,title:'保留收藏'}),original);
 const bound=await request('bind',{clientId,url,ready:true,historyEnabled:true}),auth={clientId,...bound};
 let {historyRequest}=await request('poll',{...auth,url,ready:true});
 const capture=await page.evaluate(yuanbaoCommand,{command:'history',url});
 const result=await request('history',{...auth,...capture,requestId:historyRequest.id});expect(result.code).toBe('HISTORY_ALIGNMENT');
 await desktop.locator('.conversation-item').filter({hasText:'旧问题'}).click();
 await expect(desktop.getByRole('button',{name:'将网页历史另存为新会话'})).toBeVisible();
 await desktop.getByRole('button',{name:'将网页历史另存为新会话'}).click();
 ({historyRequest}=await request('poll',{...auth,url,ready:true}));
 expect(historyRequest).toBeTruthy();
 const copied=await request('history',{...auth,...capture,requestId:historyRequest.id});expect(copied.accepted).toBe(true);
 await expect(desktop.getByRole('heading',{name:'旧问题 · 网页副本',exact:true})).toBeVisible();
 await expect(desktop.locator('.yuanbao-message.assistant')).toContainText('旧答案不应该被接回');
 const snapshot=await desktop.evaluate(()=>window.workbench.call('snapshot'));
 expect(snapshot.conversations).toHaveLength(2);expect(snapshot.conversations.find(c=>c.id===sent.conversationId)).toEqual(original);
 expect(snapshot.excerpts[0].conversationId).toBe(original.id);
});

async function runScan(requestId='scan-fixture'){
 let result=await page.evaluate(yuanbaoCommand,{command:'history-scan-start',requestId,url:'https://yuanbao.tencent.com/chat/test'});
 for(let i=0;i<100&&result.phase==='running';i++){
  await page.waitForTimeout(25);await page.evaluate(()=>window.scanClock+=1000);
  result=await page.evaluate(yuanbaoCommand,{command:'history-scan-tick',requestId});
 }
 return result;
}
async function scanClock(){await page.evaluate(()=>{window.scanClock=Date.now();Date.now=()=>window.scanClock;});}

test('automatic history scanner loads delayed older rows, checks both boundaries and restores position',async()=>{
 await fixture();await scanClock();
 await page.evaluate(()=>{
  const rows=document.getElementById('rows');rows.style.cssText='height:150px;overflow-y:auto;scroll-behavior:auto';
  for(const row of rows.children)row.style.minHeight='180px';
  rows.scrollTop=rows.scrollHeight;rows.style.scrollBehavior='smooth';
  window.loadedEarlier=false;
  rows.addEventListener('scroll',()=>{
   if(rows.scrollTop<2&&!window.loadedEarlier){window.loadedEarlier=true;setTimeout(()=>{
    const older=document.createElement('div');older.innerHTML='<div data-conv-idx="-2" data-conv-speaker="human" style="min-height:180px"><div class="agent-chat__bubble__content">更早问题</div></div><div data-conv-idx="-1" data-conv-speaker="ai" style="min-height:180px"><div class="hyc-content-md">更早回答</div></div>';
    rows.prepend(...older.children);
   },15);}
  });
 });
 const result=await runScan();
 expect(result.phase).toBe('complete');expect(result.scan.reason).toBe('boundaries-checked');expect(result.scan.complete).toBe(false);
 expect(result.messages.map(m=>m.content)).toEqual(['更早问题','更早回答','旧问题','旧答案不应该被接回']);
 expect(result.scan.topChecked).toBe(true);
 expect(await page.evaluate(()=>{const s=document.getElementById('rows');return s.scrollHeight-s.clientHeight-s.scrollTop;})).toBeLessThan(3);
 expect(await page.evaluate(()=>document.getElementById('rows').style.scrollBehavior)).toBe('smooth');
 expect(await page.evaluate(()=>window.sends)).toBe(0);
});

test('automatic scanner joins virtual windows by overlap and preserves repeated questions',async()=>{
 await fixture();await scanClock();
 await page.evaluate(()=>{
  const original=document.getElementById('rows');original.remove();
  const scroller=document.createElement('div');scroller.id='virtual';scroller.style.cssText='height:300px;overflow-y:auto;position:relative';
  scroller.innerHTML='<div style="height:2000px;position:relative" id="spacer"></div>';
  document.querySelector('main').prepend(scroller);
  const draw=()=>{const first=Math.min(14,Math.floor(scroller.scrollTop/100));document.getElementById('spacer').innerHTML=Array.from({length:6},(_,i)=>{const n=first+i;return '<div data-conv-idx="'+i+'" data-conv-speaker="'+(n%2?'ai':'human')+'" style="position:absolute;top:'+n*100+'px;height:100px"><div class="'+(n%2?'hyc-content-md':'agent-chat__bubble__content')+'">'+(n%2?'回答 '+n:'继续')+'</div></div>';}).join('');};
  scroller.addEventListener('scroll',draw);scroller.scrollTop=1700;draw();
 });
 const result=await runScan();
 expect(result.phase).toBe('complete');expect(result.messages).toHaveLength(20);
 expect(result.messages.filter(m=>m.role==='user').map(m=>m.content)).toEqual(Array(10).fill('继续'));
 expect(result.messages.filter(m=>m.role==='assistant').map(m=>m.content)).toEqual(Array.from({length:10},(_,i)=>'回答 '+(i*2+1)));
});

test('scanner cancel, navigation and duration limits never send questions',async()=>{
 await fixture();await scanClock();
 const start=()=>page.evaluate(yuanbaoCommand,{command:'history-scan-start',requestId:'cancel-fixture',url:'https://yuanbao.tencent.com/chat/test'});
 await start();
 const cancelled=await page.evaluate(yuanbaoCommand,{command:'history-scan-cancel',requestId:'cancel-fixture'});
 expect(cancelled.phase).toBe('cancelled');expect(cancelled.messages).toBeUndefined();
 await page.evaluate(yuanbaoCommand,{command:'history-scan-start',requestId:'time-fixture',url:'https://yuanbao.tencent.com/chat/test'});
 await page.evaluate(()=>window.scanClock+=900001);
 const timed=await page.evaluate(yuanbaoCommand,{command:'history-scan-tick',requestId:'time-fixture'});
 expect(timed.phase).toBe('complete');expect(timed.scan.reason).toBe('time-limit');expect(timed.messages).toHaveLength(2);
 await page.evaluate(yuanbaoCommand,{command:'history-scan-start',requestId:'nav-fixture',url:'https://yuanbao.tencent.com/chat/test'});
 await page.evaluate(()=>history.pushState({},'','/chat/different'));
 const changed=await page.evaluate(yuanbaoCommand,{command:'history-scan-tick',requestId:'nav-fixture'});
 expect(changed.phase).toBe('failed');expect(changed.messages).toBeUndefined();expect(await page.evaluate(()=>window.sends)).toBe(0);
});

test('scanner rejects gaps instead of guessing and labels a capacity-limited capture as partial',async()=>{
 await fixture();await scanClock();
 const url='https://yuanbao.tencent.com/chat/test';
 await page.evaluate(yuanbaoCommand,{command:'history-scan-start',requestId:'gap',url});
 await page.evaluate(()=>{document.querySelector('.agent-chat__bubble__content').textContent='完全无关的问题';document.querySelector('.hyc-content-md').textContent='无重叠回答';});
 const gap=await page.evaluate(yuanbaoCommand,{command:'history-scan-tick',requestId:'gap'});
 expect(gap.phase).toBe('failed');expect(gap.reason).toBe('ambiguous');expect(gap.messages).toBeUndefined();
 await page.evaluate(yuanbaoCommand,{command:'history-scan-start',requestId:'cap',url});
 await page.evaluate(()=>document.querySelector('.hyc-content-md').textContent='大'.repeat(400001));
 const partial=await page.evaluate(yuanbaoCommand,{command:'history-scan-tick',requestId:'cap'});
 expect(partial.phase).toBe('complete');expect(partial.scan.reason).toBe('capacity');expect(partial.scan.complete).toBe(false);
 expect(partial.messages.map(m=>m.content)).toEqual(['完全无关的问题','无重叠回答']);
 const oversized=await page.evaluate(yuanbaoCommand,{command:'history-scan-start',requestId:'too-large',url});
 expect(oversized.phase).toBe('failed');expect(oversized.reason).toBe('capacity');expect(oversized.messages).toBeUndefined();
 expect(await page.evaluate(()=>window.sends)).toBe(0);
});

test('relay preserves desktop scan failure instead of showing idle with a stale running scan',async()=>{
 await page.addInitScript(()=>{
  window.scanCancels=0;
  window.chrome={storage:{local:{get:async()=>({pairing:{url:'http://127.0.0.1:43129',token:'a'.repeat(64)}})}},scripting:{executeScript:async({args:[arg]})=>{
   if(arg.command==='history-scan-cancel'){window.scanCancels++;return [{result:{phase:'cancelled'}}];}
   if(arg.command.startsWith('history-scan'))return [{result:{phase:'running',count:64,characters:42012,direction:'up',scrolls:153}}];
   return [{result:{url:'https://yuanbao.tencent.com/chat/test',ready:true,reason:'',diagnostics:{editor:true,sendButtonVisible:true}}}];
  }}};
 });
 await page.route('https://relay-status.fixture/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice(1);
  if(!['yuanbao.html','yuanbao-relay.js','yuanbao-adapter.js','web-relay.js','web-relay-panel.js','image-upload.js','pairing.js','popup.css'].includes(name))return route.abort();
  await route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:readFileSync(join(root,'browser-extension',name))});
 });
 let polls=0;
 await page.route('http://127.0.0.1:43129/**',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
  const path=new URL(route.request().url()).pathname;
  const data=path.endsWith('/bind')?{bindingId:'fixture-binding'}:
   ++polls===1?{job:null,historyRequest:{id:'scan-fixture',url:'https://yuanbao.tencent.com/chat/test',scan:true}}:
   {job:null,historyRequest:null,historyStatus:{id:'scan-fixture',phase:'failed',code:'HISTORY_CONNECTION_TIMEOUT',message:'历史同步长时间未收到浏览器进度，任务已停止'}};
  await route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Content-Type':'application/json'},body:JSON.stringify(data)});
 });
 await page.goto('https://relay-status.fixture/yuanbao.html?tabId=1');
 await expect(page.locator('#status')).toContainText('已收集 64');
 await expect(page.locator('#status')).toContainText('扫描已中断');
 await expect.poll(()=>polls).toBeGreaterThan(3);
 await expect(page.locator('#status')).toContainText('历史同步失败');
 const d=JSON.parse(await page.locator('#diagnostics').textContent());
 expect(d.connection.scan.phase).toBe('failed');expect(d.connection.scan.reason).toBe('HISTORY_CONNECTION_TIMEOUT');
 expect(d.connection.history.accepted).toBe(false);expect(d.connection.lastError).toContain('未收到浏览器进度');
 expect(await page.evaluate(()=>window.scanCancels)).toBe(1);
});

test('connection panel delegates to background and reports worker termination without auto-reconnect',async()=>{
 await page.addInitScript(()=>{
  window.connections=0;window.sent=[];
  const listeners=[];
  window.chrome={runtime:{connect:()=>{
   window.connections++;
   const p={onMessage:{addListener:fn=>window.workerMessage=fn},onDisconnect:{addListener:fn=>window.workerGone=fn},postMessage:m=>window.sent.push(m),disconnect:()=>window.workerGone()};
   return p;
  }}};
 });
 await page.route('https://relay-panel.fixture/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice(1);
  if(!['yuanbao.html','yuanbao-relay.js','yuanbao-adapter.js','web-relay.js','web-relay-panel.js','image-upload.js','pairing.js','popup.css'].includes(name))return route.abort();
  await route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:readFileSync(join(root,'browser-extension',name))});
 });
 await page.goto('https://relay-panel.fixture/yuanbao.html?tabId=1');
 expect(await page.evaluate(()=>window.sent.filter(m=>m.type==='start').length)).toBe(1);
 await page.evaluate(()=>window.workerMessage({type:'view',id:'status',property:'textContent',value:'正在后台扫描，已收集 64 条'}));
 await expect(page.locator('#status')).toContainText('后台扫描');
 await page.evaluate(()=>window.workerGone());
 await expect(page.locator('#status')).toContainText('扩展后台连接已停止');
 expect(await page.evaluate(()=>window.connections)).toBe(1);
 await page.locator('#connect').click();expect(await page.evaluate(()=>window.connections)).toBe(2);
});

test('row renumbering and DOM replacement keep the same reply after old rows are trimmed',async()=>{
 await fixture();await page.evaluate(yuanbaoCommand,{command:'begin',job});await answer('<p>部分回答</p>');
 expect((await page.evaluate(yuanbaoCommand,{command:'tick',jobId:job.id})).phase).toBe('streaming');
 await page.evaluate(()=>{
  const list=document.getElementById('rows');
  // New DOM with renumbered positions, including IDs that used to identify old answers.
  list.innerHTML=list.innerHTML;
  list.querySelectorAll('[data-conv-idx]').forEach((e,i)=>e.dataset.convIdx=String(100+i));
 });
 expect((await page.evaluate(yuanbaoCommand,{command:'tick',jobId:job.id})).content).toBe('部分回答');
 await page.evaluate(()=>{
  const list=document.getElementById('rows');
  list.querySelectorAll('[data-conv-idx]').forEach((e,i)=>{if(i<2)e.remove();else e.dataset.convIdx=String(i-2);});
  const answer=list.querySelector('[data-conv-speaker="ai"]');answer.dataset.convOutputting='false';answer.querySelector('.hyc-content-md').classList.add('hyc-content-md-done');
  document.getElementById('yuanbao-send-btn').className='send-btn--disabled';
  window.__awbYuanbaoChatV1.changed=Date.now()-2500;
 });
 const done=await page.evaluate(yuanbaoCommand,{command:'tick',jobId:job.id});expect(done.phase).toBe('complete');expect(done.content).toBe('部分回答');
 expect(await page.evaluate(()=>window.sends)).toBe(1);
});
test('initial reply correlation survives renumbered older window and never reuses an old repeated question',async()=>{
 await fixture();
 await page.locator('[data-conv-speaker="human"] .agent-chat__bubble__content').evaluate((e,q)=>e.textContent=q,job.text);
 await page.evaluate(yuanbaoCommand,{command:'begin',job});
 // Renumbering existing content alone is not evidence that a new question was sent.
 await page.evaluate(()=>document.querySelectorAll('[data-conv-idx]').forEach((e,i)=>e.dataset.convIdx=String(50+i)));
 expect((await page.evaluate(yuanbaoCommand,{command:'tick',jobId:job.id})).phase).toBe('waiting');
 await answer('<p>本轮新答案</p>');
 expect((await page.evaluate(yuanbaoCommand,{command:'tick',jobId:job.id})).content).toBe('本轮新答案');
 await page.evaluate(()=>document.getElementById('rows').insertAdjacentHTML('beforeend','<div data-conv-idx="9" data-conv-speaker="human">额外手动提问</div>'));
 expect((await page.evaluate(yuanbaoCommand,{command:'tick',jobId:job.id})).error).toContain('另一条提问');
});
