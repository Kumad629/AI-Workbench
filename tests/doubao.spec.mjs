import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {doubaoCommand} from '../browser-extension/doubao-adapter.js';
import {startRelayPanel} from '../browser-extension/web-relay-panel.js';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
let app,page,desktop,dir;
const url='https://www.doubao.com/chat/123',job={id:'doubao-job',text:'继续讨论',url};
test.beforeEach(async()=>{
 dir=mkdtempSync(join(tmpdir(),'awb-doubao-'));
 app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});
 desktop=await app.firstWindow();await desktop.waitForFunction(()=>!!window.workbench);
 const created=app.waitForEvent('window');
 await app.evaluate(async({BrowserWindow})=>{await new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadURL('about:blank');});
 page=await created;await page.route('https://www.doubao.com/**',r=>r.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));await page.goto(url);
});
test.afterEach(async()=>{if(app)await app.close();if(dir)rmSync(dir,{recursive:true,force:true});});
async function fixture(modern=false){
 await page.setContent('<main><div id="rows"><div data-message-id="old-user" data-testid="send_message"><div data-testid="message_text_content">旧问题</div></div><div data-message-id="old-ai" data-testid="receive_message"><div class="flow-markdown-body"><p>旧回答</p></div></div></div><textarea data-testid="chat_input_input"></textarea><button data-testid="chat_input_send_button" disabled>发送</button></main>');
 await page.evaluate(modern=>{
  if(modern)document.querySelectorAll('[data-testid$="_message"]').forEach(n=>{n.className=n.dataset.testid==='send_message'?'bg-g-send-msg-bubble':'bg-g-receive-msg-bubble';n.removeAttribute('data-testid');});
  window.sends=0;const editor=document.querySelector('textarea'),send=document.querySelector('button');
  editor.addEventListener('input',()=>send.disabled=!editor.value.trim());
  send.onclick=()=>{window.sends++;window.promptText=editor.value;editor.value='';send.disabled=true;send.insertAdjacentHTML('afterend','<button data-testid="chat_input_stop_button">停止</button>');};
 },modern);
}
async function reply(done=false){
 await page.evaluate(done=>{
  if(!document.getElementById('new-question')){
   const q=document.createElement('div');q.id='new-question';q.dataset.testid='send_message';q.dataset.messageId='new-user';q.textContent=window.promptText;document.getElementById('rows').append(q);
   const a=document.createElement('div');a.id='new-answer';a.dataset.testid='receive_message';a.dataset.messageId='new-ai';a.innerHTML='<div class="flow-markdown-body"><p>新的豆包回答</p><table><tr><th>步骤</th><th>目标</th></tr><tr><td>验证</td><td>原型</td></tr></table><pre><code class="language-python">print(1)</code></pre></div>';document.getElementById('rows').append(a);
  }
  if(done){document.querySelector('[data-testid="chat_input_stop_button"]')?.remove();document.getElementById('new-answer').setAttribute('data-is-streaming','false');}
 },done);
}
test('both public message layouts preserve roles and Markdown; send happens once and streams to completion',async()=>{
 await fixture(true);
 expect((await page.evaluate(doubaoCommand,{command:'probe'})).ready).toBe(true);
 expect((await page.evaluate(doubaoCommand,{command:'history',url})).messages.map(m=>m.role)).toEqual(['user','assistant']);
 expect((await page.evaluate(doubaoCommand,{command:'begin',job})).phase).toBe('waiting');
 await page.evaluate(doubaoCommand,{command:'begin',job});expect(await page.evaluate(()=>window.sends)).toBe(1);
 await reply();const partial=await page.evaluate(doubaoCommand,{command:'tick',jobId:job.id,url});
 expect(partial.phase).toBe('streaming');expect(partial.content).toContain('| 步骤 | 目标 |');expect(partial.content).toContain('~~~'.replace(/~/g,'`')+'python');expect(partial.content).not.toContain('旧回答');
 await reply(true);await page.waitForTimeout(2100);
 expect((await page.evaluate(doubaoCommand,{command:'tick',jobId:job.id,url})).phase).toBe('complete');
 const history=await page.evaluate(doubaoCommand,{command:'history',url});expect(history.messages).toHaveLength(4);expect(history.messages[0].content).toBe('旧问题');
});
test('drafts, duplicate editors, missing structures, navigation and non-final answers fail conservatively',async()=>{
 await fixture();
 await page.locator('textarea').fill('用户草稿');const probe=await page.evaluate(doubaoCommand,{command:'probe'});
 expect(probe.ready).toBe(false);expect(probe.reason).toContain('草稿');expect(JSON.stringify(probe.diagnostics)).not.toContain('用户草稿');
 await page.evaluate(doubaoCommand,{command:'begin',job});expect(await page.evaluate(()=>window.sends)).toBe(0);
 await page.locator('textarea').fill('');await page.evaluate(()=>document.querySelector('main').insertAdjacentHTML('beforeend','<textarea data-testid="chat_input_input" id="extra"></textarea>'));
 expect((await page.evaluate(doubaoCommand,{command:'probe'})).reason).toContain('多个');
 await page.locator('#extra').evaluate(e=>e.remove());await page.evaluate(doubaoCommand,{command:'begin',job});await reply();
 await page.evaluate(()=>document.querySelector('[data-testid="chat_input_stop_button"]').remove());
 // No observed generating state or explicit completion: a stable body alone is not completion.
 await page.evaluate(()=>window.__awbDoubaoChatV1.seenGenerating=false);
 await page.evaluate(doubaoCommand,{command:'tick',jobId:job.id,url});await page.waitForTimeout(2100);
 expect((await page.evaluate(doubaoCommand,{command:'tick',jobId:job.id,url})).phase).toBe('streaming');
 await page.evaluate(()=>history.pushState({},'','/chat/other'));
 expect((await page.evaluate(doubaoCommand,{command:'tick',jobId:job.id,url})).phase).toBe('failed');
});
test('automatic history loading prepends older rows, preserves repeat prompts, restores scroll and cancels safely',async()=>{
 await fixture();
 await page.evaluate(()=>{
  window.clock=Date.now();Date.now=()=>window.clock;
  const rows=document.getElementById('rows');rows.style.cssText='height:120px;overflow:auto';for(const e of rows.children)e.style.minHeight='160px';rows.scrollTop=rows.scrollHeight;
  let loaded=false;rows.addEventListener('scroll',()=>{
   if(rows.scrollTop<2&&!loaded){loaded=true;const old=document.createElement('div');old.innerHTML='<div data-testid="send_message" style="min-height:160px">旧问题</div><div data-testid="receive_message" style="min-height:160px"><div class="flow-markdown-body">更早回答</div></div>';rows.prepend(...old.children);}
  });
 });
 let state=await page.evaluate(doubaoCommand,{command:'history-scan-start',requestId:'scan',url});
 for(let i=0;i<65&&state.phase==='running';i++){await page.waitForTimeout(20);await page.evaluate(()=>window.clock+=1000);state=await page.evaluate(doubaoCommand,{command:'history-scan-tick',requestId:'scan',url});}
 expect(state.phase).toBe('complete');expect(state.scan.complete).toBe(false);expect(state.messages.map(m=>m.content)).toEqual(['旧问题','更早回答','旧问题','旧回答']);
 expect(await page.locator('#rows').evaluate(e=>e.scrollHeight-e.clientHeight-e.scrollTop)).toBeLessThan(3);
 await page.evaluate(doubaoCommand,{command:'history-scan-start',requestId:'cancel',url});
 expect((await page.evaluate(doubaoCommand,{command:'history-scan-cancel',requestId:'cancel',url})).phase).toBe('cancelled');expect(await page.evaluate(()=>window.sends)).toBe(0);
});
test('Doubao relay imports, scans and continues a conversation while Yuanbao stays connected; saved UI survives restart',async()=>{
 await fixture();
 const info=await desktop.evaluate(()=>window.workbench.call('browserBridgeInfo')),pair=JSON.parse(info.pairing);
 const request=async(path,body)=>{const r=await fetch(pair.url+'/web-chat/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pair.token},body:JSON.stringify(body)});return r.json();};
 const yuanbao=await request('bind',{clientId:'12345678-1234-1234-1234-123456789abc',url:'https://yuanbao.tencent.com/chat/test',ready:true});
 const created=app.waitForEvent('window');await app.evaluate(async({BrowserWindow})=>{await new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadURL('about:blank');});const relay=await created;
 await relay.exposeFunction('executeForTest',async args=>{
  if(args.command.startsWith('history-scan'))await page.evaluate(()=>{window.fakeNow=(window.fakeNow||Date.now())+5000;Date.now=()=>window.fakeNow;});
  return [{result:await page.evaluate(doubaoCommand,args)}];
 });
 await relay.addInitScript(pair=>{window.chrome={storage:{local:{get:async()=>({pairing:pair})}},scripting:{executeScript:async({args})=>window.executeForTest(args[0])}};},pair);
 await relay.route('https://doubao-relay.fixture/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice(1);
  if(!['grok.js','doubao.html','doubao-relay.js','doubao-adapter.js','web-relay.js','web-relay-panel.js','image-upload.js','pairing.js','popup.css'].includes(name))return route.abort();
  await route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:readFileSync(join(root,'browser-extension',name))});
 });
 await relay.route(pair.url+'/**',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
  const r=await fetch(route.request().url(),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pair.token},body:route.request().postData()});
  await route.fulfill({status:r.status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:await r.text()});
 });
 await relay.goto('https://doubao-relay.fixture/doubao.html?tabId=2');
 await expect.poll(async()=>(await desktop.evaluate(()=>window.workbench.call('webChatStatus',{provider:'doubao'}))).history?.phase).toBe('complete');
 expect((await desktop.evaluate(()=>window.workbench.call('webChatStatus'))).bindingId).toBe(yuanbao.bindingId);
 await desktop.getByRole('button',{name:'网页账号',exact:true}).click();await desktop.getByRole('button',{name:'进入豆包网页聊天'}).click();
 await expect(desktop.locator('.yuanbao-message.user')).toContainText('旧问题');
 await desktop.getByRole('button',{name:'自动加载并同步历史'}).click();
 await expect.poll(async()=>(await desktop.evaluate(()=>window.workbench.call('webChatStatus',{provider:'doubao'}))).history?.phase,{timeout:30000}).toBe('complete');
 await expect(desktop.locator('.yuanbao-history-status')).toContainText('检查页面顶部和底部');
 // Restore the real clock for subsequent streaming checks.
 await page.evaluate(()=>{delete window.fakeNow;Date.now=()=>new Date().getTime();});
 await desktop.getByLabel('发给豆包的问题').fill('继续讨论');await desktop.getByRole('button',{name:'发送给豆包',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.sends)).toBe(1);await reply(true);
 await expect.poll(async()=>(await desktop.evaluate(()=>window.workbench.call('snapshot'))).conversations[0].messages.at(-1).status,{timeout:15000}).toBe('complete');
 await expect(desktop.locator('.yuanbao-messages table')).toBeVisible();await expect(desktop.getByRole('navigation',{name:'对话索引'})).toBeVisible();
 const snapshot=await desktop.evaluate(()=>window.workbench.call('snapshot'));expect(snapshot.conversations[0].webChat.provider).toBe('豆包');expect(snapshot.conversations[0].messages.at(-1).provider).toBe('豆包');
 expect(await page.evaluate(()=>window.sends)).toBe(1);
 await desktop.locator('.yuanbao-message.assistant').last().getByRole('button',{name:'收藏',exact:true}).click();await desktop.getByRole('dialog').getByLabel('标题',{exact:true}).fill('豆包方案');await desktop.getByRole('button',{name:'保存精选'}).click();
 mkdirSync(join(root,'artifacts'),{recursive:true});await desktop.screenshot({path:join(root,'artifacts/doubao-chat.png')});
 await app.close();app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});desktop=await app.firstWindow();
 await desktop.locator('.conversation-item').first().click();await expect(desktop.getByRole('button',{name:'发送给豆包',exact:true})).toBeVisible();await expect(desktop.locator('.yuanbao-messages table')).toBeVisible();
 expect((await desktop.evaluate(()=>window.workbench.call('snapshot'))).excerpts).toHaveLength(1);
});

