
import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareWebImages} from '../browser-extension/image-upload.js';
import {yuanbaoCommand} from '../browser-extension/yuanbao-adapter.js';
import {doubaoCommand} from '../browser-extension/doubao-adapter.js';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD9sAAAAASUVORK5CYII=";
let app,desktop,page,dir;
test.beforeEach(async()=>{
 dir=mkdtempSync(join(tmpdir(),'awb-images-'));
 app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});
 desktop=await app.firstWindow();await desktop.waitForFunction(()=>!!window.workbench);
 const created=app.waitForEvent('window');
 await app.evaluate(async({BrowserWindow})=>{await new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadURL('about:blank');});page=await created;
 await page.route('https://**/*',r=>r.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
});
test.afterEach(async()=>{if(app)await app.close();rmSync(dir,{recursive:true,force:true});});
for(const provider of ['yuanbao','doubao'])test(provider+' uploads image previews before sending once and refuses missing tickets',async()=>{
 const url=provider==='yuanbao'?'https://yuanbao.tencent.com/chat/images':'https://www.doubao.com/chat/images';
 const reader=provider==='yuanbao'?yuanbaoCommand:doubaoCommand;
 await page.goto(url);
 await page.setContent(provider==='yuanbao'?'<main><section><div class="chat-input-editor"><textarea></textarea></div><input type="file" accept="image/*" multiple><div data-input-resource-area></div><button id="yuanbao-send-btn" disabled>发送</button></section></main>':'<main><section data-testid="chat_input"><textarea data-testid="chat_input_input"></textarea><input type="file" accept="image/*" multiple><div data-testid="chat_input_attachment"></div><button data-testid="chat_input_send_button" disabled>发送</button></section></main>');
 // Keep an empty attachment placeholder hidden until a file arrives.
 await page.evaluate(png=>{
  window.sends=0;window.uploads=0;
  const editor=document.querySelector('textarea'),button=document.querySelector('button'),area=document.querySelector('section>div:last-of-type');
  area.hidden=true;
  editor.addEventListener('input',()=>button.disabled=!editor.value);
  button.onclick=()=>window.sends++;
  document.querySelector('input').onchange=e=>{
   window.uploads++;area.hidden=false;area.setAttribute('aria-busy','true');
   const img=document.createElement('img');img.src=png;img.style.cssText='width:30px;height:30px';area.append(img);
   setTimeout(()=>area.removeAttribute('aria-busy'),300);
  };
 },png);
 const job={id:'image-job',url,text:'请解释图片',images:[{name:'截图.png',dataUrl:png}]};
 expect((await page.evaluate(reader,{command:'begin',job})).phase).toBe('failed');
 expect(await page.evaluate(()=>window.sends)).toBe(0);
 const prepared=await page.evaluate(prepareWebImages,{provider,job});expect(prepared,JSON.stringify(prepared)).toEqual({ok:true});
 expect((await page.evaluate(reader,{command:'begin',job})).phase).toBe('waiting');
 await page.evaluate(reader,{command:'begin',job});await page.evaluate(prepareWebImages,{provider,job});
 expect(await page.evaluate(()=>window.sends)).toBe(1);expect(await page.evaluate(()=>window.uploads)).toBe(1);
});

