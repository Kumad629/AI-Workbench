
import test from 'node:test';
import assert from 'node:assert/strict';
import {installRelayWorker} from '../browser-extension/relay-worker.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn)=>{for(let i=0;i<120;i++){if(fn())return;await delay(50);}assert.fail('background condition timed out');};
const event=()=>{const listeners=[];return {addListener:fn=>listeners.push(fn),emit:value=>listeners.forEach(fn=>fn(value))};};
function setup(t){
 const onConnect=event(),ports=[],requests=[],commands=[];
 let scans=0,saved=false;
 const api={runtime:{id:'a'.repeat(32),getURL:p=>'chrome-extension://'+'a'.repeat(32)+p,onConnect},
  storage:{local:{get:async()=>({pairing:{url:'http://127.0.0.1:43129',token:'b'.repeat(64)}})}},
  scripting:{executeScript:async({args:[arg]})=>{
   commands.push(arg.command);
   if(arg.command.startsWith('history-scan')){
    scans++;return [{result:scans<3?{phase:'running',count:64,characters:42012,direction:'up',scrolls:scans}:
     {phase:'complete',count:64,characters:42012,reason:'boundaries-checked',url:'https://yuanbao.tencent.com/chat/test',messages:[{role:'user',content:'PRIVATE CONTENT'}],scan:{reason:'boundaries-checked'}}}];
   }
   return [{result:{url:'https://yuanbao.tencent.com/chat/test',ready:true,reason:'',diagnostics:{editor:true,sendButtonVisible:true}}}];
  }}};
 const previousChrome=globalThis.chrome,previousFetch=globalThis.fetch;
 globalThis.chrome=api;
 globalThis.fetch=async(url,options)=>{
  const body=JSON.parse(options.body),path=new URL(url).pathname;requests.push({path,body});
  let result;
  if(path.endsWith('/bind'))result={bindingId:'binding-test'};
  else if(path.endsWith('/history')){saved=true;result={accepted:true,added:64};}
  else result={job:null,historyRequest:saved?null:{id:'scan-test',url:'https://yuanbao.tencent.com/chat/test',scan:true},historyStatus:saved?{id:'scan-test',phase:'complete',message:'saved'}:null};
  return new Response(JSON.stringify(result),{status:200});
 };
 const worker=installRelayWorker(api);
 t.after(()=>{worker.dispose();globalThis.chrome=previousChrome;globalThis.fetch=previousFetch;});
 function open(provider='yuanbao',tab=10){
  const port={name:'awb-web-relay',sender:{id:api.runtime.id,url:api.runtime.getURL('/'+provider+'.html?tabId='+tab)},onMessage:event(),onDisconnect:event(),messages:[],disconnected:false,
   postMessage(m){this.messages.push(m);},disconnect(){if(!this.disconnected){this.disconnected=true;this.onDisconnect.emit();}}};
  onConnect.emit(port);ports.push(port);return port;
 }
 return {api,open,requests,commands,get saved(){return saved;}};
}
test('hidden connection panel does not drive background scanning; closing it stops scheduling',async t=>{
 const f=setup(t),p=f.open();
 p.onMessage.emit({type:'visibility',visible:false});p.onMessage.emit({type:'start'});
 await until(()=>f.commands.filter(c=>c.startsWith('history-scan')).length>=2);
 assert.equal(p.messages.length,0);assert.equal(f.saved,false);
 p.onMessage.emit({type:'visibility',visible:true});p.onMessage.emit({type:'snapshot'});
 const diag=p.messages.filter(m=>m.id==='diagnostics').at(-1);
 assert.equal(JSON.parse(diag.value).connection.runner,'service-worker');
 await until(()=>f.saved);
 assert.equal(f.requests.filter(r=>r.path.endsWith('/bind')).length,1);
 assert.equal(f.requests.filter(r=>r.path.endsWith('/history')).length,1);
 assert.doesNotMatch(JSON.stringify(p.messages),/PRIVATE CONTENT|bbbbbbbbbbbbbbbbbbbb/);
 p.disconnect();const n=f.requests.length;await delay(1300);assert.equal(f.requests.length,n);
});
test('worker derives platform and tab from its own panel URL; duplicate start cannot rebind',async t=>{
 const f=setup(t),p=f.open('doubao',12);
 p.onMessage.emit({type:'start',provider:'yuanbao',targetTabId:999});
 p.onMessage.emit({type:'start'});
 await until(()=>f.requests.some(r=>r.path.endsWith('/bind')));
 assert.equal(f.requests[0].body.provider,'doubao');
 assert.equal(f.requests.filter(r=>r.path.endsWith('/bind')).length,1);
 const invalid={name:'awb-web-relay',sender:{id:f.api.runtime.id,url:'https://example.org/yuanbao.html?tabId=10'},disconnect(){this.closed=true;}};
 f.api.runtime.onConnect.emit(invalid);assert.equal(invalid.closed,true);
 p.disconnect();
});
test('disposing during page read prevents further requests and does not start a new executor',async t=>{
 const f=setup(t);let release;
 f.api.scripting.executeScript=()=>new Promise(resolve=>release=()=>resolve([{result:{url:'https://yuanbao.tencent.com/chat/test',ready:true}}]));
 const p=f.open();p.onMessage.emit({type:'start'});await until(()=>!!release);
 p.disconnect();release();await delay(50);
 assert.equal(f.requests.length,0);
 p.onMessage.emit({type:'connect'});await delay(50);assert.equal(f.requests.length,0);
});


for(const provider of ['chatgpt','gemini'])test(provider+' worker selects its adapter from panel URL and disables unsupported scan/images',async t=>{
 const f=setup(t);let call;f.api.scripting.executeScript=async request=>{call=request;return [{result:{url:provider==='chatgpt'?'https://chatgpt.com/c/test':'https://gemini.google.com/app/test',ready:true,diagnostics:{}}}];};
 const port=f.open(provider,21);port.onMessage.emit({type:'start',provider:'yuanbao',targetTabId:999});await until(()=>f.requests.some(r=>r.path.endsWith('/bind')));
 assert.equal(call.func.name,'standardChatCommand');assert.equal(call.target.tabId,21);assert.equal(call.args[0].provider,provider);const bind=f.requests.find(r=>r.path.endsWith('/bind')).body;assert.equal(bind.provider,provider);assert.equal(bind.imageEnabled,false);assert.equal(bind.historyScanEnabled,false);port.disconnect();
});