test('Doubao virtual history windows join by overlap and enforce partial/cancel boundaries',async()=>{
 await fixture();
 await page.evaluate(()=>{
  window.clock=Date.now();Date.now=()=>window.clock;
  document.getElementById('rows').remove();
  const s=document.createElement('div');s.id='virtual';s.style.cssText='height:300px;overflow:auto;position:relative';s.innerHTML='<div id="spacer" style="height:2000px;position:relative"></div>';document.querySelector('main').prepend(s);
  const draw=()=>{const start=Math.min(14,Math.floor(s.scrollTop/100));document.getElementById('spacer').innerHTML=Array.from({length:6},(_,i)=>{const n=start+i;return '<div data-testid="'+(n%2?'receive_message':'send_message')+'" style="position:absolute;top:'+n*100+'px;height:100px">'+(n%2?'回答 '+n:'继续')+'</div>';}).join('');};
  s.addEventListener('scroll',draw);s.scrollTop=1700;draw();
 });
 let state=await page.evaluate(doubaoCommand,{command:'history-scan-start',requestId:'virtual',url});
 for(let i=0;i<100&&state.phase==='running';i++){await page.waitForTimeout(20);await page.evaluate(()=>window.clock+=1000);state=await page.evaluate(doubaoCommand,{command:'history-scan-tick',requestId:'virtual',url});}
 expect(state.phase).toBe('complete');expect(state.messages).toHaveLength(20);expect(state.messages.filter(m=>m.role==='user').map(m=>m.content)).toEqual(Array(10).fill('继续'));
 await page.evaluate(doubaoCommand,{command:'history-scan-start',requestId:'limit',url});await page.evaluate(()=>window.clock+=900001);
 expect((await page.evaluate(doubaoCommand,{command:'history-scan-tick',requestId:'limit',url})).scan.reason).toBe('time-limit');
 await page.evaluate(doubaoCommand,{command:'history-scan-start',requestId:'navigation',url});await page.evaluate(()=>history.pushState({},'','/chat/456'));
 const moved=await page.evaluate(doubaoCommand,{command:'history-scan-tick',requestId:'navigation',url});expect(moved.phase).toBe('failed');expect(moved.messages).toBeUndefined();expect(await page.evaluate(()=>window.sends)).toBe(0);
});
test('extension popup chooses a dedicated Doubao relay and reuses only that page',async()=>{
 const created=app.waitForEvent('window');await app.evaluate(async({BrowserWindow})=>{await new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadURL('about:blank');});const popup=await created;
 await popup.addInitScript(()=>{
  window.created=0;window.updated=0;
  let tabs=[{id:1,url:'https://www.doubao.com/chat/123'},{id:2,url:'https://popup.fixture/yuanbao.html?tabId=1'}];
  window.chrome={
   storage:{local:{get:async()=>({pairing:{url:'http://127.0.0.1:43129',token:'a'.repeat(64)}})}},
   runtime:{getURL:name=>'https://popup.fixture/'+name},
   tabs:{query:async options=>options.active?[tabs[0]]:tabs,create:async options=>{window.created++;const tab={id:3,...options};tabs.push(tab);window.lastCreated=tab;return tab;},update:async(id,options)=>{window.updated++;return {id,...options};}}
  };
 });
 await popup.route('https://popup.fixture/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice(1);
  if(!/^[a-z-]+\.(?:js|html|css)$/.test(name))return route.abort();
  await route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:readFileSync(join(root,'browser-extension',name))});
 });
 await popup.goto('https://popup.fixture/popup.html');
 await expect(popup.getByRole('button',{name:'连接豆包网页聊天'})).toBeVisible();await expect(popup.locator('#capture-controls')).toBeHidden();
 await popup.getByRole('button',{name:'连接豆包网页聊天'}).click();await expect(popup.locator('#status')).toContainText('已打开豆包连接页');
 expect(await popup.evaluate(()=>window.lastCreated.url)).toBe('https://popup.fixture/doubao.html?tabId=1');
 await popup.getByRole('button',{name:'连接豆包网页聊天'}).click();expect(await popup.evaluate(()=>window.created)).toBe(1);expect(await popup.evaluate(()=>window.updated)).toBe(1);
});

test('alternate send ID and nested markers resolve one control and send only once',async()=>{
 for(const mode of ['flow-id','nested']){
  await fixture();
  await page.evaluate(mode=>{
   delete window.__awbDoubaoChatV1;
   const send=document.querySelector('button');
   send.removeAttribute('data-testid');
   if(mode==='flow-id')send.id='flow-end-msg-send';
   else send.innerHTML='<span id="flow-end-msg-send" data-testid="chat_input_send_button">发送</span>';
   document.querySelector('main').insertAdjacentHTML('beforeend','<button data-testid="chat_input_send_button" style="display:none">旧版隐藏按钮</button>');
  },mode);
  const probe=await page.evaluate(doubaoCommand,{command:'probe'});
  expect(probe.ready).toBe(true);
  expect(probe.diagnostics.sendButtonCandidates).toBe(1);
  expect(probe.diagnostics.sendButtonMatches).toContain('flow-id');
  expect(probe.diagnostics.sendButtonDisabled).toBe(true);
  expect((await page.evaluate(doubaoCommand,{command:'begin',job})).phase).toBe('waiting');
  await page.evaluate(doubaoCommand,{command:'begin',job});
  expect(await page.evaluate(()=>window.sends)).toBe(1);
 }
});

test('semantic send fallback stays inside the composer and does not expose draft content',async()=>{
 await fixture();
 await page.evaluate(()=>{
  const e=document.querySelector('textarea'),send=document.querySelector('button');
  const composer=document.createElement('section');document.querySelector('main').append(composer);composer.append(e,send);
  send.removeAttribute('data-testid');send.textContent='';send.setAttribute('aria-label','Send message');
  document.getElementById('rows').insertAdjacentHTML('beforeend','<div data-testid="receive_message"><button id="message-send" aria-label="发送">发送</button></div>');
  document.querySelector('main').insertAdjacentHTML('afterbegin','<aside><button aria-label="发送">发送</button></aside>');
  document.querySelectorAll('#message-send,aside button').forEach(b=>b.onclick=()=>{window.wrongClicks=(window.wrongClicks||0)+1;});
 });
 const probe=await page.evaluate(doubaoCommand,{command:'probe'});
 expect(probe.ready).toBe(true);expect(probe.diagnostics.sendButtonMatches).toEqual(['composer-label']);
 expect((await page.evaluate(doubaoCommand,{command:'begin',job})).phase).toBe('waiting');
 expect(await page.evaluate(()=>window.sends)).toBe(1);expect(await page.evaluate(()=>window.wrongClicks||0)).toBe(0);
 await page.evaluate(()=>{
  delete window.__awbDoubaoChatV1;
  document.querySelector('[data-testid="chat_input_stop_button"]').remove();
  document.querySelector('section button').remove();
 });
 const missing=await page.evaluate(doubaoCommand,{command:'probe'});
 expect(missing.ready).toBe(true);expect(missing.diagnostics.sendButtonPending).toBe(true);expect(missing.diagnostics.sendButtonCandidates).toBe(0);
 await page.locator('textarea').fill('不能出现在诊断里的私人草稿');
 expect(JSON.stringify((await page.evaluate(doubaoCommand,{command:'probe'})).diagnostics)).not.toContain('私人草稿');
});

