import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installGrokReader} from '../browser-extension/grok.js';
import {grokCommand} from '../browser-extension/grok-adapter.js';
const root=resolve(fileURLToPath(new URL('../',import.meta.url))),url='https://x.com/i/grok?conversation=test-chat';
let app,desktop,page,dir;
test.beforeEach(async()=>{
 dir=mkdtempSync(join(tmpdir(),'awb-grok-chat-'));app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});desktop=await app.firstWindow();await desktop.waitForFunction(()=>!!window.workbench);
 const created=app.waitForEvent('window');await app.evaluate(async({BrowserWindow})=>{await new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadURL('about:blank');});page=await created;
 await page.route('https://x.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<main><div id="messages"><div data-message-author-role="user">旧问题</div><div data-message-author-role="assistant">旧回答</div></div><form><textarea placeholder="Ask anything"></textarea><button type="button" aria-label="Send" disabled>发送</button></form></main>'}));await page.goto(url);
 await page.evaluate(()=>{window.sends=0;const e=document.querySelector('textarea'),send=document.querySelector('button');e.oninput=()=>send.disabled=!e.value.trim();send.onclick=()=>{window.sends++;window.sent=e.value;e.value='';send.disabled=true;document.getElementById('messages').insertAdjacentHTML('beforeend','<div data-message-author-role="user" id="new-user"></div><div data-message-author-role="assistant" id="new-answer" data-is-streaming="true">新的回答</div>');document.getElementById('new-user').textContent=window.sent;document.querySelector('form').insertAdjacentHTML('beforeend','<button type="button" aria-label="Stop generating">停止</button>');};});await page.evaluate(installGrokReader);
});
test.afterEach(async()=>{if(app)await app.close();if(dir)rmSync(dir,{recursive:true,force:true});});
async function finish(){await page.evaluate(()=>{document.querySelector('[aria-label="Stop generating"]')?.remove();document.getElementById('new-answer').dataset.isStreaming='false';});}
test('Grok sends once, receives only the appended answer and stops on navigation',async()=>{
 const job={id:'test',text:'新问题',url};expect((await page.evaluate(grokCommand,{command:'probe'})).ready).toBe(true);
 expect((await page.evaluate(grokCommand,{command:'history',url})).messages).toHaveLength(2);
 expect((await page.evaluate(grokCommand,{command:'begin',job})).phase).toBe('waiting');await page.evaluate(grokCommand,{command:'begin',job});expect(await page.evaluate(()=>window.sends)).toBe(1);
 const partial=await page.evaluate(grokCommand,{command:'tick',jobId:job.id,url});expect(partial.phase).toBe('streaming');expect(partial.content).toBe('新的回答');await finish();await page.waitForTimeout(2600);expect((await page.evaluate(grokCommand,{command:'tick',jobId:job.id,url})).phase).toBe('complete');
 const next={id:'next',text:'再问',url};await page.evaluate(grokCommand,{command:'begin',job:next});await page.evaluate(()=>history.pushState({},'','/i/grok?conversation=other'));expect((await page.evaluate(grokCommand,{command:'tick',jobId:'next',url})).phase).toBe('failed');
});
test('Grok preserves drafts and refuses missing send controls without retry',async()=>{
 await page.locator('textarea').fill('用户草稿');expect((await page.evaluate(grokCommand,{command:'begin',job:{id:'draft',text:'不能覆盖',url}})).phase).toBe('failed');expect(await page.locator('textarea').inputValue()).toBe('用户草稿');
 await page.locator('textarea').fill('');await page.evaluate(()=>document.querySelector('button').remove());
 expect((await page.evaluate(grokCommand,{command:'begin',job:{id:'missing',text:'保留问题',url}})).phase).toBe('failed');expect(await page.locator('textarea').inputValue()).toBe('保留问题');expect(await page.evaluate(()=>window.sends)).toBe(0);
});
test('Grok real relay pipeline imports loaded history and persists a desktop question and reply',async()=>{
 const pair=JSON.parse((await desktop.evaluate(()=>window.workbench.call('browserBridgeInfo'))).pairing);
 const created=app.waitForEvent('window');await app.evaluate(async({BrowserWindow})=>{await new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadURL('about:blank');});const relay=await created;
 await relay.exposeFunction('executeForTest',async(name,arg)=>[{result:await page.evaluate(name==='installGrokReader'?installGrokReader:grokCommand,arg)}]);
 await relay.addInitScript(pair=>{window.chrome={storage:{local:{get:async()=>({pairing:pair})}},scripting:{executeScript:({func,args})=>window.executeForTest(func.name,args?.[0])}};},pair);
 await relay.route('https://relay.fixture/**',r=>{const name=new URL(r.request().url()).pathname.slice(1);if(!/^[a-z-]+\.(js|html|css)$/.test(name))return r.abort();return r.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:readFileSync(join(root,'browser-extension',name))});});
 await relay.route(pair.url+'/**',async r=>{if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});const res=await fetch(r.request().url(),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pair.token},body:r.request().postData()});return r.fulfill({status:res.status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:await res.text()});});
 await relay.goto('https://relay.fixture/grok.html?tabId=3');await expect.poll(async()=>(await desktop.evaluate(()=>window.workbench.call('webChatStatus',{provider:'grok'}))).history?.phase).toBe('complete');
 await desktop.getByRole('button',{name:'网页账号',exact:true}).click();await desktop.getByRole('button',{name:'进入 Grok 网页聊天'}).click();await expect(desktop.locator('.yuanbao-message.user')).toContainText('旧问题');await expect(desktop.getByRole('button',{name:'自动加载并同步历史'})).toBeHidden();await expect(desktop.getByRole('button',{name:'添加图片'})).toHaveCount(0);
 await desktop.getByLabel('发给Grok的问题').fill('新问题');await desktop.getByRole('button',{name:'发送给Grok',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.sends)).toBe(1);await finish();
 await expect.poll(async()=>(await desktop.evaluate(()=>window.workbench.call('snapshot'))).conversations[0].messages.at(-1).status,{timeout:15000}).toBe('complete');await expect(desktop.locator('.yuanbao-message.assistant').last()).toContainText('新的回答');
 await app.close();app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});desktop=await app.firstWindow();await desktop.waitForFunction(()=>!!window.workbench);const c=(await desktop.evaluate(()=>window.workbench.call('snapshot'))).conversations[0];expect(c.webChat.provider).toBe('Grok');expect(c.messages).toHaveLength(4);expect(c.messages.at(-1).content).toBe('新的回答');
});