test('clipboard image previews, removal, saved attachments, native selected copy and copy buttons',async()=>{
 await page.close();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].focus());
 const info=await desktop.evaluate(()=>window.workbench.call('browserBridgeInfo')),pair=JSON.parse(info.pairing);
 const request=async(path,body)=>{const r=await fetch(pair.url+'/web-chat/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pair.token},body:JSON.stringify(body)});return r.json();};
 const clientId='12345678-1234-1234-1234-123456789abc',url='https://yuanbao.tencent.com/chat/images';
 const bound=await request('bind',{clientId,url,ready:true,imageEnabled:true});
 await desktop.getByRole('button',{name:'网页账号',exact:true}).click();await desktop.getByRole('button',{name:'进入元宝网页聊天'}).click();
 const editor=desktop.getByLabel('发给元宝的问题');
 const clipboardPng=await desktop.evaluate(()=>{const c=document.createElement('canvas');c.width=16;c.height=16;const x=c.getContext('2d');x.fillStyle='#4567ef';x.fillRect(0,0,16,16);return c.toDataURL('image/png');});
 await app.evaluate(({clipboard,ClipboardItem},png)=>clipboard.write([new ClipboardItem({'image/png':new Blob([Buffer.from(png.split(',')[1],'base64')],{type:'image/png'})})]),clipboardPng);
 await desktop.bringToFront();await editor.focus();await editor.press('Control+v');
 await expect(desktop.locator('.yuanbao-compose .chat-image')).toHaveCount(1);
 await desktop.getByLabel('移除图片 1').click();await expect(desktop.locator('.yuanbao-compose .chat-image')).toHaveCount(0);
 await desktop.getByLabel('选择聊天图片').setInputFiles({name:'图片.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});
 await editor.fill('这张图片的文字是什么？');
 await desktop.getByRole('button',{name:'发送给元宝',exact:true}).click();
 const {job}=await request('poll',{clientId,...bound,url,ready:true});expect(job.images).toHaveLength(1);
 await request('report',{clientId,...bound,jobId:job.id,lease:job.lease,sequence:1,url,phase:'complete',content:'可以选中复制的回答。'});
 await expect(desktop.locator('.yuanbao-message.user .chat-image img')).toBeVisible();
 const answer=desktop.locator('.yuanbao-message.assistant');
 await answer.getByRole('button',{name:'复制消息'}).click();
 expect(await app.evaluate(({clipboard})=>clipboard.readText())).toBe('可以选中复制的回答。');
 await app.evaluate(({clipboard})=>clipboard.writeText('before-native-copy'));
 await answer.locator('p').first().evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range);});
 await desktop.keyboard.press('Control+c');
 expect(await app.evaluate(({clipboard})=>clipboard.readText())).toBe('可以选中复制的回答。');
 await app.evaluate(({Menu})=>{Menu.prototype.popup=function(){globalThis.testContextMenu=this.items.map(i=>i.label);};});
 await answer.locator('p').first().click({button:'right'});
 expect(await app.evaluate(()=>globalThis.testContextMenu)).toContain('复制');
 await editor.click({button:'right'});
 expect(await app.evaluate(()=>globalThis.testContextMenu)).toContain('粘贴');
 await desktop.locator('.yuanbao-message.user .image-preview').click();await expect(desktop.getByRole('dialog',{name:'图片预览'})).toBeVisible();
 await desktop.keyboard.press('Escape');await expect(desktop.getByRole('dialog',{name:'图片预览'})).toHaveCount(0);
 mkdirSync(join(root,'artifacts'),{recursive:true});await desktop.screenshot({path:join(root,'artifacts/chat-images.png')});
 await app.close();app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});desktop=await app.firstWindow();
 await desktop.locator('.conversation-item').first().click();await expect(desktop.locator('.yuanbao-message.user .chat-image img')).toBeVisible();
});

test('upload rejection preserves webpage drafts and never sends a text-only substitute',async()=>{
 await page.goto('https://www.doubao.com/chat/images');
 await page.setContent('<main><section><textarea data-testid="chat_input_input">原网页草稿</textarea><button data-testid="chat_input_send_button">发送</button></section></main>');
 const job={id:'fail-image',url:page.url(),text:'说明',images:[{name:'图.png',dataUrl:png}]};
 expect((await page.evaluate(prepareWebImages,{provider:'doubao',job})).ok).toBe(false);
 expect(await page.locator('textarea').inputValue()).toBe('原网页草稿');
 await page.locator('textarea').fill('');
 await page.evaluate(()=>document.querySelector('textarea').addEventListener('paste',()=>{const alert=document.createElement('div');alert.setAttribute('role','alert');alert.textContent='上传失败';document.querySelector('section').append(alert);}));
 expect((await page.evaluate(prepareWebImages,{provider:'doubao',job})).error).toContain('上传失败');
 expect((await page.evaluate(doubaoCommand,{command:'begin',job})).phase).toBe('failed');
});

test('relay does not send after cancellation while images are uploading',async()=>{
 await page.addInitScript(png=>{
  window.commands=[];window.reported=false;
  window.chrome={storage:{local:{get:async()=>({pairing:{url:'http://127.0.0.1:12345',token:'a'.repeat(64)}})}},scripting:{executeScript:async({args:[args]})=>{
   window.commands.push(args.command);
   if(args.command==='prepare-images')return [{result:{ok:true}}];
   return [{result:{ready:true,url:'https://yuanbao.tencent.com/chat/images',diagnostics:{editor:true,sendButtonVisible:true}}}];
  }}};
  let claimed=false;
  window.fetch=async url=>({ok:true,status:200,json:async()=>{
   if(url.endsWith('/bind'))return {bindingId:'bind'};
   if(url.endsWith('/report')){window.reported=true;return {accepted:false};}
   if(!claimed){claimed=true;return {job:{id:'cancelled',lease:'lease',url:'https://yuanbao.tencent.com/chat/images',text:'图',images:[{name:'图.png',dataUrl:png}]}};}
   return {};
  }});
 },png);
 await page.route('https://image-relay.fixture/**',r=>{
  const name=new URL(r.request().url()).pathname.slice(1);
  if(!['yuanbao.html','yuanbao-relay.js','yuanbao-adapter.js','web-relay.js','web-relay-panel.js','image-upload.js','pairing.js','popup.css'].includes(name))return r.abort();
  return r.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:readFileSync(join(root,'browser-extension',name),'utf8')});
 });
 await page.goto('https://image-relay.fixture/yuanbao.html?tabId=1');
 await expect(page.locator('#status')).toContainText('图片未发送');
 expect(await page.evaluate(()=>window.reported)).toBe(true);
 expect(await page.evaluate(()=>window.commands)).toContain('prepare-images');
 expect(await page.evaluate(()=>window.commands)).not.toContain('begin');
});