test('ambiguous and persistently disabled send buttons never receive a click',async()=>{
 await fixture();
 await page.evaluate(()=>document.querySelector('main').insertAdjacentHTML('beforeend','<button id="flow-end-msg-send">发送</button>'));
 let probe=await page.evaluate(doubaoCommand,{command:'probe'});
 expect(probe.ready).toBe(false);expect(probe.diagnostics.sendButtonCandidates).toBe(2);
 expect(probe.reason).toContain('多个');
 expect((await page.evaluate(doubaoCommand,{command:'begin',job})).phase).toBe('failed');
 expect(await page.evaluate(()=>window.sends)).toBe(0);
 await page.evaluate(()=>{
  document.getElementById('flow-end-msg-send').remove();
  delete window.__awbDoubaoChatV1;
  document.querySelector('button').setAttribute('aria-disabled','true');
 });
 expect((await page.evaluate(doubaoCommand,{command:'begin',job})).phase).toBe('failed');
 expect(await page.evaluate(()=>window.sends)).toBe(0);
});

test('deep composer wrappers and custom div send controls are recognized without selecting upload',async()=>{
 await fixture();
 await page.evaluate(()=>{
  const e=document.querySelector('textarea'),old=document.querySelector('button'),send=document.createElement('div');
  send.className='send-btn-DDB6yN';send.textContent='↑';send.setAttribute('disabled','');
  send.onclick=()=>{window.sends++;window.promptText=e.value;e.value='';};
  old.remove();const root=document.createElement('section');root.dataset.testid='chat_input';document.querySelector('main').append(root);
  let nest=root;for(let i=0;i<7;i++){const child=document.createElement('div');nest.append(child);nest=child;}nest.append(e);
  const upload=document.createElement('button');upload.textContent='上传';upload.onclick=()=>window.uploadClicks=(window.uploadClicks||0)+1;nest.append(upload);root.append(send);
  e.addEventListener('input',()=>send.removeAttribute('disabled'));
 });
 const probe=await page.evaluate(doubaoCommand,{command:'probe'});
 expect(probe.ready).toBe(true);expect(probe.diagnostics.composerExplicit).toBe(true);
 expect(probe.diagnostics.composerAncestors.length).toBeGreaterThan(4);
 expect(probe.diagnostics.sendButtonMatches).toEqual(['composer-send-class']);
 expect(probe.diagnostics.sendButtonDisabled).toBe(true);
 expect((await page.evaluate(doubaoCommand,{command:'begin',job})).phase).toBe('waiting');
 expect(await page.evaluate(()=>window.sends)).toBe(1);expect(await page.evaluate(()=>window.uploadClicks||0)).toBe(0);
});

async function delayedComposer(render=true){
 await fixture();
 await page.evaluate(render=>{
  const e=document.querySelector('textarea');document.querySelector('button').remove();
  const root=document.createElement('section');document.querySelector('main').append(root);root.append(e);
  e.addEventListener('input',()=>{if(!render)return;setTimeout(()=>{
   const send=document.createElement('button');send.id='flow-end-msg-send';send.textContent='发送';
   send.onclick=()=>{window.sends++;window.promptText=e.value;e.value='';};root.append(send);
  },650);});
 },render);
}
test('empty recognized composer connects without editing and waits for the send button after typing',async()=>{
 await delayedComposer();
 const probe=await page.evaluate(doubaoCommand,{command:'probe'});
 expect(probe.ready).toBe(true);expect(probe.diagnostics.sendButtonPending).toBe(true);expect(probe.note).toContain('等待');
 expect(await page.locator('textarea').inputValue()).toBe('');expect(await page.evaluate(()=>window.sends)).toBe(0);
 expect((await page.evaluate(doubaoCommand,{command:'begin',job})).phase).toBe('waiting');
 await page.evaluate(doubaoCommand,{command:'begin',job});expect(await page.evaluate(()=>window.sends)).toBe(1);
});
test('missing send button after input preserves the draft without claiming a send or retrying',async()=>{
 await delayedComposer(false);
 const result=await page.evaluate(doubaoCommand,{command:'begin',job});
 expect(result.phase).toBe('failed');expect(result.error).toContain('没有点击发送');
 expect(await page.locator('textarea').inputValue()).toBe(job.text);
 expect(await page.evaluate(()=>!!window.__awbDoubaoChatV1.clicked)).toBe(false);
 expect((await page.evaluate(doubaoCommand,{command:'begin',job})).phase).toBe('failed');
 expect(await page.evaluate(()=>window.sends)).toBe(0);
});
test('navigation during delayed send cancels before clicking',async()=>{
 await delayedComposer();
 await page.evaluate(()=>document.querySelector('textarea').addEventListener('input',()=>setTimeout(()=>history.pushState({},'','/chat/changed'),250)));
 expect((await page.evaluate(doubaoCommand,{command:'begin',job})).phase).toBe('failed');
 expect(await page.evaluate(()=>window.sends)).toBe(0);
});

test('changed old answers and rebuilt rows keep receiving the new reply without another send',async()=>{
 await fixture();
 await page.evaluate(doubaoCommand,{command:'begin',job});
 await page.locator('[data-message-id="old-ai"] .flow-markdown-body').evaluate(e=>e.innerHTML='<p>旧回答重新排版后内容改变</p>');
 await reply();
 expect((await page.evaluate(doubaoCommand,{command:'tick',jobId:job.id,url})).phase).toBe('streaming');
 // Rebuild every node and reuse old identifiers: role and question order identify the answer.
 await page.locator('#rows').evaluate(e=>{e.innerHTML=e.innerHTML;e.querySelector('#new-question').dataset.messageId='old-user';e.querySelector('#new-answer').dataset.messageId='old-ai';});
 let result=await page.evaluate(doubaoCommand,{command:'tick',jobId:job.id,url});
 expect(result.phase).toBe('streaming');expect(result.content).toContain('新的豆包回答');expect(result.content).not.toContain('旧回答');
 // A confirmed node remains valid when older rows are evicted from the rendered window.
 await page.locator('#rows').evaluate(e=>{while(e.firstElementChild.id!=='new-question')e.firstElementChild.remove();});
 await reply(true);await page.waitForTimeout(2100);
 result=await page.evaluate(doubaoCommand,{command:'tick',jobId:job.id,url});
 expect(result.phase).toBe('complete');expect(await page.evaluate(()=>window.sends)).toBe(1);
});

test('an existing identical question is not mistaken for the new question',async()=>{
 await fixture();
 await page.locator('[data-message-id="old-user"]').evaluate((e,p)=>e.textContent=p,job.text);
 await page.evaluate(doubaoCommand,{command:'begin',job});
 const waiting=await page.evaluate(doubaoCommand,{command:'tick',jobId:job.id,url});
 expect(waiting.phase).toBe('waiting');expect(waiting.content).toBe('');
 await reply();
 const result=await page.evaluate(doubaoCommand,{command:'tick',jobId:job.id,url});
 expect(result.phase).toBe('streaming');expect(result.content).toContain('新的豆包回答');
 expect(await page.evaluate(()=>window.sends)).toBe(1);
});

test('missing question overlap never attaches an unrelated answer and times out without resend',async()=>{
 await fixture();await page.evaluate(doubaoCommand,{command:'begin',job});await reply();
 await page.locator('[data-message-id="old-user"]').evaluate(e=>e.textContent='不相关的另一条提问');
 let result=await page.evaluate(doubaoCommand,{command:'tick',jobId:job.id,url});
 expect(result.phase).toBe('waiting');expect(result.content).toBe('');
 await page.evaluate(()=>window.__awbDoubaoChatV1.created-=31000);
 result=await page.evaluate(doubaoCommand,{command:'tick',jobId:job.id,url});
 expect(result.phase).toBe('failed');expect(result.error).toContain('提问顺序');
 await page.evaluate(doubaoCommand,{command:'begin',job});expect(await page.evaluate(()=>window.sends)).toBe(1);
});

test('multiple newly appended identical questions are rejected before reading an answer',async()=>{
 await fixture();await page.evaluate(doubaoCommand,{command:'begin',job});await reply();
 await page.locator('#rows').evaluate(e=>e.append(document.querySelector('#new-question').cloneNode(true)));
 const result=await page.evaluate(doubaoCommand,{command:'tick',jobId:job.id,url});
 expect(result.phase).toBe('failed');expect(result.error).toContain('多个相同');expect(result.content).toBe('');
 expect(await page.evaluate(()=>window.sends)).toBe(1);
});

test('a different follow-up from the webpage stops reception after the tracked question',async()=>{
 await fixture();await page.evaluate(doubaoCommand,{command:'begin',job});await reply();
 expect((await page.evaluate(doubaoCommand,{command:'tick',jobId:job.id,url})).phase).toBe('streaming');
 await page.locator('#rows').evaluate(e=>{const q=document.createElement('div');q.dataset.testid='send_message';q.textContent='从网页发出的另一个问题';e.append(q);});
 const result=await page.evaluate(doubaoCommand,{command:'tick',jobId:job.id,url});
 expect(result.phase).toBe('failed');expect(result.error).toContain('另一条提问');
 expect(await page.evaluate(()=>window.sends)).toBe(1);
});

