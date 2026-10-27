import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../',import.meta.url))),service=fileURLToPath(new URL('../electron/voice-service.mjs',import.meta.url)),modelModule=fileURLToPath(new URL('../electron/voice-model.mjs',import.meta.url));
let app,page,dir;
test.beforeEach(async()=>{
 dir=mkdtempSync(join(tmpdir(),'awb-recording-'));app=await electron.launch({args:[root,'--use-fake-device-for-media-stream'],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir,AI_WORKBENCH_VOICE_MODEL_DIR:join(dir,'models')}});page=await app.firstWindow();await expect(page.getByRole('heading',{name:'你的问题，更多视角。'})).toBeVisible();await page.bringToFront();await page.evaluate(()=>localStorage.setItem('voice-auto-finish','false'));await page.reload();await page.waitForFunction(()=>!!window.workbench);
 await app.evaluate((_,paths)=>{const req=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');const {VoiceService,parseVoiceWav}=req(paths.service);const {VoiceModel}=req(paths.modelModule);globalThis.voiceCalls=0;VoiceModel.prototype.status=async()=>({ready:true,phase:'ready',progress:1});VoiceService.prototype.transcribe=async({wav})=>{const samples=parseVoiceWav(wav);globalThis.voiceSamples=samples.length;globalThis.voiceCalls++;return {text:'这是本地识别的文字'};};},{service,modelModule});
 await page.evaluate(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{const s=await original(c);window.testVoiceStreams??=[];window.testVoiceStreams.push(s);return s;};});
});
test.afterEach(async()=>{if(app)await app.close();if(dir)rmSync(dir,{recursive:true,force:true});});
async function record(){await page.getByRole('button',{name:'语音输入',exact:true}).click();await page.getByRole('button',{name:'开始录音',exact:true}).click();await expect(page.getByText('正在录音',{exact:true})).toBeVisible();await expect(page.locator('.voice-clock')).toContainText('00:02',{timeout:10000});await page.getByRole('button',{name:'完成录音',exact:true}).click();await expect(page.getByLabel('试听录音')).toBeVisible();expect(await page.evaluate(()=>window.testVoiceStreams.flatMap(s=>s.getTracks()).every(t=>t.readyState==='ended'))).toBe(true);}
test('records actual browser audio, previews, recognizes and preserves the draft selection without sending',async()=>{
 const input=page.getByRole('textbox',{name:'输入问题',exact:true});await input.fill('前面保留后面');await input.evaluate(e=>{e.focus();e.setSelectionRange(2,4);});
 await record();await page.screenshot({path:join(root,'artifacts','voice-recording-review.png')});await page.getByRole('button',{name:'识别并填入'}).click();await expect(page.getByRole('dialog',{name:'语音输入'})).toBeHidden();await expect(input).toHaveValue('前面这是本地识别的文字后面');expect(await app.evaluate(()=>globalThis.voiceCalls)).toBe(1);expect(await app.evaluate(()=>globalThis.voiceSamples)).toBeGreaterThan(16000);expect((await page.evaluate(()=>window.workbench.call('snapshot'))).conversations).toHaveLength(0);
});
test('all web chats offer recording and cancelling stops capture without changing drafts',async()=>{
 for(const provider of ['元宝','豆包','Grok']){await page.getByRole('button',{name:'网页账号',exact:true}).click();await page.getByRole('button',{name:provider==='Grok'?'进入 Grok 网页聊天':'进入'+provider+'网页聊天',exact:true}).click();const input=page.getByRole('textbox',{name:'发给'+provider+'的问题'});await input.fill('原草稿');await page.getByRole('button',{name:'语音输入',exact:true}).click();await page.getByRole('button',{name:'开始录音',exact:true}).click();await expect(page.getByText('正在录音',{exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(input).toHaveValue('原草稿');await expect(input).toBeFocused();expect(await page.evaluate(()=>window.testVoiceStreams.flatMap(s=>s.getTracks()).every(t=>t.readyState==='ended'))).toBe(true);}
 expect(await app.evaluate(()=>globalThis.voiceCalls)).toBe(0);
});
test('microphone denial and transcription failure have distinct errors; recording survives for retry',async()=>{
 await app.evaluate(({BrowserWindow})=>{const ses=BrowserWindow.getAllWindows()[0].webContents.session;ses.setPermissionCheckHandler(()=>false);ses.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));});
 await page.getByRole('button',{name:'语音输入',exact:true}).click();await page.getByRole('button',{name:'开始录音',exact:true}).click();await expect(page.getByRole('alert')).toContainText('麦克风权限');await page.getByRole('button',{name:'关闭语音输入',exact:true}).click();
 await app.evaluate(({BrowserWindow},path)=>{const ses=BrowserWindow.getAllWindows()[0].webContents.session;ses.setPermissionCheckHandler((_wc,p)=>p==='media');ses.setPermissionRequestHandler((_wc,p,cb)=>cb(p==='media'));const req=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');req(path).VoiceService.prototype.transcribe=async()=>{throw new Error('本地识别超时，录音已保留');};},service);
 await record();const url=await page.getByLabel('试听录音').getAttribute('src');await page.getByRole('button',{name:'识别并填入'}).click();await expect(page.getByRole('alert')).toContainText('识别超时');await expect(page.getByLabel('试听录音')).toHaveAttribute('src',url);await expect(page.getByRole('button',{name:'识别并填入'})).toBeEnabled();
});
test('camera and unarmed microphone requests are denied; a changed draft is never overwritten',async()=>{
 expect(await page.evaluate(async()=>{try{const s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach(t=>t.stop());return false;}catch{return true;}})).toBe(true);
 await page.getByRole('button',{name:'语音输入',exact:true}).click();await page.getByRole('button',{name:'开始录音',exact:true}).click();await expect(page.getByText('正在录音',{exact:true})).toBeVisible();
 expect(await page.evaluate(async()=>{try{const s=await navigator.mediaDevices.getUserMedia({video:true});s.getTracks().forEach(t=>t.stop());return false;}catch{return true;}})).toBe(true);
 await page.keyboard.press('Escape');await record();
 await page.evaluate(()=>{const e=document.querySelector('textarea[aria-label="输入问题"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'后来修改的草稿');e.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.getByRole('button',{name:'识别并填入'}).click();await expect(page.getByLabel('识别结果')).toHaveValue('这是本地识别的文字');await expect(page.getByRole('textbox',{name:'输入问题',exact:true})).toHaveValue('后来修改的草稿');await page.getByRole('button',{name:'追加到当前草稿'}).click();await expect(page.getByRole('textbox',{name:'输入问题',exact:true})).toHaveValue('后来修改的草稿\n这是本地识别的文字');
});


test('automatic mode allows manual finish and retains failed audio for retry without looping',async()=>{
 await app.evaluate((_,path)=>{const req=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');req(path).VoiceService.prototype.transcribe=async()=>{globalThis.voiceCalls++;if(globalThis.voiceCalls===1)throw new Error('本地识别超时，录音已保留');return {text:'重试成功'};};},service);
 const input=page.getByRole('textbox',{name:'输入问题',exact:true});await input.fill('原稿：');await input.evaluate(e=>{e.focus();e.setSelectionRange(e.value.length,e.value.length);});
 await page.getByRole('button',{name:'语音输入',exact:true}).click();await page.getByRole('checkbox',{name:/说完自动填入/}).check();await page.getByRole('button',{name:'开始录音',exact:true}).click();await expect(page.locator('.voice-clock')).toContainText('00:02');await page.getByRole('button',{name:'完成录音',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('识别超时');await expect(page.getByLabel('试听录音')).toBeVisible();await expect(input).toHaveValue('原稿：');expect(await app.evaluate(()=>globalThis.voiceCalls)).toBe(1);
 await page.getByRole('button',{name:'识别并填入',exact:true}).click();await expect(input).toHaveValue('原稿：重试成功');expect(await app.evaluate(()=>globalThis.voiceCalls)).toBe(2);expect((await page.evaluate(()=>window.workbench.call('snapshot'))).conversations).toHaveLength(0);
});

test('automatic mode stops an empty recording without invoking recognition',async()=>{
 await page.evaluate(()=>{AnalyserNode.prototype.getFloatTimeDomainData=function(values){values.fill(0);};});
 await page.getByRole('button',{name:'语音输入',exact:true}).click();await page.getByRole('checkbox',{name:/说完自动填入/}).check();await page.getByRole('button',{name:'开始录音',exact:true}).click();await expect(page.getByRole('alert')).toContainText('还没有听到清晰的说话声',{timeout:20000});expect(await app.evaluate(()=>globalThis.voiceCalls)).toBe(0);expect(await page.evaluate(()=>window.testVoiceStreams.flatMap(s=>s.getTracks()).every(t=>t.readyState==='ended'))).toBe(true);
});