test('Doubao scopes image inputs to the composer and ignores sibling upload features',async()=>{
 await page.goto('https://www.doubao.com/chat/images');
 await page.setContent('<main><div><aside><input id="other" type="file" accept="image/*"></aside><section data-testid="chat_input"><textarea data-testid="chat_input_input"></textarea><input id="chat-file" type="file" accept="image/*"><div id="preview"></div></section></div></main>');
 await page.evaluate(png=>{
  window.uploads=0;window.otherUploads=0;
  document.getElementById('other').onchange=()=>window.otherUploads++;
  document.getElementById('chat-file').onchange=()=>{window.uploads++;const img=document.createElement('img');img.src=png;document.getElementById('preview').append(img);};
 },png);
 const job={id:'scoped',url:page.url(),text:'说明',images:[{name:'截图.png',dataUrl:png}]};
 expect(await page.evaluate(prepareWebImages,{provider:'doubao',job})).toEqual({ok:true});
 expect(await page.evaluate(()=>[window.uploads,window.otherUploads])).toEqual([1,0]);
 const diagnostics=(await page.evaluate(doubaoCommand,{command:'probe'})).diagnostics.imageUpload;
 expect(diagnostics.composerExplicit).toBe(true);expect(diagnostics.imageInputs).toBe(1);expect(diagnostics.strategy).toBe('file-input');
 expect(JSON.stringify(diagnostics)).not.toContain('base64');
});
test('Doubao with multiple image pickers pastes once into the editor and sends once after preview',async()=>{
 await page.goto('https://www.doubao.com/chat/images');
 await page.setContent('<main><section data-testid="chat_input"><textarea data-testid="chat_input_input"></textarea><input type="file" accept="image/*" multiple><input type="file" accept=".png,.jpg"><div id="preview"></div><button data-testid="chat_input_send_button" disabled>发送</button></section></main>');
 await page.evaluate(png=>{
  window.uploads=0;window.pastes=0;window.sends=0;
  document.querySelectorAll('input').forEach(e=>e.onchange=()=>window.uploads++);
  const editor=document.querySelector('textarea'),button=document.querySelector('button');
  editor.onpaste=e=>{e.preventDefault();window.pastes++;window.imageCount=e.clipboardData.files.length;const img=document.createElement('img');img.src=png;document.getElementById('preview').append(img);};
  editor.oninput=()=>button.disabled=!editor.value;button.onclick=()=>window.sends++;
 },png);
 const job={id:'paste-multiple',url:page.url(),text:'说明',images:[{name:'图片.png',dataUrl:png}]};
 expect(await page.evaluate(prepareWebImages,{provider:'doubao',job})).toEqual({ok:true});
 expect((await page.evaluate(doubaoCommand,{command:'begin',job})).phase).toBe('waiting');
 await page.evaluate(prepareWebImages,{provider:'doubao',job});await page.evaluate(doubaoCommand,{command:'begin',job});
 expect(await page.evaluate(()=>[window.uploads,window.pastes,window.imageCount,window.sends])).toEqual([0,1,1,1]);
 const d=(await page.evaluate(doubaoCommand,{command:'probe'})).diagnostics.imageUpload;
 expect(d.strategy).toBe('composer-paste');expect(d.imageInputs).toBe(2);expect(d.stage).toBe('ready');
});
test('ambiguous picker paste failure never falls back to another input or sends text',async()=>{
 await page.goto('https://www.doubao.com/chat/images');
 await page.setContent('<main><section data-testid="chat_input"><textarea data-testid="chat_input_input"></textarea><input type="file" accept="image/*"><input type="file" accept="image/*"><button data-testid="chat_input_send_button">发送</button></section></main>');
 await page.evaluate(()=>{
  window.uploads=0;window.pastes=0;window.sends=0;
  document.querySelectorAll('input').forEach(e=>e.onchange=()=>window.uploads++);
  document.querySelector('button').onclick=()=>window.sends++;
  document.querySelector('textarea').onpaste=()=>{window.pastes++;const e=document.createElement('div');e.setAttribute('role','alert');e.textContent='图片上传失败';document.querySelector('section').append(e);};
 });
 const job={id:'paste-failed',url:page.url(),text:'说明',images:[{name:'图.png',dataUrl:png}]};
 expect((await page.evaluate(prepareWebImages,{provider:'doubao',job})).error).toContain('上传失败');
 expect((await page.evaluate(doubaoCommand,{command:'begin',job})).phase).toBe('failed');
 await page.evaluate(prepareWebImages,{provider:'doubao',job});
 expect(await page.evaluate(()=>[window.uploads,window.pastes,window.sends])).toEqual([0,1,0]);
});