test('history extraction audit distinguishes row text from a selected inner block without exposing content',async()=>{
 await fixture();
 await page.locator('[data-message-id="old-user"]').evaluate(e=>{
  e.innerHTML='<span>private omitted question prefix</span><div data-testid="message_text_content">private selected fragment</div><img alt="private image label" src="data:image/png;base64,private">';
  e.setAttribute('title','private metadata');
 });
 const history=await page.evaluate(doubaoCommand,{command:'history',url});
 const d=(await page.evaluate(doubaoCommand,{command:'probe'})).diagnostics;
 const row=d.extraction.rows[0];
 expect(row.role).toBe('user');expect(row.markers.userTestId).toBe(true);
 expect(row.visibleCharacters).toBeGreaterThan(row.extractedCharacters);
 expect(row.selectedBlocks[0].explicitText).toBe(true);
 expect(row.selectedBlocks[0].isRow).toBe(false);
 expect(row.extractedCharacters).toBe(history.messages[0].content.length);
 expect(row.imageCount).toBe(1);expect(JSON.stringify(d)).not.toContain('private');
 expect(await page.evaluate(()=>window.sends)).toBe(0);
 await page.evaluate(()=>history.pushState({},'','/chat/other'));
 expect((await page.evaluate(doubaoCommand,{command:'probe'})).diagnostics.extraction).toBeNull();
});

test('extraction audit bounds rows and preserves the original history output',async()=>{
 await fixture();
 await page.locator('#rows').evaluate(e=>{
  e.innerHTML=Array.from({length:24},(_,i)=>'<div data-testid="'+(i%2?'receive_message':'send_message')+'">private row '+i+'</div>').join('');
 });
 const result=await page.evaluate(doubaoCommand,{command:'history',url});
 const d=(await page.evaluate(doubaoCommand,{command:'probe'})).diagnostics;
 expect(result.messages).toHaveLength(24);expect(result.messages[0].content).toBe('private row 0');
 expect(d.extraction.totalRows).toBe(24);expect(d.extraction.rows).toHaveLength(20);expect(d.extraction.truncated).toBe(true);
 expect(JSON.stringify(d)).not.toContain('private row');
 expect(await page.evaluate(()=>window.sends)).toBe(0);
});

// A virtualized history window may be rebuilt while scrolling. These tests run
// the injected adapter against DOM snapshots, never a logged-in provider account.
async function scanWindow(messages){
 await page.evaluate(messages=>{
  const list=document.getElementById('rows');list.replaceChildren();list.style.cssText='height:120px;overflow:auto';
  for(const message of messages){
   const row=document.createElement('div');row.dataset.testid=message.role==='user'?'send_message':'receive_message';row.style.minHeight='160px';
   const body=document.createElement('div');body.dataset.testid='message_text_content';
   const image=message.content.match(/^\[图片(?:：([^\]]*))?\]$/);
   if(image){const img=document.createElement('img');if(image[1])img.alt=image[1];body.append(img);}else body.textContent=message.content;
   row.append(body);list.append(row);
  }
  list.scrollTop=list.scrollHeight;
 },messages);
}
const scanPair=(q,a)=>[{role:'user',content:q},{role:'assistant',content:a}];
async function startWindowScan(messages,id='window-scan'){
 await fixture();await page.evaluate(()=>{window.scanClock=Date.now();Date.now=()=>window.scanClock;delete window.__awbDoubaoHistoryScanV1;});
 await scanWindow(messages);return page.evaluate(doubaoCommand,{command:'history-scan-start',requestId:id,url});
}
async function scanTick(ms=1000,id='window-scan'){
 await page.evaluate(ms=>window.scanClock+=ms,ms);return page.evaluate(doubaoCommand,{command:'history-scan-tick',requestId:id,url});
}

test('scan freezes and rereads a temporary non-overlapping window before resuming exact history',async()=>{
 const original=[...scanPair('原问题一','原回答一'),...scanPair('原问题二','原回答二')];
 const started=await startWindowScan(original);await scanWindow(scanPair('暂时加载内容','暂时占位'));
 const waiting=await scanTick();expect(waiting.phase).toBe('running');expect(waiting.alignment.method).toBe('waiting');expect(waiting.scrolls).toBe(started.scrolls);
 const position=await page.locator('#rows').evaluate(e=>e.scrollTop);await scanTick();expect(await page.locator('#rows').evaluate(e=>e.scrollTop)).toBe(position);
 await scanWindow([...scanPair('更早问题','更早回答'),...original]);
 const resumed=await scanTick();expect(resumed.phase).toBe('running');expect(resumed.count).toBe(6);expect(resumed.alignment.method).toBe('exact-after-retry');
 expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual([...scanPair('更早问题','更早回答'),...original]);
 expect(await page.evaluate(()=>window.sends)).toBe(0);
});

test('22 captured rows join an 11-row rebuilt window only after two stable unique answered questions',async()=>{
 const original=Array.from({length:11},(_,i)=>scanPair('提问'+(i+10),'原回答'+(i+10))).flat();
 const older=[...scanPair('提问8','回答8'),...scanPair('提问9','回答9')];
 const fresh=[...older,...scanPair('提问10','重绘后的回答10'),...scanPair('提问11','重绘后的回答11'),...scanPair('提问12','原回答12'),{role:'user',content:'提问13'}];
 await startWindowScan(original);await scanWindow(fresh);
 expect((await scanTick()).alignment.method).toBe('waiting');
 expect((await scanTick()).count).toBe(22);
 const resumed=await scanTick();expect(resumed.phase).toBe('running');expect(resumed.count).toBe(26);
 expect(resumed.alignment.method).toBe('questions');expect(resumed.alignment.anchors).toBe(3);expect(resumed.alignment.retainedDifferences).toBe(2);
 expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual([...older,...original]);
 // Finish via the existing time bound and check that a retried completed command is idempotent.
 const complete=await scanTick(900001);expect(complete.phase).toBe('complete');expect(complete.messages).toEqual([...older,...original]);
 expect((await scanTick()).messages).toEqual(complete.messages);
 const diagnostic=JSON.stringify(resumed.alignment);expect(diagnostic).not.toContain('提问');expect(diagnostic).not.toContain('重绘后的回答');
});

test('question fallback rejects weak image/repeated anchors, reordering and skipped rows without changing captured history',async()=>{
 const cases=[
  {old:[...scanPair('唯一问题','原答'),...scanPair('重复问题','原答二'),...scanPair('重复问题','原答三')],fresh:[...scanPair('唯一问题','变化'),...scanPair('重复问题','变化二'),...scanPair('重复问题','变化三')]},
  {old:[...scanPair('[图片]','原图答一'),...scanPair('[图片：截图]','原图答二')],fresh:[...scanPair('[图片]','图答变化一'),...scanPair('[图片：截图]','图答变化二')]},
  {old:[...scanPair('问题甲','甲答'),...scanPair('问题乙','乙答'),...scanPair('问题丙','丙答')],fresh:[...scanPair('问题乙','乙变化'),...scanPair('问题甲','甲变化'),...scanPair('问题丙','丙变化')]},
  {old:[...scanPair('问题甲','甲答'),...scanPair('问题乙','乙答'),...scanPair('问题丙','丙答')],fresh:[...scanPair('问题甲','甲变化'),...scanPair('问题丙','丙变化')]},
  {old:[...scanPair('图片前','前答'),{role:'user',content:'[图片]'},...scanPair('图片后','后答')],fresh:[...scanPair('图片前','前变化'),{role:'user',content:'[图片：不同]'},...scanPair('图片后','后变化')]}
 ];
 for(const sample of cases){
  await startWindowScan(sample.old);await scanWindow(sample.fresh);const waiting=await scanTick();expect(waiting.phase).toBe('running');
  const failed=await scanTick(12001);expect(failed.phase).toBe('failed');expect(failed.reason).toBe('ambiguous');expect(failed.messages).toBeUndefined();
  expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual(sample.old);
 }
 expect(await page.evaluate(()=>window.sends)).toBe(0);
});

test('ambiguous exact overlaps are not resolved by choosing the first repeated occurrence',async()=>{
 const original=[...scanPair('重复','相同回答'),...scanPair('分隔','中间回答'),...scanPair('重复','相同回答')];
 await startWindowScan(original);await scanWindow(scanPair('重复','相同回答'));
 const waiting=await scanTick();expect(waiting.alignment.exactCandidates).toBe(2);
 expect((await scanTick(12001)).phase).toBe('failed');
 expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual(original);
});

test('unstable answer rerenders cannot pass question matching; waiting scan still cancels and detects navigation',async()=>{
 const original=[...scanPair('稳定问题一','旧一'),...scanPair('稳定问题二','旧二')];
 await startWindowScan(original);
 for(let i=0;i<4;i++){
  await scanWindow([...scanPair('稳定问题一','变化'+i),...scanPair('稳定问题二','变化'+i)]);
  expect((await scanTick(2500)).alignment.method).toBe('waiting');
 }
 expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual(original);
 expect((await page.evaluate(doubaoCommand,{command:'history-scan-cancel',requestId:'window-scan',url})).phase).toBe('cancelled');
 await startWindowScan(original);await scanWindow(scanPair('临时','占位'));await scanTick();
 await page.evaluate(()=>history.pushState({},'','/chat/other'));
 const moved=await scanTick();expect(moved.phase).toBe('failed');expect(moved.reason).toBe('navigation');
});

