// UI only: execution is owned by the extension service worker.
export function startRelayPanel(){
 const $=id=>document.getElementById(id);let port=null,closed=false,connected=false;
 // Freeze the displayed snapshot while the user reads/selects it. Incoming
 // diagnostics keep updating in memory; this does not pause the worker.
 let latestDiagnostics=$('diagnostics').textContent,snapshotTime='';
 const refresh=document.createElement('button');refresh.type='button';refresh.className='secondary';refresh.textContent='刷新诊断';
 const hint=document.createElement('p');hint.setAttribute('role','status');
 $('diagnostics').before(refresh,hint);
 const showSnapshot=()=>{
  $('diagnostics').textContent=latestDiagnostics;snapshotTime=new Date().toLocaleTimeString();
  hint.textContent='诊断快照：'+snapshotTime+'。展开时固定显示，点击「刷新诊断」获取最新内容；连接和扫描继续运行。';
  $('copy-feedback').textContent='';
 };
 refresh.onclick=showSnapshot;
 $('diagnostics-details').addEventListener('toggle',showSnapshot);
 const fields=new Set(['status','source','diagnostics','connect','diagnostics-details']);
 const open=()=>{
  if(closed)return;
  if(port){port.postMessage({type:'connect'});return;}
  $('connect').disabled=true;
  port=chrome.runtime.connect({name:'awb-web-relay'});
  const current=port;
  port.onMessage.addListener(message=>{
   if(port!==current||message?.type!=='view')return;
   if(!fields.has(message.id)||!['textContent','disabled','open'].includes(message.property))return;
   if(message.id==='diagnostics'&&message.property==='textContent'){
    latestDiagnostics=message.value;
    if(!$('diagnostics-details').open)showSnapshot();
   }else $(message.id)[message.property]=message.value;
   connected=true;
  });
  port.onDisconnect.addListener(()=>{
   if(port!==current)return;port=null;connected=false;
   if(!closed){$('connect').disabled=false;$('status').textContent='扩展后台连接已停止，请点击重新连接；请先核对网页，问题不会自动重发。';}
  });
  port.postMessage({type:'visibility',visible:!document.hidden});
  port.postMessage({type:'start'});
 };
 $('connect').onclick=open;
 $('copy-diagnostics').onclick=async()=>{
  showSnapshot();const snapshot=$('diagnostics').textContent,copiedAt=snapshotTime;
  if(!snapshot){$('copy-feedback').textContent='尚未收到连接诊断，请稍后再复制。';return;}
  try{
  await navigator.clipboard.writeText(snapshot);
  $('copy-feedback').textContent='已复制最新诊断快照（'+copiedAt+'），不含对话正文和配对密钥。';
 }catch{$('copy-feedback').textContent='复制失败，请手动选中上方诊断文字复制。';}};
 window.addEventListener('pagehide',()=>{closed=true;port?.disconnect();port=null;},{once:true});
 document.addEventListener('visibilitychange',()=>{port?.postMessage({type:'visibility',visible:!document.hidden});if(!document.hidden)port?.postMessage({type:'snapshot'});});
 open();
}
