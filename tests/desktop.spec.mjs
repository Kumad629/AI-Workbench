import {uploadCapture} from '../browser-extension/transfer.js';
import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
test('desktop: group, switch, quote, collection, search and restart',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'workbench-e2e-'));
  const requests=[];
  const server=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    const request=JSON.parse(text);requests.push(request);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const answer=request.model==='model-a'?'## 一个值得保存的想法\n\n先做一个小而完整的原型，再逐步迭代。':'## 另一个视角\n\n先明确目标用户，再决定功能优先级。';
    for(const delta of answer.match(/.{1,8}/gs)||[]){res.write('data: '+JSON.stringify({choices:[{delta:{content:delta}}]})+'\n\n');await new Promise(r=>setTimeout(r,12));}
    res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let app;
  try {
    const launch=()=>electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir},timeout:30000});
    app=await launch();let page=await app.firstWindow();
    await expect(page.getByRole('heading',{name:'你的问题，更多视角。'})).toBeVisible();
    mkdirSync(join(root,'artifacts'),{recursive:true});
    expect(await page.locator('.message-scroll').evaluate(el=>el.scrollHeight<=el.clientHeight+2)).toBeTruthy();
    await page.screenshot({path:join(root,'artifacts/welcome.png')});
    for(const [name,model] of [['DeepSeek 测试','model-a'],['Gemini 测试','model-b']]) {
      await page.getByRole('button',{name:'添加模型连接',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'添加模型连接'});
      if(model==='model-b')await dialog.getByLabel('供应商').selectOption('Gemini');
      await dialog.getByLabel('连接名称').fill(name);
      await dialog.getByLabel('模型 ID').fill(model);
      await dialog.getByLabel('API 基础地址').fill('http://127.0.0.1:'+server.address().port+'/v1');
      await dialog.getByLabel('API Key').fill('fixture-secret');
      await dialog.getByRole('button',{name:'保存连接',exact:true}).click();
      await expect(dialog).not.toBeVisible();
    }
    await page.getByRole('button',{name:'群聊',exact:true}).click();
    await page.getByLabel('输入问题').fill('如何把一个想法变成项目？');
    await page.getByRole('button',{name:'发送问题'}).click();
    await expect(page.getByText('已完成',{exact:true})).toHaveCount(2);
    expect(requests).toHaveLength(2);
    expect(requests[0].messages).toEqual(requests[1].messages);
    await page.locator('.message-scroll').evaluate(el=>el.scrollTop=0);
    if(await page.getByLabel('关闭提示').isVisible())await page.getByLabel('关闭提示').click();
    await page.screenshot({path:join(root,'artifacts/group-chat.png')});
    await page.getByTestId('answer-card').first().getByRole('button',{name:'收藏',exact:true}).click();
    let dialog=page.getByRole('dialog',{name:'保存到精选库'});
    await dialog.getByLabel('标题').fill('项目起点');
    await dialog.getByLabel('标签').fill('项目，灵感');
    await dialog.getByLabel('我的笔记').fill('先验证需求，再投入开发。');
    await dialog.getByRole('button',{name:'保存精选'}).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button',{name:/^精选库/}).click();
    await expect(page.getByRole('heading',{name:'项目起点'})).toBeVisible();
    await expect(page.getByText('先验证需求，再投入开发。',{exact:true})).toBeVisible();
    if(await page.getByLabel('关闭提示').isVisible())await page.getByLabel('关闭提示').click();
    await page.screenshot({path:join(root,'artifacts/library.png')});
    await page.getByRole('button',{name:'回到原对话'}).click();
    await page.getByTestId('answer-card').last().getByRole('button',{name:'引用',exact:true}).click();
    await page.getByLabel('发送给',{exact:true}).selectOption({label:'@DeepSeek 测试'});
    await page.getByLabel('输入问题').fill('你怎么看这个观点？');
    await page.getByRole('button',{name:'发送问题'}).click();
    await expect(page.getByText('已完成',{exact:true})).toHaveCount(3);
    expect(requests).toHaveLength(3);
    expect(requests[2].messages.at(-1).content).toContain('引用 Gemini 测试');
    await page.getByTestId('answer-card').first().getByRole('button',{name:'分支 DeepSeek 测试'}).click();
    await expect(page.getByRole('heading',{name:/· 分支/})).toBeVisible();
    await page.getByLabel('选择聊天模型').selectOption({label:'Gemini 测试 · model-b'});
    await page.getByLabel('输入问题').fill('请继续细化');
    await page.getByRole('button',{name:'发送问题'}).click();
    await expect(page.getByText('已完成',{exact:true})).toHaveCount(2);
    expect(requests.at(-1).model).toBe('model-b');
    expect(requests.at(-1).messages.some(m=>m.content.includes('小而完整'))).toBeTruthy();
    const snapshot=await page.evaluate(()=>window.workbench.call('snapshot'));
    expect(JSON.stringify(snapshot)).not.toContain('fixture-secret');
    expect(snapshot.excerpts).toHaveLength(1);
    await app.close();app=await launch();page=await app.firstWindow();
    await page.getByRole('button',{name:/^精选库/}).click();
    await expect(page.getByRole('heading',{name:'项目起点'})).toBeVisible();
    const restored=await page.evaluate(()=>window.workbench.call('snapshot'));
    expect(restored.conversations).toHaveLength(2);
    expect(restored.connections).toHaveLength(2);
    await page.getByLabel('搜索精选').fill('完全不存在的关键词');
    await expect(page.getByRole('heading',{name:'没有找到相关精选'})).toBeVisible();
    await page.getByLabel('搜索精选').fill('灵感');
    await expect(page.getByRole('heading',{name:'项目起点'})).toBeVisible();
    await page.getByRole('button',{name:'保存外部对话',exact:true}).click();
    const transcript=page.getByRole('dialog',{name:'保存外部对话'});
    await transcript.getByLabel('标题',{exact:true}).fill('从 X 讨论到项目草案');
    await transcript.getByLabel('对话原文').fill('我：这个观点有什么启发？\n\nGrok：可以从一个小实验开始。');
    await transcript.getByLabel('来源链接').fill('https://x.com/example/status/123');
    await transcript.getByLabel('我的想法 / 项目草案').fill('目标：把讨论变成可以验证的小项目。');
    await transcript.getByRole('button',{name:'保存原文'}).click();
    await expect(page.getByRole('heading',{name:'从 X 讨论到项目草案'})).toBeVisible();
    await expect(page.getByRole('link',{name:'来源链接 1'})).toHaveAttribute('href','https://x.com/example/status/123');
    await expect(page.getByText('目标：把讨论变成可以验证的小项目。',{exact:true})).toBeVisible();
    await page.getByTestId('answer-card').getByRole('button',{name:'收藏',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'保存到精选库'})).toBeVisible();
    await page.getByRole('button',{name:'取消',exact:true}).click();
    await page.setViewportSize({width:1024,height:740});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
    const errors=await page.evaluate(()=>document.querySelectorAll('body > vite-error-overlay').length);
    expect(errors).toBe(0);
  } finally {if(app)await app.close().catch(()=>{});await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});