async function positionedWindow(messages,order=messages.map((_,i)=>i)){
 await page.evaluate(({messages,order})=>{
  const list=document.getElementById('rows');list.replaceChildren();list.style.cssText='height:180px;overflow:auto;position:relative';
  const spacer=document.createElement('div');spacer.style.cssText='position:relative;height:'+messages.length*100+'px';list.append(spacer);
  for(const i of order){const m=messages[i],row=document.createElement('div');row.dataset.testid=m.role==='user'?'send_message':'receive_message';row.style.cssText='position:absolute;top:'+i*100+'px;height:90px;width:100%';row.textContent=m.content;spacer.append(row);}
 },{messages,order});
}

test('history uses visual order for recycled positioned rows and reports DOM order without text',async()=>{
 await fixture();const messages=[...scanPair('首条机密问题','首条机密答案'),...scanPair('第二问题','第二答案'),...scanPair('末条问题','末条答案')];
 await positionedWindow(messages,[2,3,4,5,0,1]);
 const history=await page.evaluate(doubaoCommand,{command:'history',url});expect(history.messages).toEqual(messages);
 const audit=(await page.evaluate(doubaoCommand,{command:'probe'})).diagnostics.extraction;
 expect(audit.order).toBe('visual-top-to-bottom');expect(audit.domOrderChanged).toBe(true);expect(audit.domIndexes).toEqual([4,5,0,1,2,3]);
 expect(JSON.stringify(audit)).not.toContain('机密');
});

test('scanner joins a visually overlapping virtual window despite rotated DOM insertion order',async()=>{
 const original=Array.from({length:11},(_,i)=>scanPair('提问'+(i+10),'回答'+(i+10))).flat();
 await startWindowScan(original);
 const prefix=[...scanPair('提问8','回答8'),...scanPair('提问9','回答9')];
 const window=[...prefix,...original.slice(0,7)];expect(window).toHaveLength(11);
 await positionedWindow(window,[4,5,6,7,8,9,10,0,1,2,3]);
 const state=await scanTick();expect(state.phase).toBe('running');expect(state.count).toBe(26);
 expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual([...prefix,...original]);
 expect((await scanTick()).count).toBe(26);
 const finished=await scanTick(900001);expect(finished.messages).toEqual([...prefix,...original]);
});

test('failed scan diagnostics expose exact match indexes and bounded outlines without transcript',async()=>{
 const original=[...scanPair('机密问题甲','机密回答甲'),...scanPair('机密问题乙','机密回答乙'),...scanPair('机密问题丙','机密回答丙')];
 await startWindowScan(original);await scanWindow([...scanPair('机密问题乙','机密回答乙'),...scanPair('机密问题甲','机密回答甲')]);
 const state=await scanTick();expect(state.alignment.method).toBe('waiting');
 expect(state.alignment.batchOutline.map(m=>m.matchingRecordIndexes)).toEqual([[2],[3],[0],[1]]);
 expect(state.alignment.recordOutline).toHaveLength(6);expect(state.alignment.matchingTextQuestions).toBe(2);
 expect(state.alignment.uniqueQuestionMatches).toEqual([{batchIndex:0,recordIndex:2},{batchIndex:2,recordIndex:0}]);
 expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual(original);
 expect((await scanTick(12001)).phase).toBe('failed');
 expect(JSON.stringify(state.alignment)).not.toContain('机密');
});

test('open diagnostics remain selectable while worker updates continue; refresh and copy use one snapshot',async()=>{
 await page.setContent('<button id="connect">连接</button><p id="status"></p><p id="source"></p><details id="diagnostics-details"><summary>连接诊断</summary><pre id="diagnostics"></pre><button id="copy-diagnostics">复制连接诊断</button><p id="copy-feedback"></p></details>');
 await page.evaluate(()=>{
  window.panelSent=[];window.copied=[];
  window.chrome={runtime:{connect:()=>({postMessage:m=>window.panelSent.push(m),onMessage:{addListener:fn=>window.deliver=fn},onDisconnect:{addListener:()=>{}},disconnect:()=>{}})}};
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{if(window.copyFails)throw new Error('denied');window.copied.push(value);}}});
 });
 await page.evaluate(startRelayPanel);
 const deliver=async(id,value)=>page.evaluate(({id,value})=>window.deliver({type:'view',id,property:'textContent',value}),{id,value});
 await deliver('diagnostics','snapshot one');await page.locator('summary').click();
 await expect(page.locator('#diagnostics')).toHaveText('snapshot one');
 await page.locator('#diagnostics').evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
 await deliver('diagnostics','snapshot two');await deliver('status','扫描继续中');
 expect(await page.evaluate(()=>getSelection().toString())).toBe('snapshot one');
 await expect(page.locator('#status')).toHaveText('扫描继续中');
 await page.locator('#copy-diagnostics').click();expect(await page.evaluate(()=>window.copied)).toEqual(['snapshot two']);
 await deliver('diagnostics','snapshot refreshed');
 await page.getByRole('button',{name:'刷新诊断',exact:true}).click();await expect(page.locator('#diagnostics')).toHaveText('snapshot refreshed');
 await page.locator('#copy-diagnostics').click();expect(await page.evaluate(()=>window.copied)).toEqual(['snapshot two','snapshot refreshed']);
 await page.evaluate(()=>window.copyFails=true);await page.locator('#copy-diagnostics').click();await expect(page.locator('#copy-feedback')).toContainText('复制失败');
 await deliver('diagnostics','snapshot three');await expect(page.locator('#diagnostics')).toHaveText('snapshot refreshed');
 expect(await page.evaluate(()=>window.panelSent.map(m=>m.type))).toEqual(['visibility','start']);
});

function sparseDiagnosticFixture(){
 const q=(content)=>({role:'user',content}),a=content=>({role:'assistant',content});
 // Match the user's 22-row roles, lengths and exact match indexes, using synthetic text.
 const records=[a('甲'.repeat(302)),q('[图片]'),q('乙'.repeat(5)),a('丙'.repeat(388)),q('丁'.repeat(30)),a('戊'.repeat(856)),q('[图片]'),q('己'.repeat(18)),a('庚'.repeat(896)),q('[图片]'),q('辛'.repeat(29)),a('壬'.repeat(738)),q('[图片：'+'图'.repeat(11)+']'),q('癸'.repeat(23)),a('子'.repeat(582)),q('[图片]'),q('丑'.repeat(25)),a('寅'.repeat(518)),q('卯'.repeat(12)),a('辰'.repeat(571)),q('巳'.repeat(13)),a('午'.repeat(263))];
 const prefix=[q('未'.repeat(13)),a('申'.repeat(304)),q('酉'.repeat(11))];
 return {records,prefix,batch:[...prefix,...records.slice(0,7),records[21]]};
}

test('actual 22/11 sparse window retains 14 hidden rows and prepends only the three new older messages',async()=>{
 const {records,prefix,batch}=sparseDiagnosticFixture();expect(records).toHaveLength(22);expect(records.reduce((n,m)=>n+m.content.length,0)).toBe(5301);
 await startWindowScan(records);await scanWindow(batch);
 const waiting=await scanTick();expect(waiting.alignment.sparseCandidate).toBe(true);expect(waiting.count).toBe(22);
 const resumed=await scanTick(2100);expect(resumed.phase).toBe('running');expect(resumed.count).toBe(25);
 expect(resumed.alignment.method).toBe('sparse-window');expect(resumed.alignment.prepended).toBe(3);
 expect(resumed.alignment.retainedHiddenMessages).toBe(14);expect(resumed.alignment.matchedRecordIndexes).toEqual([0,1,2,3,4,5,6,21]);
 expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual([...prefix,...records]);
 // The same sparse window remains safe on every later poll without duplication or repeated waits.
 const repeat=await scanTick();expect(repeat.count).toBe(25);expect(repeat.alignment.method).toBe('sparse-window');expect(repeat.alignment.prepended).toBe(0);
 let result=repeat;for(let i=0;i<100&&result.phase==='running';i++)result=await scanTick();
 expect(result.phase).toBe('complete');expect(result.reason).toBe('boundaries-checked');expect(result.messages).toEqual([...prefix,...records]);
 expect(await page.evaluate(()=>window.sends)).toBe(0);
});

test('downward sparse reads confirm only already captured rows and never lose skipped messages',async()=>{
 const {records}=sparseDiagnosticFixture();await startWindowScan(records);
 await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.direction='down');
 await scanWindow([...records.slice(10,20),records[21]]);
 expect((await scanTick()).alignment.method).toBe('waiting');const read=await scanTick(2100);
 expect(read.alignment.method).toBe('sparse-window');expect(read.alignment.prepended).toBe(0);expect(read.count).toBe(22);
 expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual(records);
});

test('sparse recovery rejects unknown middle/tail content, reversed anchors and known rows falsely prepended',async()=>{
 const {records,prefix,batch}=sparseDiagnosticFixture();
 const candidates=[
  [...batch.slice(0,-1),{role:'user',content:'未经观察的新问题'},batch.at(-1)],
  [...batch.slice(0,-1),{role:'assistant',content:'不同的尾部回答'}],
  [...prefix,...records.slice(4,6),...records.slice(0,4),records[21]],
  [records[18],...prefix,...records.slice(0,7),records[21]],
  [...prefix,...records.slice(0,4),records[21]]
 ];
 for(const snapshot of candidates){
  await startWindowScan(records);await scanWindow(snapshot);const waiting=await scanTick();expect(waiting.phase).toBe('running');
  expect((await scanTick(12001)).phase).toBe('failed');
  expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual(records);
 }
});


