import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {standardChatCommand} from '../browser-extension/standard-chat-adapter.js';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
for(const provider of ['chatgpt','gemini']){
 const name=provider==='chatgpt'?'ChatGPT':'Gemini',origin=provider==='chatgpt'?'https://chatgpt.com':'https://gemini.google.com',path=provider==='chatgpt'?'/c/test-chat':'/app/test-chat',url=origin+path;
 let app,desktop,page,dir;
 const command=args=>page.evaluate(standardChatCommand,{provider,...args});
 const user=text=>provider==='chatgpt'?'<div data-message-author-role="user"><div class="whitespace-pre-wrap">'+text+'</div></div>':'<user-query><div class="query-text-line">'+text+'</div></user-query>';
 const answer=text=>provider==='chatgpt'?'<div data-message-author-role="assistant"><div class="markdown">'+text+'</div></div>':'<model-response><message-content>'+text+'</message-content></model-response>';
 async function finish(){await page.evaluate(()=>{document.querySelector('[aria-label="Stop generating"]')?.remove();const n=document.getElementById('new-answer');n.dataset.isStreaming='false';n.insertAdjacentHTML('beforeend','<button aria-label="Copy response">PRIVATE_TOOL_LABEL</button>');});}
 test.beforeEach(async()=>{
  dir=mkdtempSync(join(tmpdir(),'awb-'+provider+'-'));app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});desktop=await app.firstWindow();await desktop.waitForFunction(()=>!!window.workbench);
  const created=app.waitForEvent('window');await app.evaluate(async({BrowserWindow})=>{await new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadURL('about:blank');});page=await created;
  const editor=provider==='chatgpt'?'<div id="prompt-textarea" contenteditable="true" role="textbox"></div>':'<rich-textarea><div class="ql-editor" contenteditable="true" role="textbox"><p><br></p></div></rich-textarea>';
  await page.route(origin+'/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<style>user-query,model-response,message-content,rich-textarea{display:block}[contenteditable]{min-height:35px}</style><aside><textarea>SIDEBAR_DRAFT</textarea><button aria-label="Send">SIDEBAR_SEND</button></aside><main><div id="messages">'+user('旧问题')+answer('旧回答')+'</div><form>'+editor+'<button type="button" '+(provider==='chatgpt'?'data-testid="send-button"':'class="send-button"')+' aria-label="Send message" disabled>发送</button></form></main>'}));await page.goto(url);
  await page.evaluate(provider=>{window.sends=0;window.provider=provider;const e=document.querySelector('[contenteditable]'),send=document.querySelector('form button');e.oninput=()=>{send.hidden=false;send.disabled=!e.innerText.trim();};send.onclick=()=>{window.sends++;window.sent=e.innerText;e.innerHTML='<p><br></p>';send.disabled=true;const g=provider==='gemini',messages=document.getElementById('messages');const q=document.createElement(g?'user-query':'div');q.id='new-user';q.dataset.messageId='question-'+window.sends;if(!g)q.dataset.messageAuthorRole='user';q.textContent=window.sent;const a=document.createElement(g?'model-response':'div');a.id='new-answer';if(!g)a.dataset.messageAuthorRole='assistant';a.dataset.isStreaming='true';a.innerHTML=g?'<message-content>新的回答</message-content>':'<div class="markdown">新的回答</div>';messages.append(q,a);document.querySelector('form').insertAdjacentHTML('beforeend','<button type="button" aria-label="Stop generating">停止</button>');};},provider);
 });
 test.afterEach(async()=>{if(app)await app.close();if(dir)rmSync(dir,{recursive:true,force:true});});
 test(name+' sends once, streams only its new answer, reanchors DOM IDs and completes',async()=>{
  expect((await command({command:'probe'})).ready).toBe(true);expect((await command({command:'history',url})).messages.map(m=>m.content)).toEqual(['旧问题','旧回答']);
  const job={id:'once',text:'新问题',url};expect((await command({command:'begin',job})).phase).toBe('waiting');await command({command:'begin',job});expect(await page.evaluate(()=>window.sends)).toBe(1);
  expect((await command({command:'tick',jobId:job.id,url})).content).toBe('新的回答');
  await page.evaluate(()=>{const q=document.getElementById('new-user');q.replaceWith(q.cloneNode(true));});expect((await command({command:'tick',jobId:job.id,url})).phase).toBe('streaming');
  await finish();await page.waitForTimeout(2600);expect((await command({command:'tick',jobId:job.id,url})).phase).toBe('complete');
  const diag=(await command({command:'probe'})).diagnostics;expect(diag.lastSendAttempt.clicked).toBe(true);expect(JSON.stringify(diag)).not.toContain(job.text);expect(JSON.stringify(diag)).not.toContain('PRIVATE_TOOL_LABEL');
 });
 test(name+' preserves drafts and refuses absent, ambiguous send controls or extra editors',async()=>{
  await page.locator('[contenteditable]').fill('用户草稿');expect((await command({command:'begin',job:{id:'draft',text:'禁止覆盖',url}})).phase).toBe('failed');expect(await page.locator('[contenteditable]').innerText()).toBe('用户草稿');
  await page.locator('[contenteditable]').fill('');await page.evaluate(()=>document.querySelector('form').insertAdjacentHTML('beforeend','<button type="button" aria-label="Send">另一个</button>'));expect((await command({command:'probe'})).ready).toBe(false);expect(await page.evaluate(()=>window.sends)).toBe(0);
  await page.evaluate(()=>[...document.querySelectorAll('form button')].forEach(n=>n.remove()));expect((await command({command:'probe'})).ready).toBe(true);
  expect((await command({command:'begin',job:{id:'missing',text:'保留问题',url}})).phase).toBe('failed');expect(await page.locator('[contenteditable]').innerText()).toBe('保留问题');await command({command:'begin',job:{id:'missing',text:'保留问题',url}});expect(await page.evaluate(()=>window.sends)).toBe(0);
  await page.evaluate(()=>document.querySelector('form').insertAdjacentHTML('beforeend','<textarea>隐藏风险</textarea>'));expect((await command({command:'probe'})).diagnostics.editorCandidates).toBe(2);
  await page.evaluate(()=>{document.querySelector('form textarea').remove();document.body.insertAdjacentHTML('beforeend','<main><textarea>另一聊天区域</textarea><button aria-label="Send">发送</button></main>');});expect((await command({command:'probe'})).ready).toBe(false);expect(await page.evaluate(()=>window.sends)).toBe(0);
 });
 test(name+' duplicate prompts do not consume old replies; another question or navigation stops receipt',async()=>{
  const job={id:'duplicate',text:'旧问题',url};await command({command:'begin',job});const event=await command({command:'tick',jobId:job.id,url});expect(event.content).toBe('新的回答');expect(event.content).not.toBe('旧回答');
  await page.evaluate(provider=>{const q=document.createElement(provider==='gemini'?'user-query':'div');if(provider==='chatgpt')q.dataset.messageAuthorRole='user';q.textContent='另一个问题';document.getElementById('messages').append(q);},provider);expect((await command({command:'tick',jobId:job.id,url})).phase).toBe('failed');
  await command({command:'release'});await finish();await command({command:'begin',job:{id:'navigate',text:'下一轮',url}});await page.evaluate(path=>history.pushState({},'',path.replace('test-chat','other-chat')),path);expect((await command({command:'tick',jobId:'navigate',url})).phase).toBe('failed');
 });
 test(name+' new chat promotes its URL once and a page reload never resends',async()=>{
  const start=origin+(provider==='chatgpt'?'/':'/app');await page.evaluate(start=>history.pushState({},'',start),start);await page.evaluate(()=>document.getElementById('messages').replaceChildren());
  const job={id:'new',text:'第一条',url:start};await command({command:'begin',job});await page.evaluate(path=>history.pushState({},'',path),path);
  const event=await command({command:'tick',jobId:job.id,url:start});expect(event.url).toBe(url);expect(event.content).toBe('新的回答');
  await page.reload();expect((await command({command:'tick',jobId:job.id,url})).phase).toBe('failed');expect(await page.evaluate(()=>window.sends||0)).toBe(0);
 });
 test(name+' composer outside nested message root remains in the same chat scope',async()=>{
  await page.evaluate(provider=>{const messages=document.getElementById('messages'),nested=document.createElement(provider==='gemini'?'chat-window':'section');if(provider==='chatgpt')nested.setAttribute('role','main');messages.replaceWith(nested);nested.append(messages);},provider);
  const p=await command({command:'probe'});expect(p.ready).toBe(true);expect(p.diagnostics.rows).toBe(2);
  expect((await command({command:'begin',job:{id:'nested',text:'输入区在外层',url}})).phase).toBe('waiting');expect((await command({command:'tick',jobId:'nested',url})).content).toBe('新的回答');expect(await page.evaluate(()=>window.sends)).toBe(1);
 });
 test(name+' history excludes thought/tool content and preserves Markdown, links and code',async()=>{
  await page.evaluate(provider=>{const n=document.querySelector(provider==='gemini'?'message-content':'.markdown');n.innerHTML='<model-thoughts>PRIVATE_REASONING</model-thoughts><h2>标题</h2><p><strong>重点</strong> <a href="https://example.org/doc">来源</a></p><pre><code class="language-js">const a = 1;</code></pre><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><button>PRIVATE_TOOL</button>';},provider);
  const h=await command({command:'history',url});expect(h.messages[1].content).toContain('## 标题');expect(h.messages[1].content).toContain('**重点**');expect(h.messages[1].content).toContain('[来源](https://example.org/doc)');expect(h.messages[1].content).toContain('~~~js');expect(h.messages[1].content).toContain('| --- | --- |');expect(JSON.stringify(h)).not.toContain('PRIVATE_');
  await page.evaluate(()=>document.querySelector('main').insertAdjacentHTML('beforeend','<div role="dialog"><textarea>弹窗</textarea></div>'));expect((await command({command:'probe'})).ready).toBe(false);
 });
 test(name+' recognizes a late appearing arrow and accepts textarea composition',async()=>{
  await page.evaluate(()=>{const current=document.querySelector('[contenteditable]'),value=document.createElement('textarea');current.replaceWith(value);const button=document.querySelector('form button');button.hidden=true;value.oninput=()=>{button.hidden=false;button.disabled=!value.value.trim();};button.onclick=()=>{window.sends++;window.sent=value.value;value.value='';button.disabled=true;};});
  const p=await command({command:'probe'});expect(p.ready).toBe(true);expect(p.diagnostics.sendButtonPending).toBe(true);
  expect((await command({command:'begin',job:{id:'textarea',text:'多行\n文字',url}})).phase).toBe('waiting');expect(await page.evaluate(()=>window.sent)).toBe('多行\n文字');expect(await page.evaluate(()=>window.sends)).toBe(1);
 });
 test(name+' does not mistake a pause for completion; fast final copy controls outside message body work',async()=>{
  const job={id:'completion',text:'需要完成证据',url};await command({command:'begin',job});
  await page.evaluate(()=>{document.querySelector('[aria-label="Stop generating"]').remove();document.getElementById('new-answer').removeAttribute('data-is-streaming');window['__awbStandardChatV1_'+window.provider].sawGenerating=false;});
  expect((await command({command:'tick',jobId:job.id,url})).phase).toBe('streaming');await page.waitForTimeout(2600);expect((await command({command:'tick',jobId:job.id,url})).phase).toBe('streaming');
  await page.evaluate(()=>{const answer=document.getElementById('new-answer'),article=document.createElement('article');answer.replaceWith(article);article.append(answer);article.insertAdjacentHTML('beforeend','<button aria-label="Copy response">copy</button>');});expect((await command({command:'tick',jobId:job.id,url})).phase).toBe('complete');
 });
 test(name+' relay through real desktop bridge persists history, question, reply and restart',async()=>{
  const pair=JSON.parse((await desktop.evaluate(()=>window.workbench.call('browserBridgeInfo'))).pairing);const created=app.waitForEvent('window');await app.evaluate(async({BrowserWindow})=>{await new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadURL('about:blank');});const relay=await created;
  await relay.exposeFunction('executeForTest',async(name,arg)=>{if(name!=='standardChatCommand')throw Error('Unexpected function '+name);return [{result:await page.evaluate(standardChatCommand,arg)}];});
  await relay.addInitScript(pair=>{window.chrome={storage:{local:{get:async()=>({pairing:pair})}},scripting:{executeScript:({func,args})=>window.executeForTest(func.name,args?.[0])}};},pair);
  await relay.route('https://relay.fixture/**',r=>{const name=new URL(r.request().url()).pathname.slice(1);if(!/^[a-z-]+\.(js|html|css)$/.test(name))return r.abort();return r.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:readFileSync(join(root,'browser-extension',name))});});
  await relay.route(pair.url+'/**',async r=>{if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});const res=await fetch(r.request().url(),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pair.token},body:r.request().postData()});return r.fulfill({status:res.status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:await res.text()});});
  await relay.goto('https://relay.fixture/'+provider+'.html?tabId=3');await expect.poll(async()=>(await desktop.evaluate(provider=>window.workbench.call('webChatStatus',{provider}),provider)).history?.phase).toBe('complete');
  await desktop.getByRole('button',{name:'网页账号',exact:true}).click();await desktop.getByRole('button',{name:'进入 '+name+' 网页聊天',exact:true}).click();await expect(desktop.locator('.yuanbao-message.user')).toContainText('旧问题');await expect(desktop.getByRole('button',{name:'自动加载并同步历史'})).toHaveCount(0);await expect(desktop.getByRole('button',{name:'添加图片'})).toHaveCount(0);
  await desktop.getByLabel('发给'+name+'的问题').fill('新问题');await desktop.getByRole('button',{name:'发送给'+name,exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.sends)).toBe(1);await finish();
  await expect.poll(async()=>(await desktop.evaluate(()=>window.workbench.call('snapshot'))).conversations[0].messages.at(-1).status,{timeout:15000}).toBe('complete');await expect(desktop.locator('.yuanbao-message.assistant').last()).toContainText('新的回答');await expect(desktop.locator('.yuanbao-message.user .yuanbao-bubble').last()).toHaveText('新问题');await expect(desktop.getByRole('button',{name:'停止接收',exact:true})).toHaveCount(0);await desktop.screenshot({path:join(root,'test-results',provider+'-chat.png')});
  await app.close();app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});desktop=await app.firstWindow();await desktop.waitForFunction(()=>!!window.workbench);const c=(await desktop.evaluate(()=>window.workbench.call('snapshot'))).conversations[0];expect(c.webChat.provider).toBe(name);expect(c.messages).toHaveLength(4);expect(c.messages.at(-1).content).toBe('新的回答');
  expect((await desktop.evaluate(provider=>window.workbench.call('webChatStatus',{provider}),provider)).online).toBe(false);
 });
}