test('browser account pairing imports a Gemini capture into desktop without an API key',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'workbench-browser-e2e-'));let app;
  try {
    app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});
    const page=await app.firstWindow();
    await page.getByRole('button',{name:'网页账号',exact:true}).click();
    await expect(page.getByRole('heading',{name:'把网页里的对话带回来'})).toBeVisible();
    const pairing=page.getByLabel('浏览器配对信息');
    await expect(pairing).toBeVisible();await expect(pairing).toHaveAttribute('type','password');
    const config=JSON.parse(await pairing.inputValue());
    await app.evaluate(async({clipboard,ClipboardItem})=>{
      globalThis.testClipboard=await Promise.all((await clipboard.read()).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))));
    });
    let popup;
    try {
      await page.getByRole('button',{name:'复制配对信息',exact:true}).click();
      await expect(page.getByRole('status').filter({hasText:'已复制完整配对信息'})).toBeVisible();
      expect(await app.evaluate(async({clipboard},expected)=>(await clipboard.readText())===expected,JSON.stringify(config))).toBe(true);
      await page.getByRole('button',{name:'显示',exact:true}).click();
      await expect(pairing).toHaveAttribute('type','text');
      await page.getByRole('button',{name:'隐藏',exact:true}).click();
      await expect(pairing).toHaveAttribute('type','password');
      const opened=app.waitForEvent('window');
      await app.evaluate(({BrowserWindow})=>{void new BrowserWindow({width:520,height:850,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadURL('about:blank');});
      popup=await opened;
      await popup.addInitScript(()=>{window.chrome={storage:{local:{get:async()=>({}),set:async value=>{window.savedPairing=value;}}}};});
      await popup.route('http://127.0.0.1:*/status',async route=>{
        expect(route.request().headers().authorization===('Bearer '+config.token)).toBe(true);
        await route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
      });
      await popup.goto(pathToFileURL(join(root,'browser-extension/popup.html')).href);
      const pasted=popup.locator('#pairing');
      await pasted.fill('abc');
      await expect(popup.locator('#pairing-feedback')).toContainText('已输入 3 个字符');
      await expect(popup.locator('#pair')).toBeDisabled();
      await pasted.press('Control+a');
      await pasted.press('Control+v');
      await expect(popup.locator('#pairing-feedback')).toContainText('配对格式正确');
      expect((await pasted.inputValue())===JSON.stringify(config)).toBe(true);
      await popup.getByRole('button',{name:'显示配对信息',exact:true}).click();
      await expect(pasted).toHaveAttribute('type','text');
      await popup.getByRole('button',{name:'隐藏配对信息',exact:true}).click();
      await popup.locator('#pair').click();
      await expect(popup.locator('#status')).toHaveText('已连接本机 AI Workbench');
      expect(await popup.evaluate(expected=>window.savedPairing.pairing.token===expected,config.token)).toBe(true);
    } finally {
      if(popup)await popup.close().catch(()=>{});
      await app.evaluate(async({clipboard})=>{if(globalThis.testClipboard.length)await clipboard.write(globalThis.testClipboard);else clipboard.clear();delete globalThis.testClipboard;});
    }
    const response=await fetch(config.url+'/capture',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.token,Origin:'chrome-extension://'+'a'.repeat(32)},body:JSON.stringify({requestId:'desktop-browser-capture-001',title:'Gemini 网页里的项目讨论',content:'我：怎么验证这个想法？\n\nGemini：先做一个可测量的小实验。',url:'https://gemini.google.com/app/test-conversation',note:'下周验证原型'})});
    expect(response.status).toBe(200);
    await expect(page.getByRole('heading',{name:'Gemini 网页里的项目讨论'})).toBeVisible();
    await expect(page.getByText('下周验证原型',{exact:true})).toBeVisible();
    expect((await page.evaluate(()=>window.workbench.call('snapshot'))).connections).toHaveLength(0);
    await page.getByRole('button',{name:'网页账号',exact:true}).click();
    await expect(page.getByLabel('浏览器配对信息')).toBeVisible();
    if(await page.getByLabel('关闭提示').isVisible())await page.getByLabel('关闭提示').click();
    await page.screenshot({path:join(root,'artifacts/browser-accounts.png')});
    await page.getByRole('button',{name:'重置连接码'}).click();
    await expect(page.getByRole('status').filter({hasText:'旧连接码已失效'})).toBeVisible();
    const rotated=JSON.parse(await page.getByLabel('浏览器配对信息').inputValue());
    expect((await fetch(config.url+'/status',{method:'POST',headers:{Authorization:'Bearer '+config.token}})).status).toBe(401);
    await app.close();app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});
    const reopened=await app.firstWindow();
    // A user's running app can occupy the default port; the isolated test profile then uses a fresh port.
    const restoredBridge=await reopened.evaluate(()=>window.workbench.call('browserBridgeInfo'));
    await expect.poll(async()=>{try{return (await fetch(restoredBridge.url+'/status',{method:'POST',headers:{Authorization:'Bearer '+rotated.token}})).status;}catch{return 0;}}).toBe(200);
    await reopened.locator('.conversation-item').filter({hasText:'Gemini 网页里的项目讨论'}).click();
    await expect(reopened.getByRole('heading',{name:'Gemini 网页里的项目讨论'})).toBeVisible();
  }finally{if(app)await app.close().catch(()=>{});rmSync(dir,{recursive:true,force:true});}
});


