import {browserSource} from './sources.js';
import {webChatSource} from './web-providers.js';
import {openWebRelay} from './yuanbao-launch.js';
import {installGrokReader,captureGrokPage} from './grok.js';
import {installYouTubeReader,captureYouTubePage} from './youtube.js';
import {captureGeminiPage} from './capture.js';
import {parsePairing} from './pairing.js';
import {collectPageHistory} from './history.js';
import {uploadCapture} from './transfer.js';
const $=id=>document.getElementById(id);
let pairing,capture,requestId,readTab,pollTimer,readSource;
let reading=false;
const status=text=>{$('status').textContent=text;};
async function request(path,body={}) {
  if(!pairing)throw new Error('请先在应用的「网页账号」页复制配对信息');
  let response;
  try{response=await fetch(pairing.url+path,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pairing.token},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});}catch{throw new Error('无法连接本机应用，请先打开 AI Workbench 的「网页账号」页，确认连接码后重试');}
  const result=await response.json();if(!response.ok){const error=new Error(result.error||'保存失败');error.permanent=response.status<500;throw error;}return result;
}
async function action(id,fn){$(id).disabled=true;status('');try{await fn();}catch(error){status(error.message);}finally{$(id).disabled=false;}}
function pairingFeedback(){
  const raw=$('pairing').value;
  let valid=false;
  if(!raw)$('pairing-feedback').textContent='尚未粘贴配对信息。';
  else {
    try{parsePairing(raw);valid=true;}catch{}
    $('pairing-feedback').textContent=valid
      ?`已输入 ${raw.length} 个字符，配对格式正确，可以保存并检查连接。`
      :`已输入 ${raw.length} 个字符，配对信息不完整或格式不正确。请回到工作台点击「复制配对信息」，再全选此输入框并粘贴。`;
  }
  $('pair').disabled=!valid;
}
$('pairing').addEventListener('input',pairingFeedback);
$('show-pairing').onclick=()=>{
  const show=$('pairing').type==='password';
  $('pairing').type=show?'text':'password';
  $('show-pairing').textContent=show?'隐藏配对信息':'显示配对信息';
  $('show-pairing').setAttribute('aria-pressed',String(show));
};
pairingFeedback();
$('pair').onclick=async()=>{await action('pair',async()=>{
  const next=parsePairing($('pairing').value);
  pairing=next;await request('/status');
  await chrome.storage.local.set({pairing:next});
  $('pairing').value='';$('pairing-details').open=false;status('已连接本机 AI Workbench');
});pairingFeedback();};
function showDiagnostics(value){
  $('diagnostics-details').hidden=!value;
  $('diagnostics').value=value?JSON.stringify(value,null,2):'';
}
$('copy-diagnostics').onclick=async()=>{
  const value=$('diagnostics').value;if(!value)return;
  try{await navigator.clipboard.writeText(value);status('已复制读取诊断，不含对话正文。');}
  catch{$('diagnostics').focus();$('diagnostics').select();status('已选中读取诊断，请按 Ctrl+C 复制。');}
};
function showCapture(value){
  capture={...value,...browserSource(value.url)};requestId=value.captureId||crypto.randomUUID();
  showDiagnostics(value.diagnostics);
  $('title').value=capture.title||capture.product+' 对话';$('content').value=capture.content;
  $('scope').textContent=capture.scope;$('source').textContent=capture.url;$('preview').hidden=false;
  const messages=capture.content.split(/\n\n(?=我：|Gemini：|Grok：|YouTube：|未识别发言者：)/);
  $('ends').textContent='开头：'+messages[0].slice(0,120)+' …\n结尾：'+messages.at(-1).slice(-120);
}
function readingControls(active){
  reading=active;$('read').disabled=active;$('read-loaded').disabled=active;
  $('cancel-read').hidden=!active;
}
async function executeReader(tabId,func,args=[],stage='read'){
  let responses;
  try{responses=await chrome.scripting.executeScript({target:{tabId},func,args});}
  catch(error){
    showDiagnostics({readerVersion:'0.4.2',platform:readSource?.product,stage,scriptRejected:true});
    throw error;
  }
  const response=responses?.[0];
  if(!response?.result){
    showDiagnostics({readerVersion:'0.4.2',platform:readSource?.product,stage,hasFrameResult:!!response});
    throw new Error('读取脚本没有返回结果。请重新加载扩展并刷新对话页；仍失败时请提供下方读取诊断。');
  }
  return response.result;
}
async function targetTab(){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  try{readSource=browserSource(tab?.url);}catch{throw new Error('请先打开 Gemini、X 内 Grok 或带提问侧边栏的 YouTube 视频');}
  $('platform').textContent='网页对话助手 · '+(readSource.product==='Grok'?'Grok（X 内）':readSource.product);
  $('intro').textContent='使用你已经登录的 '+(readSource.product==='Grok'?'X／推特内 Grok':readSource.product)+'，不需要 API Key。';
  if(readSource.product==='Grok'){
    const installed=await executeReader(tab.id,installGrokReader,[],'install');
    if(!installed.ready)throw new Error('Grok 读取器未准备好，请刷新页面后重试');
  }
  if(readSource.product==='YouTube 提问'){
    $('intro').textContent='仅保存当前视频提问栏的问答和来源。关闭视频前请先读取并保存。';
    $('read-help').textContent='只滚动右侧提问面板，最长约 3 分钟。保持视频和提问栏打开，等待回答结束后读取；请核对首尾消息并保存，再关闭网页。';
    $('read-loaded').textContent='读取提问栏选中文字 / 已加载内容';
    const installed=await executeReader(tab.id,installYouTubeReader,[],'install');
    showDiagnostics(installed.diagnostics);if(!installed.ready)throw new Error(installed.error);
  }
  return tab.id;
}
async function historyCommand(command){
  return executeReader(readTab,collectPageHistory,[{command}],command);
}
async function showJob(job){
  clearTimeout(pollTimer);
  readingControls(job.phase==='running');
  if(job.phase==='running'){
    status(job.progress+'。可以关闭扩展面板，回到同一标签页重新打开后查看进度。请保持对话标签页可见，暂时不要切换对话或手动滚动。');
    pollTimer=setTimeout(async()=>{
      try{await showJob(await historyCommand('status'));}
      catch(error){readingControls(false);status(error.message);}
    },700);
  }else if(job.phase==='done'){
    showCapture(job.result);status('读取结束。请核对预览的开头、结尾和读取范围，再保存。');
  }else if(job.phase==='error'){
    showDiagnostics(job.diagnostics);status(job.error);
    if(job.code==='messages-not-found'&&readSource?.product==='Grok'){
      const partial=await executeReader(readTab,captureGrokPage,[],'fallback');
      if(partial?.content){
        showCapture({...partial,diagnostics:job.diagnostics});
        status('尚未识别逐条消息，未执行历史扫描。下面只预览当前已加载的内容，请核对并按需保存；也可以复制读取诊断继续排查。');
      }else if(partial?.error)status(job.error+' '+partial.error);
    }
  }
  else status('页面已切换或读取记录已失效，请重新读取。');
}
$('read').onclick=async()=>{
  clearTimeout(pollTimer);readingControls(true);capture=null;$('preview').hidden=true;
  status('正在准备加载历史…');
  try{readTab=await targetTab();await showJob(await historyCommand('start'));}
  catch(error){readingControls(false);status(error.message);}
};
$('cancel-read').onclick=async()=>{
  try{await historyCommand('cancel');status('正在停止读取，已收集的内容会保留在预览中…');}
  catch(error){status(error.message);}
};
$('read-loaded').onclick=()=>action('read-loaded',async()=>{
  readTab=await targetTab();
  capture=null;$('preview').hidden=true;
  const result=await executeReader(readTab,readSource.product==='YouTube 提问'?captureYouTubePage:readSource.product==='Grok'?captureGrokPage:captureGeminiPage,[],'loaded');
  if(result.phase==='error'){showDiagnostics(result.diagnostics);throw new Error(result.error);}
  showCapture(result);status('这是选中文字或当前已加载内容，可能不包含完整历史。请检查后保存。');
});
async function resumeHistory(){
  try{
    readTab=await targetTab();
    const job=await historyCommand('status');
    if(job.phase!=='idle')await showJob(job);
  }catch(error){if(readSource?.product==='YouTube 提问')status(error.message);} // Unrelated tabs remain quiet.
}
void resumeHistory();
for(const id of ['title','content','note'])$(id).addEventListener('input',()=>{requestId=crypto.randomUUID();});
$('save').onclick=()=>action('save',async()=>{
  if(!capture)throw new Error('请先读取当前对话');
  if(!$('title').value.trim()||!$('content').value.trim())throw new Error('标题和对话内容不能为空');
  const payload={requestId,product:capture.product,title:$('title').value,content:$('content').value,note:'读取范围：'+capture.scope+'\n\n'+$('note').value,url:capture.url};
  const controls=['read','read-loaded','title','content','note'];
  controls.forEach(id=>$(id).disabled=true);
  try{
    await uploadCapture(request,payload,(done,total)=>status('正在分批保存 '+done+' / '+total+'，请保持面板打开。中断后可再次点击保存继续。'));
  }finally{controls.forEach(id=>$(id).disabled=false);}
  status('已保存在 AI Workbench，可以回到应用查看、收藏和导出。');
});
chrome.storage.local.get('pairing').then(stored=>{
  if(stored.pairing){try{pairing=parsePairing(JSON.stringify({format:'awb-browser-v1',...stored.pairing}));$('pairing-details').open=false;if(!reading&&!capture)status('配对信息已保存，保持 AI Workbench 打开即可使用。');}catch{status('配对信息已失效，请重新连接');}}
}).catch(()=>status('无法读取扩展配置，请重新连接'));

chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>{
 let platform;try{platform=webChatSource(tab?.url);}catch{return;}
 const name=platform.name;
 $('yuanbao-connect').hidden=false;$('capture-controls').hidden=!['grok','gemini'].includes(platform.id);
 $('platform').textContent='网页对话助手 · '+(platform.id==='grok'?'Grok（X 内）':name);$('intro').textContent='使用已登录的'+name+'网页，在工作台提问并接回回答。';
 $('connect-yuanbao').textContent='连接'+name+'网页聊天';
 $('yuanbao-connect').querySelector('p').textContent='连接后回到工作台提问，回答自动保存。请保持连接页与'+name+'标签页打开。';
 $('connect-yuanbao').onclick=()=>action('connect-yuanbao',async()=>{
  if(!pairing)throw new Error('请先填写配对信息并连接本机应用');
  const result=await openWebRelay(chrome,tab.id,platform.id);
  status(result.reused?'已切换到已有连接页。如提示连接失效，请在该页点击「重新连接」。':'已打开'+name+'连接页，请查看连接结果；显示「已连接」后，再回工作台发送问题。');
 });
}).catch(()=>{});
