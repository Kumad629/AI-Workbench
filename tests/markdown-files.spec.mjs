import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../',import.meta.url))),content='# 季度研究规则\n\n保留来源，区分事实与判断。\n\n~~~js\nconst sample = 1;\n~~~\n';
let app,page,dir,server,requests,errors;
const file=(name='研究规则.md',text=content)=>({name,mimeType:'text/markdown',buffer:Buffer.from(text)});
const picker=()=>page.getByLabel('选择文件',{exact:true});
const pending=()=>page.getByLabel('待发送文件',{exact:true});
async function launch(){app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await expect(page.getByRole('heading',{name:'你的问题，更多视角。'})).toBeVisible();}
async function connection(name='DeepSeek 测试'){
 const id=await page.evaluate(payload=>window.workbench.call('saveConnection',payload),{name,provider:'DeepSeek',model:name,baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',apiKey:'fixture-only'});
 await expect(page.getByLabel('顶部聊天模型')).toContainText(name);await page.getByLabel('顶部聊天模型').selectOption(id);return id;
}
async function skin(name){await page.getByRole('button',{name:'切换外观',exact:true}).click();const d=page.getByRole('dialog',{name:'工作台外观'});await d.getByRole('radio',{name:new RegExp('^'+name)}).check();await d.getByRole('button',{name:'关闭弹窗'}).click();}
test.beforeEach(async()=>{
 dir=mkdtempSync(join(tmpdir(),'awb-md-files-'));requests=[];errors=[];server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'已读取文件内容，并保留来源。'}}]})+'\n\ndata: [DONE]\n\n');});await new Promise(r=>server.listen(0,'127.0.0.1',r));await launch();
});
test.afterEach(async()=>{if(app)await app.close();if(server)await new Promise(r=>server.close(r));if(dir)rmSync(dir,{recursive:true,force:true});expect(errors).toEqual([]);});

test('MD picker, preview, removal, skin changes and send retain full contents through history, export and restart',async()=>{
 await connection();await page.getByLabel('输入问题').fill('按文件规则分析');
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'添加文件',exact:true}).click();await (await chooser).setFiles([file()]);await expect(pending()).toContainText('研究规则.md');
 await pending().getByRole('button',{name:/预览 研究规则/}).click();const preview=page.getByRole('dialog',{name:'预览文件 · 研究规则.md'});await expect(preview.locator('pre')).toHaveText(content);await preview.getByRole('button',{name:'关闭弹窗'}).click();
 await skin('经典');await expect(pending()).toContainText('研究规则.md');await expect(page.getByLabel('输入问题')).toHaveValue('按文件规则分析');await skin('简约');
 await picker().setInputFiles(file('额外.markdown','# 临时文档'));await expect(pending().locator('.md-file-card')).toHaveCount(2);await page.getByRole('button',{name:'移除文件 额外.markdown'}).click();
 await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect(page.locator('.answer-status.complete')).toHaveCount(1);expect(requests).toHaveLength(1);const sent=requests[0].messages.at(-1).content;expect(sent).toContain('按文件规则分析');expect(sent).toContain('文件：研究规则.md');expect(sent).toContain(content);expect(sent).toContain('~~~~markdown');await expect(pending()).toHaveCount(0);
 await page.getByLabel('输入问题').fill('继续核对');await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect(page.locator('.answer-status.complete')).toHaveCount(2);expect(requests[1].messages.some(m=>m.role==='user'&&m.content.includes(content))).toBe(true);
 const id=(await page.evaluate(()=>window.workbench.call('snapshot'))).conversations[0].id,output=join(dir,'研究备份.json');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},output);await page.evaluate(id=>window.workbench.call('exportConversation',{conversationId:id,format:'json'}),id);expect(readFileSync(output,'utf8')).toContain('季度研究规则');const json=JSON.parse(readFileSync(output,'utf8'));expect(json.conversation.messages[0].content).toBe(sent);
 await app.close();app=null;await launch();const saved=(await page.evaluate(()=>window.workbench.call('snapshot'))).conversations[0];expect(saved.messages[0].content).toBe(sent);
});

test('MD drag/drop sends without extra prose and a failed send keeps files and draft available',async()=>{
 await connection();const transfer=await page.evaluateHandle(text=>{const d=new DataTransfer();d.items.add(new File([text],'拖放.MD',{type:'text/markdown'}));return d;},content);await page.locator('.composer').dispatchEvent('drop',{dataTransfer:transfer});await transfer.dispose();await expect(pending()).toContainText('拖放.MD');
 // Inject one IPC failure in the isolated main process; contextBridge exports are frozen.
 await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('workbench:call');ipcMain.removeHandler('workbench:call');ipcMain.handle('workbench:call',async(event,action,payload)=>{if(action==='send'){ipcMain.removeHandler('workbench:call');ipcMain.handle('workbench:call',original);throw Error('模拟发送失败');}return original(event,action,payload);});});await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect(page.getByText('模拟发送失败',{exact:true})).toBeVisible();await expect(pending()).toContainText('拖放.MD');expect(requests).toHaveLength(0);
 await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect(page.locator('.answer-status.complete')).toHaveCount(1);expect(requests).toHaveLength(1);expect(requests[0].messages.at(-1).content).toContain('请阅读以下文件内容。');expect(requests[0].messages.at(-1).content).toContain(content);
});