test('user-observed ask-Grok label sends once even when another label is present',async()=>{
 await page.evaluate(()=>{const b=document.querySelector('button');b.setAttribute('aria-label','Grok');b.setAttribute('title','问grok问题');});
 const probe=await page.evaluate(grokCommand,{command:'probe'});expect(probe.diagnostics.sendButton).toBe(true);expect(probe.diagnostics.sendButtonMethod).toBe('semantic');
 const job={id:'ask-label',text:'核验中文提示',url};expect((await page.evaluate(grokCommand,{command:'begin',job})).phase).toBe('waiting');await page.evaluate(grokCommand,{command:'begin',job});expect(await page.evaluate(()=>window.sends)).toBe(1);
 const audit=(await page.evaluate(grokCommand,{command:'probe'})).diagnostics;expect(audit.lastSendAttempt.clicked).toBe(true);expect(JSON.stringify(audit)).not.toContain(job.text);
});

test('associated tooltip and an explicit native submit are recognized without choosing arbitrary buttons',async()=>{
 await page.evaluate(()=>{const b=document.querySelector('button');b.removeAttribute('aria-label');b.textContent='';b.setAttribute('aria-describedby','ask-tooltip');document.querySelector('form').insertAdjacentHTML('beforeend','<span id="ask-tooltip" role="tooltip">问 Grok 问题</span><button type="button" aria-label="添加图片">+</button>');});
 expect((await page.evaluate(grokCommand,{command:'probe'})).diagnostics.sendButtonCandidates).toBe(1);
 await page.evaluate(()=>{const b=document.querySelector('button');b.removeAttribute('aria-describedby');b.setAttribute('type','submit');});
 expect((await page.evaluate(grokCommand,{command:'probe'})).diagnostics.sendButtonMethod).toBe('explicit-form-submit');
 await page.evaluate(()=>document.querySelector('form').insertAdjacentHTML('beforeend','<button type="submit">其他</button>'));
 expect((await page.evaluate(grokCommand,{command:'probe'})).ready).toBe(false);
 expect((await page.evaluate(grokCommand,{command:'begin',job:{id:'ambiguous',text:'不能发送',url}})).phase).toBe('failed');expect(await page.evaluate(()=>window.sends)).toBe(0);
});
