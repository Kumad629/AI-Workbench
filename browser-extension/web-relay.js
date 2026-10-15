import {installGrokReader} from './grok.js';
import {parsePairing} from './pairing.js';
import {prepareWebImages} from './image-upload.js';
import {startRelayPanel} from './web-relay-panel.js';
export function startWebRelay({reader,provider,name,panel,targetTabId}){
if(!panel&&globalThis.chrome?.runtime?.connect)return startRelayPanel();
const $=id=>panel?panel[id]:document.getElementById(id);
const tabId=targetTabId??Number(new URL(location.href).searchParams.get('tabId'));
const clientId=crypto.randomUUID();
let pairing,bindingId,job,sequence=0,pending=null,running=false,timer,disposed=false;
let pageDiagnostics={};
const connection={relayVersion:'0.12.0',runner:panel?'service-worker':'local-test',stage:'starting',pairingConfigured:false,bindingEstablished:false,desktopReachable:null,httpStatus:null,status:'正在连接…',lastError:'',failedStage:'',lastFailureAt:''};
let historyProblem='',scanTask=null,scanProgress=null,lastPollAt=0;
async function cancelScan(phase='cancelled',reason='scan-cancelled'){if(scanTask)try{await command({command:'history-scan-cancel',requestId:scanTask});}catch{}if(connection.scan)connection.scan={...connection.scan,phase,reason};scanTask=null;scanProgress=null;}
const safeError=value=>String(value||'未知错误').replace(/https?:\/\/[^\s，。]+/g,'[地址]').replace(/[a-f0-9]{64}/gi,'[已隐藏]').slice(0,500);
const renderDiagnostics=()=>{$('diagnostics').textContent=JSON.stringify({...pageDiagnostics,connection},null,2);};
const stage=value=>{connection.stage=value;renderDiagnostics();};
const say=s=>{$('status').textContent=s;connection.status=safeError(s);renderDiagnostics();};
const fail=e=>{connection.lastError=safeError(e.message);connection.failedStage=connection.stage;connection.lastFailureAt=new Date().toISOString();renderDiagnostics();$('diagnostics-details').open=true;};
const diagnose=probe=>{pageDiagnostics=probe.diagnostics||{};renderDiagnostics();if(!probe.diagnostics?.editor||!probe.diagnostics?.sendButtonVisible)$('diagnostics-details').open=true;};
async function request(path,body){
 if(disposed)throw new Error('连接页已关闭');
 stage('desktop:'+path);connection.httpStatus=null;
 let r;
 try{r=await fetch(pairing.url+'/web-chat/'+path,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pairing.token},body:JSON.stringify({clientId,bindingId,...body,provider}),signal:AbortSignal.timeout(8000)});}
 catch(e){connection.desktopReachable=false;throw new Error(e.name==='TimeoutError'?'工作台连接超时，请确认工作台仍在运行':'无法访问本机工作台，请确认工作台已打开；重启后仍失败，请从工作台重新复制配对信息');}
 connection.desktopReachable=true;connection.httpStatus=r.status;renderDiagnostics();
 let data;try{data=await r.json();}catch{throw new Error('本机地址返回了无法识别的内容，请从工作台重新配对');}
 if(!r.ok){const e=new Error(data.error||'工作台请求失败（'+r.status+'）');e.permanent=true;e.code=data.code;throw e;}return data;
}
async function command(args){
 stage('page:'+args.command);
 if(disposed)throw new Error('连接页已关闭');
 if(!Number.isInteger(tabId)||tabId<0)throw new Error(`目标标签页无效，请回到${name}点击扩展连接`);
 const started=Date.now();
 connection.pageCommand={name:args.command,startedAt:new Date(started).toISOString(),pending:true};renderDiagnostics();
 try{
  if(provider==='grok')await chrome.scripting.executeScript({target:{tabId},func:installGrokReader});
  const response=await chrome.scripting.executeScript({target:{tabId},func:args.command==='prepare-images'?prepareWebImages:reader,args:[{...args,provider}]});
  if(!response[0]?.result)throw new Error(`${name}读取器没有返回结果`);
  return response[0].result;
 }finally{
  const durationMs=Date.now()-started;
  connection.pageCommand={name:args.command,startedAt:new Date(started).toISOString(),pending:false,durationMs};
  if(durationMs>=(connection.slowestPageCommand?.durationMs||0))connection.slowestPageCommand={name:args.command,durationMs};
  renderDiagnostics();
 }
}
async function connect(){
 if(running||disposed)return;
 clearTimeout(timer);running=true;$('connect').disabled=true;
 try{
  await cancelScan();historyProblem='';delete connection.history;delete connection.scan;
  connection.bindingEstablished=false;connection.pairingConfigured=false;connection.lastError='';connection.failedStage='';connection.lastFailureAt='';connection.desktopReachable=null;connection.httpStatus=null;
  stage('pairing');
  const stored=await chrome.storage.local.get('pairing');
  pairing=parsePairing(JSON.stringify({format:'awb-browser-v1',...stored.pairing}));
  connection.pairingConfigured=true;
  const probe=await command({command:'probe'});
  $('source').textContent=probe.url;diagnose(probe);
  ({bindingId}=await request('bind',{...probe,historyEnabled:true,historyScanEnabled:['yuanbao','doubao'].includes(provider),imageEnabled:['yuanbao','doubao'].includes(provider)}));
  connection.bindingEstablished=true;
  await command({command:'release'});job=null;pending=null;sequence=0;
  say(probe.ready?'已连接，正在同步网页已加载的历史…':probe.reason);
  if(!disposed)timer=setTimeout(tick,1000);
 }catch(e){fail(e);say('连接未完成：'+e.message+`。请确认工作台已打开、扩展已配对，并在${name}页重新点击扩展。`);}
 finally{running=false;$('connect').disabled=false;}
}
async function tick(){
 if(running||disposed)return;running=true;$('connect').disabled=true;
 let retry=true;
 try{
  const probe=await command({command:'probe'});
  diagnose(probe);
  const result=await request('poll',{...probe,jobId:job?.id,historyProgress:scanProgress});
  if(result.cancelled){await command({command:'cancel',jobId:job.id,url:job.url});job=null;pending=null;say(result.finishedState==='complete'?'回答已保存。':`已停止接收，请到${name}查看是否仍在生成。`);}
  const now=Date.now();connection.lastPollAt=new Date(now).toISOString();
  if(lastPollAt)connection.maxPollGapMs=Math.max(connection.maxPollGapMs||0,now-lastPollAt);lastPollAt=now;
  if(scanTask&&(!result.historyRequest||result.historyRequest.id!==scanTask)){
    const terminal=result.historyStatus?.id===scanTask?result.historyStatus:null;
    await cancelScan(terminal?.phase||'interrupted',terminal?.code||'desktop-task-ended');
    if(terminal?.phase==='cancelled'){historyProblem='';say(terminal.message);return;}
    if(terminal?.phase!=='complete'){
      historyProblem=terminal?.message||'扫描任务已在工作台结束，本次结果未确认保存，请重新扫描';
      connection.history={accepted:false,code:terminal?.code||'HISTORY_INTERRUPTED'};
      fail(new Error(historyProblem));say('已连接，但扫描已中断：'+historyProblem);return;
    }
  }
  if(result.historyRequest&&result.historyRequest.id!==scanTask){historyProblem='';connection.lastError='';connection.failedStage='';connection.lastFailureAt='';delete connection.history;}

  if(result.historyRequest&&!job){
   const task=result.historyRequest;
   let capture;
   try{
    if(task.scan){
      const first=scanTask!==task.id;scanTask=task.id;
      const progress=await command({command:first?'history-scan-start':'history-scan-tick',requestId:task.id,url:task.url});
      scanProgress={requestId:task.id,count:progress.count||0,characters:progress.characters||0,direction:progress.direction};
      connection.scan={...scanProgress,requestId:undefined,phase:progress.phase,scrolls:progress.scrolls,reason:progress.reason,alignment:progress.alignment||null,scroll:progress.scroll||null};
      if(progress.phase==='running'&&progress.alignment?.method==='waiting'){say('网页消息正在重新加载，暂停滚动并等待重读，已收集 '+progress.count+' 条消息。');return;}
      if(progress.phase==='running'){say('正在自动'+(progress.direction==='down'?'向下检查':'向上加载')+'历史，已收集 '+progress.count+` 条消息。请保持${name}页面可见；可在工作台停止。`);return;}
      capture=progress.phase==='complete'?{url:progress.url,messages:progress.messages,scan:progress.scan}:{url:task.url,messages:[],error:progress.error||'扫描已停止，请重新开始'};
    }else capture=await command({command:'history',url:task.url});
   }catch{capture={url:task.url,messages:[],error:`网页历史读取失败，请在${name}页面重新点击扩展连接`};}
   // Keep the completed scanner result until the desktop acknowledges it.

   const saved=await request('history',{requestId:task.id,...capture});
   scanTask=null;scanProgress=null;
   if(connection.scan&&task.scan)connection.scan={...connection.scan,phase:saved.accepted?'complete':'failed',reason:saved.code||connection.scan.reason};
   connection.history={accepted:saved.accepted,added:saved.added,imagePreviews:saved.imagePreviews,remoteImagePreviews:saved.remoteImagePreviews,retainedDifferences:saved.retainedDifferences,recoveredAnswers:saved.recoveredAnswers,code:saved.code,diagnostics:saved.diagnostics};
   historyProblem=saved.accepted?'':saved.error||'网页历史同步失败';
   if(!saved.accepted)fail(new Error(historyProblem));
   else{connection.lastError='';connection.failedStage='';connection.lastFailureAt='';}
   say(saved.accepted?(saved.message||'网页已加载的历史已同步，可以回到工作台查看。'):'已连接，但历史同步失败：'+historyProblem);
   return;
  }
  if(result.job){
   job=result.job;sequence=0;
   // begin is executed exactly once. Never retry it after an uncertain browser response.
   let event;
   try{
    const upload=job.images?.length?await command({command:'prepare-images',provider,job}):{ok:true};
    if(upload.ok&&job.images?.length){
      // Upload can take seconds. Recheck cancellation without claiming another queued job.
      const ack=await request('report',{jobId:job.id,lease:job.lease,sequence:++sequence,phase:'waiting',content:'',url:job.url});
      if(!ack.accepted){job=null;pending=null;say('任务已停止，图片未发送；请在原网页检查已上传的附件。');return;}
    }
    event=upload.ok?await command({command:'begin',job}):{phase:'failed',content:'',url:job.url,error:upload.error};
   }catch{event={phase:'failed',content:'',url:job.url,error:`发送状态不确定，请检查${name}网页；不会自动重发`};}
   pending={...event,jobId:job.id,lease:job.lease,sequence:++sequence};
  }
  if(job&&!pending){
   let event;
   try{event=await command({command:'tick',jobId:job.id,url:job.url});}catch{event={phase:'failed',content:'',url:job.url,error:`${name}页面不可访问，请核对网页；不会自动重发`};}
   pending={...event,jobId:job.id,lease:job.lease,sequence:++sequence};
  }
  if(pending){
   const event=pending,ack=await request('report',event);pending=null;
   if(!ack.accepted||['failed','complete'].includes(event.phase)){say(event.phase==='complete'?'回答已保存。可以在工作台继续提问。':event.error||'任务已停止');job=null;}
   else say(event.phase==='waiting'?`问题已交给${name}，正在等待回答…`:`正在把${name}回答保存到工作台…`);
  }else if(!job)say(!probe.ready?probe.reason:historyProblem?'已连接，但历史同步失败：'+historyProblem+'。请回工作台查看同步提示。':probe.note||'已连接。现在可以回到工作台发送问题。');
 }catch(e){
  fail(e);
  say('连接暂不可用：'+e.message+'。请保留页面；问题不会自动重发。');
  if(e.permanent){await cancelScan();retry=false;connection.bindingEstablished=false;say(e.code==='WEB_CHAT_REPLACED'?e.message:e.message+'。请点击「重新连接」。');}
 }finally{running=false;$('connect').disabled=false;if(retry&&!disposed)timer=setTimeout(tick,1000);}
}
$('copy-diagnostics').onclick=async()=>{try{await navigator.clipboard.writeText($('diagnostics').textContent);$('copy-feedback').textContent='已复制连接诊断，不含对话正文和配对密钥。';}catch{$('copy-feedback').textContent='复制失败，请手动选中上方诊断文字复制。';}};
$('connect').onclick=connect;
void connect();
return {connect,dispose(){disposed=true;clearTimeout(timer);}};
}