test('long browser archive pages, bookmarks, exports and reopens as one conversation',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'workbench-long-desktop-'));let app;
  try{
    const launch=()=>electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});
    app=await launch();let page=await app.firstWindow();
    await page.getByRole('button',{name:'网页账号',exact:true}).click();
    const info=await page.evaluate(()=>window.workbench.call('browserBridgeInfo'));
    const config=JSON.parse(info.pairing);
    const request=async(path,body={})=>{
      const response=await fetch(config.url+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.token},body:JSON.stringify(body)});
      const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
    };
    const content=Array.from({length:240},(_,i)=>'我：第 '+i+' 个问题\n\nGemini：'+('完整内容验证。'.repeat(400))+'\n\n[原文标记-'+i+']').join('\n\n');
    const result=await uploadCapture(request,{requestId:'desktop-long-archive-001',title:'完整长对话分页测试',content,url:'https://gemini.google.com/app/long-test',note:'长对话保存验证'});
    await expect(page.getByRole('heading',{name:'完整长对话分页测试'})).toBeVisible();
    await expect(page.locator('.archive-pagination')).toContainText('第 1 /');
    await expect(page.getByTestId('answer-card')).toHaveCount(2);
    await page.getByRole('button',{name:'末页',exact:true}).click();
    await expect(page.getByText('[原文标记-239]',{exact:true})).toBeVisible();
    await page.getByTestId('answer-card').last().getByRole('button',{name:'收藏',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'保存到精选库'});
    await dialog.getByLabel('标题').fill('长对话末尾精选');
    await dialog.getByRole('button',{name:'保存精选'}).click();
    await page.getByRole('button',{name:/^精选库/}).click();
    await page.getByRole('button',{name:'回到原对话'}).click();
    await expect(page.getByText('[原文标记-239]',{exact:true})).toBeVisible();
    const exportedPath=join(dir,'archive.md');
    await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},exportedPath);
    await page.evaluate(id=>window.workbench.call('exportConversation',{conversationId:id,format:'md'}),result.conversationId);
    expect(readFileSync(exportedPath,'utf8').includes(content)).toBe(true);
    const snapshot=await page.evaluate(()=>window.workbench.call('snapshot'));
    expect(snapshot.conversations).toHaveLength(1);
    expect(snapshot.conversations[0].messages.filter(m=>m.isTranscript).map(m=>m.content).join('')===content).toBe(true);
    await page.screenshot({path:join(root,'artifacts/long-archive.png')});
    await app.close();app=await launch();page=await app.firstWindow();
    await page.locator('.conversation-item').filter({hasText:'完整长对话分页测试'}).click();
    await expect(page.locator('.archive-pagination')).toContainText('第 1 /');
    await page.getByRole('button',{name:'末页',exact:true}).click();
    await expect(page.getByText('[原文标记-239]',{exact:true})).toBeVisible();
  }finally{if(app)await app.close().catch(()=>{});rmSync(dir,{recursive:true,force:true});}
});