test('27-row diagnostic window may start inside an older answer while retaining the known middle',async()=>{
 const sample=sparseDiagnosticFixture(),q=content=>({role:'user',content}),a=content=>({role:'assistant',content});
 const records=[a('早'.repeat(342)),q('[图片]'),...sample.prefix,...sample.records];
 expect(records).toHaveLength(27);expect(records.reduce((n,m)=>n+m.content.length,0)).toBe(5975);
 const prefix=[a('更'.repeat(386)),q('[图片]'),q('问'.repeat(11))];
 const batch=[...prefix,...records.slice(0,7),records[26]];
 await startWindowScan(records);await scanWindow(batch);
 expect((await scanTick()).alignment.sparseCandidate).toBe(true);
 const resumed=await scanTick(2100);expect(resumed.count).toBe(30);expect(resumed.alignment.method).toBe('sparse-window');
 expect(resumed.alignment.retainedHiddenMessages).toBe(19);
 expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual([...prefix,...records]);
 expect((await scanTick()).count).toBe(30);
 // The older question arrives later; no fabricated question is inserted before it does.
 await scanWindow([q('刚加载出的更早提问'),...prefix,...records]);
 expect((await scanTick()).count).toBe(31);
 expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records[0].content)).toBe('刚加载出的更早提问');
});

test('scroll commands that are snapped back stop as stalled and keep the failure position',async()=>{
 const records=Array.from({length:6},(_,i)=>scanPair('问题'+i,'回答'+i)).flat();
 await startWindowScan(records);
 await page.evaluate(()=>{const list=document.getElementById('rows');list.scrollTop=900;list.addEventListener('scroll',()=>{if(list.scrollTop!==900)list.scrollTop=900;});});
 let result;for(let i=0;i<40;i++){result=await scanTick();if(result.phase!=='running')break;}
 expect(result.phase).toBe('failed');expect(result.reason).toBe('scroll-stalled');expect(result.messages).toBeUndefined();
 expect(result.scroll.requestedTop).toBeLessThan(result.scroll.appliedTop);expect(result.scroll.observedTop).toBe(900);
 expect(result.scroll.noAdvanceMs).toBeGreaterThanOrEqual(30000);expect(result.scrolls).toBeLessThan(40);
 expect(await page.locator('#rows').evaluate(e=>e.scrollTop)).toBe(900);
 expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual(records);
});

test('continuous movement through tall already loaded answers does not trigger the no-progress limit',async()=>{
 await fixture();await page.evaluate(()=>{window.scanClock=Date.now();Date.now=()=>window.scanClock;});
 await scanWindow([...scanPair('长问题一','长回答一'),...scanPair('长问题二','长回答二')]);
 await page.locator('#rows').evaluate(list=>{for(const row of list.children)row.style.minHeight='3000px';list.scrollTop=list.scrollHeight;});
 let result=await page.evaluate(doubaoCommand,{command:'history-scan-start',requestId:'window-scan',url});
 const originalTop=result.scroll.observedTop;
 for(let i=0;i<40;i++){result=await scanTick();expect(result.phase).toBe('running');}
 expect(result.count).toBe(4);expect(result.scroll.movedReads).toBeGreaterThan(30);
 expect(result.scroll.observedTop).toBeLessThan(originalTop-2000);expect(result.scroll.noAdvanceMs).toBeLessThan(2000);
});

test('scanner selects the shared conversation region instead of a scrollable single-answer wrapper',async()=>{
 await fixture();await page.evaluate(()=>{
  window.scanClock=Date.now();Date.now=()=>window.scanClock;
  const list=document.getElementById('rows');list.style.cssText='height:120px;overflow:auto';
  const first=list.firstElementChild;const wrapper=document.createElement('div');wrapper.id='inner-answer';wrapper.style.cssText='height:100px;overflow:auto';first.before(wrapper);wrapper.append(first);first.style.height='400px';
  list.lastElementChild.style.minHeight='400px';list.scrollTop=list.scrollHeight;
 });
 const result=await page.evaluate(doubaoCommand,{command:'history-scan-start',requestId:'window-scan',url});
 expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.scroller.id)).toBe('rows');
 expect(result.scroll.messageRows).toBe(2);expect(await page.locator('#inner-answer').evaluate(e=>e.scrollTop)).toBe(0);
});


test('oscillating layout and offsets cannot reset the content progress deadline',async()=>{
 const records=Array.from({length:6},(_,i)=>scanPair('私密问题'+i,'私密回答'+i)).flat();
 await startWindowScan(records);
 let result;
 for(let i=0;i<40;i++){
  await page.locator('#rows').evaluate((list,i)=>{
   // Re-layout adds space before the same visible message. Both the absolute
   // position and scrollHeight change, but the reader remains at the same place.
   const padding=i%2?240:0;let spacer=list.querySelector('.spacer');
   if(!spacer){spacer=document.createElement('div');spacer.className='spacer';list.prepend(spacer);}
   spacer.style.height=padding+'px';list.scrollTop=900+padding;
  },i);
  result=await scanTick();if(result.phase!=='running')break;
 }
 expect(result.phase).toBe('failed');expect(result.reason).toBe('scroll-stalled');
 expect(result.scroll.noAdvanceMs).toBeGreaterThanOrEqual(30000);
 expect(result.scroll.movedReads).toBeGreaterThan(20);expect(result.scroll.trace).toHaveLength(12);
 expect(new Set(result.scroll.trace.map(p=>p.max)).size).toBe(2);
 expect(new Set(result.scroll.trace.map(p=>JSON.stringify(p.cursor))).size).toBe(1);
 expect(result.messages).toBeUndefined();expect(JSON.stringify(result.scroll)).not.toContain('私密');
 expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual(records);
 expect(await page.locator('#rows').evaluate(e=>e.style.overflowAnchor)).toBe('');
});

for(const delayed of [false,true])test('repeated short-step snapback seeks captured leading edge and loads older history once ('+(delayed?'between reads':'synchronous')+')',async()=>{
 const records=Array.from({length:6},(_,i)=>scanPair('原问题'+i,'原回答'+i)).flat();
 await startWindowScan(records);
 await page.locator('#rows').evaluate((list,delayed)=>{
  window.loadedOlder=false;list.scrollTop=900;
  list.addEventListener('scroll',()=>{
   if(window.loadedOlder)return;
   if(list.scrollTop>200&&list.scrollTop<900){if(!delayed)list.scrollTop=900;return;}
   if(list.scrollTop<=200){
    window.loadedOlder=true;
    for(const [role,text] of [['receive_message','更早回答'],['send_message','更早提问']]){
     const row=document.createElement('div');row.dataset.testid=role;row.style.minHeight='160px';
     const body=document.createElement('div');body.dataset.testid='message_text_content';body.textContent=text;row.append(body);list.prepend(row);
    }
   }
  });
 },delayed);
 let result;
 for(let i=0;i<20;i++){result=await scanTick();if(result.count===14)break;
  if(delayed)await page.locator('#rows').evaluate(list=>{if(!window.loadedOlder)list.scrollTop=900;});
 }
 expect(await page.evaluate(()=>window.loadedOlder)).toBe(true);
 expect(result.phase).toBe('running');expect(result.count).toBe(14);
 expect(result.scroll.recoveries).toBe(1);
 expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual([...scanPair('更早提问','更早回答'),...records]);
 expect(await page.evaluate(()=>window.sends)).toBe(0);
 const cancelled=await page.evaluate(doubaoCommand,{command:'history-scan-cancel',requestId:'window-scan'});
 expect(cancelled.phase).toBe('cancelled');expect(await page.locator('#rows').evaluate(e=>e.style.overflowAnchor)).toBe('');
});

test('content cursor permits steady traversal even while the layout height changes',async()=>{
 const records=[...scanPair('超长问题一','超长回答一'),...scanPair('超长问题二','超长回答二')];
 await fixture();await scanWindow(records);
 await page.evaluate(()=>{
  window.scanClock=Date.now();Date.now=()=>window.scanClock;
  const list=document.getElementById('rows');list.style.overflowAnchor='auto';
  for(const row of list.children)row.style.minHeight='12000px';list.scrollTop=22000;
 });
 await page.evaluate(doubaoCommand,{command:'history-scan-start',requestId:'window-scan',url});
 let result;
 for(let i=0;i<40;i++){
  await page.locator('#rows').evaluate((list,i)=>{
   list.lastElementChild.style.minHeight=(12000+(i%2)*200)+'px';list.scrollTop=21000-i*100;
  },i);
  result=await scanTick();expect(result.phase).toBe('running');
 }
 expect(result.scroll.noAdvanceMs).toBeLessThan(2000);
 expect(result.scroll.cursor.index).toBe(1);expect(result.count).toBe(4);
 await page.evaluate(doubaoCommand,{command:'history-scan-cancel',requestId:'window-scan'});
 expect(await page.locator('#rows').evaluate(e=>e.style.overflowAnchor)).toBe('auto');
});


