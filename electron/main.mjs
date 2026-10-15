import { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, clipboard, Menu, utilityProcess } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { WebChat, yuanbaoUrl, doubaoUrl, grokUrl, chatgptUrl, geminiUrl } from './web-chat.mjs';
import { Store } from './store.mjs';
import { VoiceModel } from './voice-model.mjs';
import { VoiceService,mayUseMicrophone } from './voice-service.mjs';
import { BrowserBridge } from './browser-bridge.mjs';
import { randomBytes } from 'node:crypto';
import { Engine, markdownExport } from './engine.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
app.setName('AI Workbench');
const dataDirectory=process.env.AI_WORKBENCH_DATA_DIR || join(app.getPath('appData'),'AI-Workbench');
app.setPath('userData',dataDirectory);
let win,engine,updateTimer;
if(!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
  app.whenReady().then(async () => {
  const store=new Store(dataDirectory);
  const voiceModel=new VoiceModel(process.env.AI_WORKBENCH_VOICE_MODEL_DIR||join(root,'local-models','sensevoice'));
  const voiceService=new VoiceService(voiceModel,()=>utilityProcess.fork(join(root,'electron','voice-worker.cjs'),[],{stdio:'pipe',serviceName:'Local speech recognition'}));
  let voiceArmedUntil=0;
  const vault={
    encrypt: value=>{
      if(!safeStorage.isEncryptionAvailable())throw new Error('系统凭据加密不可用，暂时无法保存密钥');
      return safeStorage.encryptString(value).toString('base64');
    },
    decrypt: value=>{
      if(!value)throw new Error('此连接没有密钥，请在设置中重新保存');
      try{return safeStorage.decryptString(Buffer.from(value,'base64'));}catch{throw new Error('无法解密此连接的密钥，请在本机重新填写');}
    }
  };
  const getBrowserToken=()=>{
    const value=store.secret('browser-bridge-token');
    if(value){const token=vault.decrypt(value);if(/^[a-f0-9]{64}$/.test(token))return token;}
    const token=randomBytes(32).toString('hex');store.setSecret('browser-bridge-token',vault.encrypt(token));return token;
  };
  const browserBridge=new BrowserBridge({store,getToken:getBrowserToken,importTranscript:input=>engine.importTranscript(input),onImport:id=>{if(win&&!win.isDestroyed()){win.webContents.send('workbench:browser-import',id);if(win.isMinimized())win.restore();win.show();win.focus();}}});
  const browserInfo=async()=>{const url=await browserBridge.start();return {url,pairing:JSON.stringify({format:'awb-browser-v1',url,token:getBrowserToken()}),extensionDirectory:join(root,'browser-extension')};};
  const snapshot=()=>({...engine.snapshot(),dataDirectory,version:app.getVersion()});
  engine=new Engine(store,vault,()=>{
    clearTimeout(updateTimer);
    updateTimer=setTimeout(()=>{if(win&&!win.isDestroyed())win.webContents.send('workbench:update',snapshot());},70);
  });
  const notifyWeb=()=>{clearTimeout(updateTimer);updateTimer=setTimeout(()=>{if(win&&!win.isDestroyed())win.webContents.send('workbench:update',snapshot());},70);};
  const webChats={chatgpt:new WebChat(store,notifyWeb,()=>Date.now(),'chatgpt'),gemini:new WebChat(store,notifyWeb,()=>Date.now(),'gemini'),grok:new WebChat(store,notifyWeb,()=>Date.now(),'grok'),yuanbao:new WebChat(store,notifyWeb),doubao:new WebChat(store,notifyWeb,()=>Date.now(),'doubao')};
  const chatFor=(provider='yuanbao')=>{if(!Object.hasOwn(webChats,provider))throw new Error('未知网页平台');return webChats[provider];};
  browserBridge.webChat=Object.fromEntries(['bind','poll','history','report'].map(method=>[method,data=>chatFor(data.provider)[method](data)]));
  const methods=new Set(['conversationShare','saveConnection','deleteConnection','testConnection','createConversation','updateConversation','send','cancel','retry','branch','saveExcerpt','deleteExcerpt','importTranscript']);
  ipcMain.handle('workbench:call',async(event,action,payload={})=>{
    if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw new Error('不允许的调用来源');
    if(action==='snapshot')return snapshot();
    if(action==='voiceArm'){if(!win.isFocused())throw new Error('请回到工作台后开始录音');voiceArmedUntil=Date.now()+15000;return true;}
    if(action==='voiceModelStatus')return voiceModel.status();
    if(action==='voiceModelDownload')return voiceModel.start();
    if(action==='voiceModelCancel')return voiceModel.cancel();
    if(action==='voiceModelRemove'){if(voiceService.active)throw new Error('请先停止识别');return voiceModel.remove();}
    if(action==='voiceTranscribe')return voiceService.transcribe(payload);
    if(action==='voiceCancel'){voiceArmedUntil=0;return voiceService.cancel(payload.id);}
    if(action==='deleteConversation'){
      const syncing=Object.values(webChats).map(chat=>chat.status());
      if(syncing.some(status=>status.conversationId===payload.id&&status.history?.phase==='loading'))throw new Error('请等待网页历史同步完成后再删除');
      const result=engine.deleteConversation(payload);
      for(const chat of Object.values(webChats))if(chat.binding?.conversationId===payload.id)chat.disconnect();
      return result;
    }
    if(action==='copyConversation'){
      const text=engine.shareMarkdown(payload);
      if(text.length>1000000)throw new Error('内容超过复制容量，请导出 Markdown 文件分享');
      clipboard.writeText(text);return {characters:text.length};
    }
    if(action==='openConversationSource'){await shell.openExternal(engine.conversationSource(payload));return true;}
    if(action==='webChatStatus'){await browserBridge.start();return chatFor(payload.provider).status();}
    if(action==='webChatHistory')return chatFor(payload.provider).requestHistory(payload);
    if(action==='webChatSend')return chatFor(payload.provider).send(payload);
    if(action==='webChatCancel')return chatFor(payload.provider).cancel();
    if(action==='webChatDisconnect')return chatFor(payload.provider).disconnect();
    if(action==='openDoubao'){await shell.openExternal(doubaoUrl(payload.url||'https://www.doubao.com/chat/'));return true;}
    if(action==='openYuanbao'){await shell.openExternal(yuanbaoUrl(payload.url||'https://yuanbao.tencent.com/'));return true;}
    if(action==='browserBridgeInfo')return browserInfo();
    if(action==='copyText'){
      if(typeof payload?.text!=='string'||payload.text.length>1000000)throw new Error('复制内容无效或超过容量');
      await clipboard.writeText(payload.text);
      return {characters:payload.text.length};
    }
    if(action==='copyBrowserPairing'){
      const info=await browserInfo();
      await clipboard.writeText(info.pairing);
      if(await clipboard.readText()!==info.pairing)throw new Error('系统剪贴板复制失败，请点击显示后全选复制');
      return {characters:info.pairing.length};
    }
    if(action==='resetBrowserBridge'){Object.values(webChats).forEach(chat=>chat.disconnect());store.removeSecret('browser-bridge-token');browserBridge.receipts.clear();return browserInfo();}
    if(action==='openGrok'){await shell.openExternal(grokUrl(payload.url||'https://x.com/i/grok'));return true;}
    if(action==='openGemini'){await shell.openExternal(geminiUrl(payload.url||'https://gemini.google.com/app'));return true;}
    if(action==='openChatGPT'){await shell.openExternal(chatgptUrl(payload.url||'https://chatgpt.com/'));return true;}
    if(action==='openBrowserExtensionDirectory'){const error=await shell.openPath(join(root,'browser-extension'));if(error)throw new Error(error);return true;}
    if(action==='exportConversation') {
      const data=engine.exportData(payload.conversationId);
      const format=payload.format==='json'?'json':'md';
      const name=data.conversation.title.replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').slice(0,70)||'conversation';
      const result=await dialog.showSaveDialog(win,{title:'导出会话',defaultPath:name+'.'+format,filters:[{name:format==='json'?'AI Workbench JSON':'Markdown',extensions:[format]}]});
      if(result.canceled)return null;
      await writeFile(result.filePath,format==='json'?JSON.stringify(data,null,2):markdownExport(data.conversation,data.excerpts,{includeNotes:payload.includeNotes!==false}),'utf8');
      return result.filePath;
    }
    if(action==='importConversation') {
      const result=await dialog.showOpenDialog(win,{title:'导入 AI Workbench 会话',filters:[{name:'AI Workbench JSON',extensions:['json']}],properties:['openFile']});
      if(result.canceled)return null;
      const raw=await readFile(result.filePaths[0],'utf8');
      if(raw.length>80000000)throw new Error('JSON 文件超过导入容量，请缩小导出范围');
      let data;try{data=JSON.parse(raw);}catch{throw new Error('文件不是有效的 JSON');}
      return engine.importData(data);
    }
    if(!methods.has(action))throw new Error('未知操作');
    return engine[action](payload);
  });
  win=new BrowserWindow({width:1440,height:960,minWidth:980,minHeight:700,title:'AI Workbench · AI 工作台',backgroundColor:'#f6f7fa',show:false,autoHideMenuBar:true,webPreferences:{preload:join(root,'electron/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'编辑',submenu:[{label:'撤销',role:'undo'},{label:'重做',role:'redo'},{type:'separator'},{label:'剪切',role:'cut'},{label:'复制',role:'copy'},{label:'粘贴',role:'paste'},{label:'全选',role:'selectAll'}]}]));
  win.webContents.on('context-menu',(_event,params)=>{
    const items=[];
    if(params.isEditable)items.push({label:'撤销',role:'undo'},{label:'重做',role:'redo'},{type:'separator'},{label:'剪切',role:'cut'});
    if(params.selectionText||params.isEditable)items.push({label:'复制',role:'copy'});
    if(params.isEditable)items.push({label:'粘贴',role:'paste'});
    if(params.selectionText||params.isEditable)items.push({label:'全选',role:'selectAll'});
    if(items.length)Menu.buildFromTemplate(items).popup({window:win});
  });
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//.test(url))void shell.openExternal(url);return {action:'deny'};});
  win.webContents.on('will-navigate',event=>event.preventDefault());
  const trustedVoicePage=(wc,url)=>{try{return wc===win.webContents&&fileURLToPath(new URL(url))===join(root,'dist','index.html');}catch{return false;}};
  win.webContents.session.setPermissionCheckHandler((wc,permission,_origin,details)=>mayUseMicrophone({trusted:trustedVoicePage(wc,details.requestingUrl),armed:Date.now()<voiceArmedUntil,permission,details}));
  win.webContents.session.setPermissionRequestHandler((wc,permission,callback,details)=>callback(mayUseMicrophone({trusted:trustedVoicePage(wc,details.requestingUrl),armed:Date.now()<voiceArmedUntil,permission,details,request:true})));
  win.once('ready-to-show',()=>win.show());
  await win.loadFile(join(root,'dist/index.html'));
  if(store.secret('browser-bridge-token'))void browserBridge.start().catch(()=>{});
  app.on('before-quit',()=>{voiceService.cancel();void voiceModel.cancel();void browserBridge.close();for(const r of engine.running.values())r.controller.abort();});
  app.on('window-all-closed',()=>app.quit());
  }).catch(error => { console.error(error); app.quit(); });
}