test('invalid type, empty file, binary, bad UTF-8, too many and over-limit documents never discard valid files or truncate',async()=>{
 await connection();await picker().setInputFiles(file());await expect(pending()).toContainText('研究规则.md');
 for(const [input,reason] of [[file('wrong.exe','text'),'支持 MD'],[file('empty.md','  '),'空文件'],[file('binary.md','a\0b'),'不是可读取'],[{name:'bad.md',mimeType:'text/markdown',buffer:Buffer.from([0xff,0xfe,0x80])},'UTF-8'],[file('large.md','a'.repeat(1024*1024+1)),'超过 1 MB'],[file('limit.md','字'.repeat(100001)),'100,000']]){
  await picker().setInputFiles(input);await expect(page.getByRole('alert')).toContainText(reason);await expect(pending().locator('.md-file-card')).toHaveCount(1);
 }
 await picker().setInputFiles(Array.from({length:5},(_,i)=>file('extra-'+i+'.md','# '+i)));await expect(page.getByRole('alert')).toContainText('最多添加 5');await expect(pending().locator('.md-file-card')).toHaveCount(1);
 await page.getByLabel('输入问题').fill('长'.repeat(99990));await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect(page.getByRole('alert')).toContainText('合计超过');expect(requests).toHaveLength(0);await expect(pending()).toContainText('研究规则.md');
 await page.getByLabel('输入问题').fill('保留草稿');await page.getByRole('button',{name:'新建对话',exact:true}).click();await expect(pending()).toHaveCount(0);await expect(page.getByLabel('输入问题')).toHaveValue('');
});

test('MD group broadcast and @ follow-ups keep other models responses private',async()=>{
 const first=await connection('模型甲'),second=await connection('模型乙');await page.getByLabel('对话模式',{exact:true}).selectOption('group');await picker().setInputFiles(file());await expect(pending()).toBeVisible();await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect(page.locator('.answer-status.complete')).toHaveCount(2);expect(requests).toHaveLength(2);expect(requests.every(r=>r.messages.at(-1).content.includes(content))).toBe(true);
 await page.getByLabel('输入问题').fill('@模型乙 单独看补充材料');await picker().setInputFiles(file('补充.md','# 第二份资料'));await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect(page.locator('.answer-status.complete')).toHaveCount(3);expect(requests).toHaveLength(3);expect(requests[2].model).toBe('模型乙');expect(requests[2].messages.at(-1).content).toContain('单独看补充材料');expect(requests[2].messages.at(-1).content).not.toContain('@模型乙');const c=(await page.evaluate(()=>window.workbench.call('snapshot'))).conversations[0];expect(c.messages.at(-1).context.filter(m=>m.role==='assistant')).toHaveLength(1);expect(first).not.toBe(second);
});

for(const [provider,name,url] of [['chatgpt','ChatGPT','https://chatgpt.com/c/md-test'],['yuanbao','元宝','https://yuanbao.tencent.com/chat/md-test']])test(name+' web chat sends MD text through the existing job bridge and enforces its limit',async()=>{
 const pair=JSON.parse((await page.evaluate(()=>window.workbench.call('browserBridgeInfo'))).pairing),clientId=randomUUID();
 const request=async(action,payload)=>{const r=await fetch(pair.url+'/web-chat/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pair.token},body:JSON.stringify({provider,clientId,...payload})});expect(r.ok).toBe(true);return r.json();};
 const binding=await request('bind',{url,ready:true,imageEnabled:provider==='yuanbao'});await page.getByRole('button',{name:'网页账号',exact:true}).click();await page.getByRole('button',{name:new RegExp('进入\\s*'+name+'\\s*网页聊天')}).click();
 await picker().setInputFiles(file('过长.md','a'.repeat(100001)));await expect(page.getByRole('alert')).toContainText('100,000');await picker().setInputFiles(file());await expect(pending()).toContainText('研究规则.md');await page.getByLabel('发给'+name+'的问题').fill('问'.repeat(99999));await page.getByRole('button',{name:'发送给'+name,exact:true}).click();await expect(page.getByRole('alert')).toContainText('合计超过');expect((await request('poll',{...binding,url,ready:true})).job).toBe(null);
 await page.getByLabel('发给'+name+'的问题').fill('按文件要求回答');await page.getByRole('button',{name:'发送给'+name,exact:true}).click();const job=(await request('poll',{...binding,url,ready:true})).job;expect(job.text).toContain(content);expect(job.text).toContain('按文件要求回答');expect((await request('poll',{...binding,url,ready:true})).job).toBe(null);await expect(pending()).toHaveCount(0);const c=(await page.evaluate(()=>window.workbench.call('snapshot'))).conversations[0];expect(c.webChat.provider).toBe(name);expect(c.messages[0].content).toContain(content);await request('report',{...binding,jobId:job.id,lease:job.lease,sequence:1,phase:'complete',content:'已读 MD',url});
 mkdirSync(join(root,'artifacts','markdown-files'),{recursive:true});await page.setViewportSize({width:1024,height:740});await picker().setInputFiles(file('预览.md'));await expect(pending()).toContainText('预览.md');await page.screenshot({path:join(root,'artifacts','markdown-files',provider+'.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