test('traversing a tall image after a text cursor does not produce a false stall',async()=>{
 const records=[...scanPair('前面的问题','前面的回答'),{role:'user',content:'[图片]'},{role:'assistant',content:'后面的回答'}];
 await fixture();await scanWindow(records);await page.evaluate(()=>{
  window.scanClock=Date.now();Date.now=()=>window.scanClock;
  const list=document.getElementById('rows');list.children[2].style.minHeight='16000px';list.scrollTop=list.scrollHeight;
 });
 const first=await page.evaluate(doubaoCommand,{command:'history-scan-start',requestId:'window-scan',url});
 expect(first.scroll.cursor.index).toBe(3);
 let result;for(let i=0;i<40;i++){result=await scanTick();expect(result.phase).toBe('running');}
 expect(result.scroll.cursor).toBeNull();expect(result.scroll.noAdvanceMs).toBeLessThan(2000);
 expect(result.count).toBe(4);
});


test('periodic full-range jump after many good steps recovers on the first large return',async()=>{
 const records=Array.from({length:10},(_,i)=>scanPair('段落问题'+i,'段落回答'+i)).flat();
 await fixture();await scanWindow(records);
 await page.locator('#rows').evaluate(list=>{
  window.scanClock=Date.now();Date.now=()=>window.scanClock;
  list.style.height='753px';for(const row of list.children)row.style.minHeight='542.15px';list.scrollTop=list.scrollHeight;
 });
 let result=await page.evaluate(doubaoCommand,{command:'history-scan-start',requestId:'window-scan',url});
 for(let i=0;i<12;i++)result=await scanTick();
 expect(result.scroll.observedTop).toBeLessThan(6000);expect(result.scroll.recoveries).toBe(0);
 // The real trace jumps to 10090 once, then makes many normal 452px steps.
 await page.locator('#rows').evaluate(list=>list.scrollTop=list.scrollHeight);
 result=await scanTick();
 expect(result.scroll.reboundReads).toBe(1);expect(result.scroll.largeRebounds).toBe(1);
 expect(result.scroll.recoveries).toBe(1);expect(result.scroll.requestedTop).toBe(0);
 expect(result.count).toBe(20);
 expect(result.scroll.lastReturn.distance).toBeGreaterThan(5000);
 // The next load is joined by the existing strict history overlap checks.
 await scanWindow([...scanPair('刚刚加载出的更早提问','刚刚加载出的更早回答'),...records]);
 expect((await scanTick()).count).toBe(22);
});

test('directional wheel signal releases follow-bottom and triggers older loading at the top',async()=>{
 const records=Array.from({length:4},(_,i)=>scanPair('原提问'+i,'原回答'+i)).flat();
 await fixture();await scanWindow(records);
 await page.locator('#rows').evaluate(list=>{
  window.scanClock=Date.now();Date.now=()=>window.scanClock;window.wheelDirections=[];window.olderLoaded=false;
  window.manualUp=false;
  list.addEventListener('wheel',event=>{
   window.wheelDirections.push(Math.sign(event.deltaY));
   if(event.deltaY<0)window.manualUp=true;
   if(event.deltaY<0&&list.scrollTop<=2&&!window.olderLoaded){
    window.olderLoaded=true;
    for(const [role,text] of [['receive_message','轮询加载的旧回答'],['send_message','轮询加载的旧提问']]){
     const row=document.createElement('div');row.dataset.testid=role;row.style.minHeight='160px';
     const body=document.createElement('div');body.dataset.testid='message_text_content';body.textContent=text;row.append(body);list.prepend(row);
    }
   }
  });
  list.addEventListener('scroll',()=>{if(!window.manualUp)list.scrollTop=list.scrollHeight;});
 });
 let result=await page.evaluate(doubaoCommand,{command:'history-scan-start',requestId:'window-scan',url});
 for(let i=0;i<35&&result.count===8;i++)result=await scanTick();
 expect(await page.evaluate(()=>window.olderLoaded)).toBe(true);expect(result.count).toBe(10);
 expect(result.scroll.wheelSignals).toBeGreaterThan(0);
 expect(await page.evaluate(()=>window.wheelDirections.every(n=>n===-1))).toBe(true);
 expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual([...scanPair('轮询加载的旧提问','轮询加载的旧回答'),...records]);
 expect(await page.evaluate(()=>window.sends)).toBe(0);
});

test('virtual list scroller is preferred and a page wheel handler is not scrolled twice',async()=>{
 const records=Array.from({length:4},(_,i)=>scanPair('测试问题'+i,'测试回答'+i)).flat();
 await fixture();await scanWindow(records);
 await page.locator('#rows').evaluate(list=>{
  window.scanClock=Date.now();Date.now=()=>window.scanClock;list.className='v_list_scroller_test';
  const wrapper=document.createElement('div');wrapper.id='nested-messages';wrapper.style.cssText='height:400px;overflow:auto';
  while(list.firstChild)wrapper.append(list.firstChild);list.append(wrapper);list.scrollTop=250;
  window.receivedWheel=0;list.addEventListener('wheel',event=>{event.preventDefault();window.receivedWheel++;list.scrollTop=140;});
 });
 const result=await page.evaluate(doubaoCommand,{command:'history-scan-start',requestId:'window-scan',url});
 expect(result.scroll.container).toBe('doubao-virtual-list');
 expect(result.scroll.wheelPrevented).toBe(1);expect(result.scroll.appliedTop).toBe(140);
 expect(await page.locator('#nested-messages').evaluate(e=>e.scrollTop)).toBe(0);
});

test('periodic returns cannot renew the one-shot recovery indefinitely',async()=>{
 await startWindowScan(Array.from({length:10},(_,i)=>scanPair('问题'+i,'回答'+i)).flat());
 let result;
 for(let i=0;i<60;i++){
  // Start each round at the bottom, allow several good steps, then jump again.
  if(i%5===0)await page.locator('#rows').evaluate(list=>list.scrollTop=list.scrollHeight);
  result=await scanTick();if(result.phase==='failed')break;
 }
 expect(result.phase).toBe('failed');expect(result.reason).toBe('scroll-stalled');
 expect(result.scroll.recoveries).toBe(1);expect(result.scroll.largeRebounds).toBeGreaterThan(1);
 expect(result.messages).toBeUndefined();
});

test('route change during the wheel signal does not scroll the new conversation',async()=>{
 await fixture();await scanWindow([...scanPair('问题甲','回答甲'),...scanPair('问题乙','回答乙')]);
 await page.locator('#rows').evaluate(list=>{
  window.scanClock=Date.now();Date.now=()=>window.scanClock;window.beforeRouteScroll=list.scrollTop;
  list.addEventListener('wheel',()=>history.pushState({},'', '/chat/other'),{once:true});
 });
 await page.evaluate(doubaoCommand,{command:'history-scan-start',requestId:'window-scan',url});
 expect(await page.locator('#rows').evaluate(e=>e.scrollTop)).toBe(await page.evaluate(()=>window.beforeRouteScroll));
 const result=await scanTick();expect(result.phase).toBe('failed');expect(result.reason).toBe('navigation');
 expect(result.messages).toBeUndefined();expect(await page.evaluate(()=>window.sends)).toBe(0);
});


function answerOnlyPrefixFixture(){
 const sample=sparseDiagnosticFixture(),records=sample.records.slice(9);
 return {records,olderAnswer:sample.records[8],olderQuestion:sample.records[7],
  batch:[sample.records[8],...records.slice(0,9),records[12]]};
}

test('actual 13/11 diagnostic accepts one older answer with three verified following turns',async()=>{
 const {records,olderAnswer,olderQuestion,batch}=answerOnlyPrefixFixture();
 expect(records).toHaveLength(13);expect(records.reduce((sum,m)=>sum+m.content.length,0)).toBe(2798);
 expect(olderAnswer.content).toHaveLength(896);expect(batch).toHaveLength(11);
 await startWindowScan(records);await scanWindow(batch);
 const waiting=await scanTick();expect(waiting.phase).toBe('running');expect(waiting.count).toBe(13);
 expect(waiting.alignment.uniqueQuestionMatches).toEqual([{batchIndex:2,recordIndex:1},{batchIndex:5,recordIndex:4},{batchIndex:8,recordIndex:7}]);
 const resumed=await scanTick(2100);expect(resumed.phase).toBe('running');expect(resumed.count).toBe(14);
 expect(resumed.alignment.prepended).toBe(1);expect(resumed.alignment.anchors).toBe(3);
 expect(resumed.alignment.retainedHiddenMessages).toBe(3);
 expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual([olderAnswer,...records]);
 expect((await scanTick()).count).toBe(14);
 // The corresponding question can load on a later scroll; it is never invented.
 await scanWindow([olderQuestion,...batch]);
 await scanTick();const next=await scanTick(2100);expect(next.count).toBe(15);
 expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual([olderQuestion,olderAnswer,...records]);
 const done=await scanTick(900001);expect(done.phase).toBe('complete');
 expect(done.messages).toEqual([olderQuestion,olderAnswer,...records]);expect(await page.evaluate(()=>window.sends)).toBe(0);
});


test('answer-only prefixes retain image rows and multiple observed answer fragments without inventing questions',async()=>{
 const {records,olderAnswer}=answerOnlyPrefixFixture();
 const variants=[
  [olderAnswer,{role:'user',content:'[图片]'}],
  [{role:'assistant',content:'更早的另一个已显示回答'},olderAnswer]
 ];
 for(const prefix of variants){
  await startWindowScan(records);await scanWindow([...prefix,...records.slice(0,9),records[12]]);
  await scanTick();const result=await scanTick(2100);
  expect(result.phase).toBe('running');expect(result.count).toBe(13+prefix.length);
  expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual([...prefix,...records]);
  expect((await scanTick()).count).toBe(13+prefix.length);
 }
});

test('answer-only sparse recovery still rejects image-only novelty, known answers and insufficient or conflicting anchors',async()=>{
 const {records,olderAnswer,batch}=answerOnlyPrefixFixture();
 const candidates=[
  [{role:'user',content:'[图片]'},...batch.slice(1)],
  [records[5],...batch.slice(1)],
  [olderAnswer,...records.slice(0,3),records[12]],
  [olderAnswer,...records.slice(3,6),...records.slice(0,3),records[12]],
  [...batch.slice(0,-1),{role:'assistant',content:'未核实的尾部回答'}],
  [olderAnswer,...records.slice(0,6),{role:'assistant',content:'未经观察的中间回答'},...records.slice(6,9),records[12]]
 ];
 for(const snapshot of candidates){
  await startWindowScan(records);await scanWindow(snapshot);await scanTick();
  const result=await scanTick(12503);expect(result.phase).toBe('failed');expect(result.reason).toBe('ambiguous');
  expect(result.messages).toBeUndefined();
  expect(await page.evaluate(()=>window.__awbDoubaoHistoryScanV1.records)).toEqual(records);
 }
});


test('history image extraction backfills seven placeholders, renders previews and survives restart',async()=>{
 await fixture();
 await page.evaluate(()=>{
  const c=document.createElement('canvas');c.width=40;c.height=30;const ctx=c.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,40,30);
  const src=c.toDataURL('image/png');
  document.querySelector('[data-testid="message_text_content"]').innerHTML=Array.from({length:7},()=>'<p><img src="'+src+'"></p>').join('')+'请看这些图片<button><img src="'+src+'">复制</button>';
 });
 await page.waitForFunction(()=>[...document.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth));
 const capture=await page.evaluate(doubaoCommand,{command:'history',url});
 expect(capture.messages[0].historyImages).toHaveLength(7);
 expect(capture.messages[0].historyImages.every(image=>image.src.startsWith('data:image/jpeg;base64,'))).toBe(true);
 expect(capture.messages[0].historyImages.map(image=>image.index)).toEqual([0,1,2,3,4,5,6]);
 expect(JSON.stringify((await page.evaluate(doubaoCommand,{command:'probe'})).diagnostics)).not.toContain('base64');
 const info=await desktop.evaluate(()=>window.workbench.call('browserBridgeInfo')),pair=JSON.parse(info.pairing);
 const clientId='12345678-1234-1234-1234-123456789abc';let auth={clientId,provider:'doubao',url};
 const request=async(path,body={})=>{const r=await fetch(pair.url+'/web-chat/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pair.token},body:JSON.stringify({...auth,...body})});return r.json();};
 auth={...auth,...await request('bind',{ready:true,historyEnabled:true})};
 let task=(await request('poll',{ready:true})).historyRequest;
 const first=await request('history',{requestId:task.id,messages:capture.messages.map(({role,content})=>({role,content}))});expect(first.accepted).toBe(true);
 const before=await desktop.evaluate(()=>window.workbench.call('snapshot'));
 await desktop.evaluate(bindingId=>window.workbench.call('webChatHistory',{provider:'doubao',bindingId}),auth.bindingId);task=(await request('poll',{ready:true})).historyRequest;
 const saved=await request('history',{requestId:task.id,messages:capture.messages});expect(saved.accepted).toBe(true);expect(saved.added).toBe(0);expect(saved.imagePreviews).toBe(7);
 const after=await desktop.evaluate(()=>window.workbench.call('snapshot'));expect(after.conversations[0].messages.map(m=>m.id)).toEqual(before.conversations[0].messages.map(m=>m.id));
 await desktop.getByRole('button',{name:'网页账号',exact:true}).click();await desktop.getByRole('button',{name:'进入豆包网页聊天'}).click();
 await expect(desktop.locator('.yuanbao-bubble .image-preview')).toHaveCount(7);
 const thumbs=desktop.locator('.yuanbao-bubble .image-preview');await thumbs.nth(2).click();
 const viewer=desktop.getByRole('dialog',{name:'图片预览'}),counter=viewer.getByRole('status');
 await expect(viewer).toBeVisible();await expect(counter).toHaveText('3 / 7');
 await viewer.getByRole('button',{name:'下一张图片'}).click();await expect(counter).toHaveText('4 / 7');
 await desktop.keyboard.press('ArrowLeft');await expect(counter).toHaveText('3 / 7');
 await desktop.keyboard.press('Home');await desktop.keyboard.press('ArrowLeft');await expect(counter).toHaveText('1 / 7');
 await expect(viewer.getByRole('button',{name:'上一张图片'})).toHaveAttribute('aria-disabled','true');
 await desktop.keyboard.press('End');await desktop.keyboard.press('ArrowRight');await expect(counter).toHaveText('7 / 7');
 await expect(viewer.getByRole('button',{name:'下一张图片'})).toHaveAttribute('aria-disabled','true');
 await desktop.keyboard.press('Home');
 const box=await viewer.locator('.image-stage').boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;
 await desktop.mouse.move(x,y);await desktop.mouse.down();await desktop.mouse.move(x-90,y+5,{steps:5});await desktop.mouse.up();await expect(counter).toHaveText('2 / 7');
 await desktop.mouse.move(x,y);await desktop.mouse.down();await desktop.mouse.move(x+90,y+5,{steps:5});await desktop.mouse.up();await expect(counter).toHaveText('1 / 7');
 await viewer.getByLabel('关闭图片预览').focus();await desktop.keyboard.press('Shift+Tab');await expect(viewer.getByLabel('下一张图片')).toBeFocused();await desktop.keyboard.press('Tab');await expect(viewer.getByLabel('关闭图片预览')).toBeFocused();
 await desktop.screenshot({path:join(root,'artifacts','image-gallery-navigation.png')});
 await desktop.keyboard.press('Escape');await expect(viewer).toHaveCount(0);await expect(thumbs.nth(2)).toBeFocused();
 // The same gallery is used for locally attached pictures; selecting them never sends.
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=','base64');
 await desktop.getByLabel('选择聊天图片').setInputFiles([{name:'one.png',mimeType:'image/png',buffer:png},{name:'two.png',mimeType:'image/png',buffer:png}]);
 const draftThumbs=desktop.locator('.yuanbao-compose .image-preview');await expect(draftThumbs).toHaveCount(2);await draftThumbs.first().click();await expect(counter).toHaveText('1 / 2');await desktop.keyboard.press('ArrowRight');await expect(counter).toHaveText('2 / 2');await desktop.keyboard.press('Escape');
 await expect(draftThumbs).toHaveCount(2);expect(await page.evaluate(()=>window.sends)).toBe(0);
 await app.close();app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});desktop=await app.firstWindow();await desktop.waitForFunction(()=>!!window.workbench);
 const reopened=await desktop.evaluate(()=>window.workbench.call('snapshot'));expect(reopened.conversations[0].messages[0].historyImages).toHaveLength(7);
});

test('cross-origin history pictures retain HTTPS fallback without exposing URLs in diagnostics',async()=>{
 await fixture();
 await page.route('https://images.example.com/**',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=','base64')}));
 await page.evaluate(()=>document.querySelector('[data-testid="message_text_content"]').innerHTML='<img src="https://images.example.com/private.png?signature=test">说明');
 await page.waitForFunction(()=>document.querySelector('img').complete);
 const capture=await page.evaluate(doubaoCommand,{command:'history',url});expect(capture.messages[0].historyImages[0].src).toBe('https://images.example.com/private.png?signature=test');
 expect(JSON.stringify((await page.evaluate(doubaoCommand,{command:'probe'})).diagnostics)).not.toContain('signature');
 // Desktop uses the original signed URL without a Referer; failure stays readable.
 let imageRequests=0;
 await desktop.route('https://images.example.com/**',async r=>{imageRequests++;expect(r.request().headers().referer).toBeUndefined();await r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=','base64')});});
 const pair=JSON.parse((await desktop.evaluate(()=>window.workbench.call('browserBridgeInfo'))).pairing);
 const auth={clientId:'12345678-1234-1234-1234-123456789abc',provider:'doubao',url};
 const request=async(path,body={})=>(await fetch(pair.url+'/web-chat/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pair.token},body:JSON.stringify({...auth,...body})})).json();
 Object.assign(auth,await request('bind',{ready:true,historyEnabled:true}));const task=(await request('poll',{ready:true})).historyRequest;
 expect((await request('history',{requestId:task.id,messages:capture.messages})).accepted).toBe(true);
 await desktop.getByRole('button',{name:'网页账号',exact:true}).click();await desktop.getByRole('button',{name:'进入豆包网页聊天'}).click();
 await expect(desktop.locator('.yuanbao-bubble .image-preview img')).toBeVisible();await expect.poll(()=>desktop.locator('.yuanbao-bubble .image-preview img').evaluate(i=>i.naturalWidth)).toBeGreaterThan(0);expect(imageRequests).toBeGreaterThan(0);
 await desktop.locator('.image-preview').first().click();await expect(desktop.getByRole('dialog',{name:'图片预览'})).toBeVisible();await desktop.getByLabel('关闭图片预览').click();
 await desktop.screenshot({path:join(root,'artifacts','doubao-history-images.png')});
 await desktop.locator('.image-preview img').evaluate(i=>i.dispatchEvent(new Event('error',{bubbles:true})));
 await expect(desktop.getByText('图片暂时无法加载，请在原网页打开后重新同步。')).toBeVisible();

});
