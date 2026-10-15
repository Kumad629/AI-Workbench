import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../electron/store.mjs';
import {Engine,buildContext,markdownExport} from '../electron/engine.mjs';
import {parseSSE,streamCompletion,validateEndpoint} from '../electron/provider.mjs';
import {createServer} from 'node:http';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function idle(engine) {for(let i=0;i<300;i++){if(!engine.running.size)return;await delay(10);}throw new Error('Test timed out waiting for runs');}
function setup(t,transport) {
  const dir=mkdtempSync(join(tmpdir(),'workbench-core-'));
  const store=new Store(dir);
  const vault={encrypt:value=>Buffer.from(value).toString('base64'),decrypt:value=>Buffer.from(value,'base64').toString()};
  const engine=new Engine(store,vault,()=>{},transport);
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  const connection=(name,model=name)=>engine.saveConnection({name,provider:name,model,baseUrl:'https://example.com/v1',apiKey:'test-secret-'+name});
  return {engine,store,dir,vault,connection};
}
test('group sends concurrently with independent contexts; targeted messages stay private',async t=>{
  const calls=[];let inFlight=0,maxInFlight=0;
  const {engine,store,connection}=setup(t,async(c,k,messages,signal,emit)=>{calls.push({name:c.name,messages});inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);await delay(20);emit({delta:c.name+'-reply'});inFlight--;});
  const a=connection('A'),b=connection('B');
  const conversationId=engine.createConversation({mode:'group',connectionIds:[a,b]});
  engine.send({conversationId,content:'shared question'});await idle(engine);
  assert.equal(maxInFlight,2);
  engine.send({conversationId,content:'follow up'});await idle(engine);
  assert.deepEqual(calls[2].messages.map(m=>m.content),['shared question','A-reply','follow up']);
  assert.deepEqual(calls[3].messages.map(m=>m.content),['shared question','B-reply','follow up']);
  engine.send({conversationId,content:'A only',targetIds:[a]});await idle(engine);
  engine.send({conversationId,content:'everyone again'});await idle(engine);
  assert.ok(!calls.at(-1).messages.some(m=>m.content==='A only'));
  assert.equal(store.get('conversation',conversationId).messages.filter(m=>m.role==='assistant').length,7);
});
test('one failed stream does not block another; retry preserves originals and exact context',async t=>{
  let fail=true;
  const {engine,store,connection}=setup(t,async(c,k,messages,signal,emit)=>{if(c.name==='B'&&fail){emit({delta:'partial'});throw new Error('expected failure');}emit({delta:c.name+' done'});});
  const a=connection('A'),b=connection('B'),conversationId=engine.createConversation({mode:'group',connectionIds:[a,b]});
  engine.send({conversationId,content:'hello'});await idle(engine);
  const before=store.get('conversation',conversationId);
  assert.equal(before.messages[1].status,'complete');
  assert.equal(before.messages[2].status,'failed');
  assert.equal(before.messages[2].content,'partial');
  fail=false;
  const retryId=engine.retry({conversationId,messageId:before.messages[2].id});await idle(engine);
  const after=store.get('conversation',conversationId);
  assert.equal(after.messages.length,4);
  assert.equal(after.messages[2].status,'failed');
  assert.equal(after.messages[3].id,retryId);
  assert.deepEqual(after.messages[3].context,before.messages[2].context);
  engine.send({conversationId,content:'next'});await idle(engine);
  const reply=store.get('conversation',conversationId).messages.at(-1);
  assert.deepEqual(reply.context.map(m=>m.content),['hello','B done','next']);
});
test('cancellation is per answer and retains partial content',async t=>{
  const {engine,store,connection}=setup(t,async(c,k,messages,signal,emit)=>{
    emit({delta:'partial '+c.name});
    if(c.name==='A')await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
    else {await delay(25);emit({delta:' finished'});}
  });
  const a=connection('A'),b=connection('B'),conversationId=engine.createConversation({mode:'group',connectionIds:[a,b]});
  engine.send({conversationId,content:'test'});
  const reply=store.get('conversation',conversationId).messages.find(m=>m.connectionId===a);
  engine.cancel({messageId:reply.id});await idle(engine);
  const c=store.get('conversation',conversationId);
  assert.equal(c.messages[1].status,'cancelled');assert.match(c.messages[1].content,/partial/);
  assert.equal(c.messages[2].status,'complete');
});
test('single chat switches models with history; new prompt only can omit history',async t=>{
  const seen=[];
  const {engine,connection}=setup(t,async(c,k,messages,signal,emit)=>{seen.push(messages);emit({delta:c.name});});
  const a=connection('A'),b=connection('B'),conversationId=engine.createConversation({connectionIds:[a]});
  engine.send({conversationId,content:'first'});await idle(engine);
  engine.updateConversation({id:conversationId,connectionIds:[b]});
  engine.send({conversationId,content:'second'});await idle(engine);
  assert.deepEqual(seen[1].map(m=>m.content),['first','A','second']);
  engine.send({conversationId,content:'fresh',history:false});await idle(engine);
  assert.deepEqual(seen[2],[{role:'user',content:'fresh'}]);
});
test('branch, excerpts, persistence and credential-free JSON round trip',async t=>{
  const {engine,store,dir,vault,connection}=setup(t,async(c,k,messages,signal,emit)=>emit({delta:'An idea worth saving'}));
  const a=connection('DeepSeek'),conversationId=engine.createConversation({connectionIds:[a]});
  engine.send({conversationId,content:'brainstorm'});await idle(engine);
  const original=store.get('conversation',conversationId),reply=original.messages[1];
  engine.saveExcerpt({conversationId,messageId:reply.id,title:'Project idea',content:'idea worth saving',note:'Build this later',tags:['project']});
  const forkId=engine.branch({conversationId,messageId:reply.id});
  const fork=store.get('conversation',forkId);
  assert.notEqual(fork.messages[0].id,original.messages[0].id);
  assert.equal(fork.messages[1].replyTo,fork.messages[0].id);
  assert.equal(fork.sourceId,original.id);
  assert.equal(store.get('conversation',conversationId).messages.length,2);
  const exported=engine.exportData(conversationId);
  assert.ok(!JSON.stringify(exported).includes('test-secret'));
  assert.ok(!JSON.stringify(engine.snapshot()).includes('test-secret'));
  assert.match(markdownExport(exported.conversation,exported.excerpts),/Build this later/);
  const importedId=engine.importData(JSON.parse(JSON.stringify(exported)));
  assert.equal(store.get('conversation',importedId).connectionIds.length,0);
  assert.equal(store.all('excerpt').filter(e=>e.conversationId===importedId).length,1);
  const secondStore=new Store(dir);
  const reopened=new Engine(secondStore,vault);
  assert.equal(reopened.snapshot().conversations.length,3);secondStore.close();
  const corrupt=structuredClone(exported);corrupt.excerpts[0].messageId='missing';
  const count=engine.snapshot().conversations.length;
  assert.throws(()=>engine.importData(corrupt),/缺少原消息/);
  assert.equal(engine.snapshot().conversations.length,count);
});
test('unexpected shutdown marks pending answers interrupted on recovery',t=>{
  const {store,vault}=setup(t);
  store.put('conversation',{id:'recovery',updatedAt:'2026-01-01',messages:[{id:'partial',status:'streaming',content:'saved partial'}]});
  const restored=new Engine(store,vault);
  assert.equal(restored.snapshot().conversations[0].messages[0].status,'interrupted');
  assert.equal(restored.snapshot().conversations[0].messages[0].content,'saved partial');
});
test('endpoint changes require a new key; unsafe endpoints rejected',t=>{
  const {engine,connection}=setup(t);
  const id=connection('A');
  assert.throws(()=>engine.saveConnection({id,name:'A',provider:'A',model:'A',baseUrl:'https://other.example.com'}),/重新填写密钥/);
  assert.throws(()=>validateEndpoint('http://remote.example.com'),/HTTPS/);
  assert.throws(()=>validateEndpoint('https://user:pass@example.com'),/凭据/);
  assert.equal(validateEndpoint('http://127.0.0.1:5555/v1/'),'http://127.0.0.1:5555/v1');
});
test('SSE parser handles split UTF8, CRLF, comments and final unterminated event',async()=>{
  const encoded=new TextEncoder().encode(': keepalive\r\n\r\ndata: {"text":"你好"}\r\n\r\ndata: [DONE]');
  const body=new ReadableStream({start(controller){for(let i=0;i<encoded.length;i+=3)controller.enqueue(encoded.slice(i,i+3));controller.close();}});
  const events=[];for await(const event of parseSSE(body))events.push(event);
  assert.deepEqual(events,['{"text":"你好"}','[DONE]']);
});
test('real HTTP transport rejects truncated streams and sanitizes provider errors',async t=>{
  let mode='normal';let captured;
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;captured=JSON.parse(body);
    if(mode==='error'){res.writeHead(401);res.end('SECRET SHOULD NOT BE STORED');return;}
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.write('data: '+JSON.stringify({choices:[{delta:{content:'你好'}}]})+'\n\n');
    if(mode==='normal')res.write('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{total_tokens:9}})+'\n\ndata: [DONE]\n\n');
    res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const connection={baseUrl:'http://127.0.0.1:'+server.address().port,model:'fixture'};
  const events=[];
  await streamCompletion(connection,'not-real',[{role:'user',content:'test'}],AbortSignal.timeout(2000),e=>events.push(e));
  assert.equal(captured.stream,true);assert.equal(events[0].delta,'你好');
  assert.ok(events.some(e=>e.usage?.total_tokens===9));
  mode='truncated';
  await assert.rejects(()=>streamCompletion(connection,'not-real',[],AbortSignal.timeout(2000),()=>{}),/提前断开/);
  mode='error';
  await assert.rejects(()=>streamCompletion(connection,'not-real',[],AbortSignal.timeout(2000),()=>{}),error=>error.message.includes('401')&&!error.message.includes('SECRET'));
});

test('external Grok transcript preserves provenance, drafts and raw text across JSON export/import',t=>{
  const {engine,store}=setup(t);
  const raw='我：这个观点有什么启发？\n\nGrok：可以做一个小实验。';
  const conversationId=engine.importTranscript({title:'项目灵感',product:'Grok',content:raw,urls:['https://x.com/example/status/123'],note:'目标：验证想法'});
  const c=store.get('conversation',conversationId);
  assert.equal(c.messages[1].content,raw);
  assert.equal(c.messages[1].isTranscript,true);
  assert.equal(c.source.product,'Grok');
  assert.equal(c.source.note,'目标：验证想法');
  assert.equal(c.connectionIds.length,0);
  const bundle=engine.exportData(conversationId);
  const markdown=markdownExport(bundle.conversation);
  assert.match(markdown,/https:\/\/x.com\/example\/status\/123/);
  assert.match(markdown,/目标：验证想法/);
  assert.match(markdown,/原文存档/);
  const imported=store.get('conversation',engine.importData(bundle));
  assert.equal(imported.messages[1].content,raw);
  assert.deepEqual(imported.source.urls,c.source.urls);
  const message={id:'followup',role:'user',content:'继续讨论',status:'complete'};
  c.messages.push(message);
  const context=buildContext(c,'new-model','followup');
  assert.equal(context[1].role,'user');
  assert.match(context[1].content,/外部对话原文/);
});
test('external transcript rejects unsafe links before writing data',t=>{
  const {engine}=setup(t);
  assert.throws(()=>engine.importTranscript({title:'bad',content:'text',urls:['javascript:alert(1)']}),/来源只支持/);
  assert.equal(engine.snapshot().conversations.length,0);
});

test('failed member can retry while another is streaming; historical retries stay in turn order',async t=>{
  let aCalls=0,releaseB;
  const {engine,store,connection}=setup(t,async(c,k,messages,signal,emit)=>{
    if(c.name==='A'){aCalls++;if(aCalls===1)throw new Error('try again');emit({delta:'A '+aCalls});}
    else {await new Promise(resolve=>{releaseB=resolve;});emit({delta:'B answer'});}
  });
  const a=connection('A'),b=connection('B'),conversationId=engine.createConversation({mode:'group',connectionIds:[a,b]});
  engine.send({conversationId,content:'question 1'});await delay(10);
  const original=store.get('conversation',conversationId).messages.find(m=>m.connectionId===a);
  assert.equal(original.status,'failed');assert.equal(engine.running.size,1);
  engine.retry({conversationId,messageId:original.id});await delay(10);
  assert.equal(store.get('conversation',conversationId).messages.at(-1).status,'complete');
  releaseB();await idle(engine);
  engine.updateConversation({id:conversationId,connectionIds:[a]});
  engine.send({conversationId,content:'question 2'});await idle(engine);
  engine.retry({conversationId,messageId:original.id});await idle(engine);
  engine.send({conversationId,content:'question 3'});await idle(engine);
  const context=store.get('conversation',conversationId).messages.at(-1).context;
  assert.deepEqual(context.map(m=>m.content),['question 1','A 4','question 2','A 3','question 3']);
});

import {BrowserBridge} from '../electron/browser-bridge.mjs';
import {parsePairing} from '../browser-extension/pairing.js';
import {captureGeminiPage} from '../browser-extension/capture.js';

test('browser bridge requires pairing, restricts origins, imports Gemini and deduplicates retries',async t=>{
  const {engine,store}=setup(t);let token='a'.repeat(64);const imported=[];
  const bridge=new BrowserBridge({getToken:()=>token,importTranscript:input=>engine.importTranscript(input),onImport:id=>imported.push(id)});
  const url=await bridge.start();t.after(()=>bridge.close());
  const post=(path,body,headers={})=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...headers},body:JSON.stringify(body)});
  assert.equal((await post('/status',{}, {Authorization:'Bearer invalid'})).status,401);
  assert.equal((await post('/status',{}, {Origin:'https://gemini.google.com'})).status,403);
  assert.equal((await post('/status',{}, {Origin:'chrome-extension://'+'a'.repeat(32)})).status,200);
  const payload={requestId:'capture-example-001',title:'Gemini project notes',content:'Me: idea\nGemini: try a prototype',url:'https://gemini.google.com/app/example?tracking=1',note:'Keep this'};
  const result=await(await post('/capture',payload)).json();assert.equal(result.ok,true);
  assert.equal(imported[0],result.conversationId);
  const saved=store.get('conversation',result.conversationId);
  assert.equal(saved.source.product,'Gemini');assert.equal(saved.source.urls[0],'https://gemini.google.com/app/example');
  const duplicate=await(await post('/capture',payload)).json();assert.equal(duplicate.conversationId,result.conversationId);
  assert.equal(engine.snapshot().conversations.length,1);
  assert.ok(!JSON.stringify(engine.snapshot()).includes(token));
  assert.equal((await post('/capture',{...payload,requestId:'capture-example-002',url:'https://evil.example/app/1'})).status,400);
  assert.equal((await post('/capture',{...payload,requestId:'capture-example-003',url:'https://gemini.google.com/account'})).status,400);
  const old=token;token='b'.repeat(64);
  assert.equal((await post('/status',{}, {Authorization:'Bearer '+old})).status,401);
  assert.equal((await post('/status',{})).status,200);
});
test('extension pairing rejects nonlocal addresses and malformed credentials',()=>{
  const token='c'.repeat(64);
  assert.deepEqual(parsePairing(JSON.stringify({format:'awb-browser-v1',url:'http://127.0.0.1:43129',token})),{url:'http://127.0.0.1:43129',token});
  for(const url of ['http://evil.example:43129','https://127.0.0.1:43129','http://user:pass@127.0.0.1:43129','http://127.0.0.1:43129/steal','http://127.0.0.1:43129/?secret=x']){
    assert.throws(()=>parsePairing(JSON.stringify({format:'awb-browser-v1',url,token})),/只允许/);
  }
  assert.throws(()=>parsePairing('{}'));
});
test('Gemini extraction prefers selected text; otherwise keeps loaded speaker order',t=>{
  const previous={window:globalThis.window,document:globalThis.document,location:globalThis.location};
  t.after(()=>{for(const [k,v]of Object.entries(previous)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}});
  let selection='Chosen paragraph';
  globalThis.window={getSelection:()=>({toString:()=>selection})};
  globalThis.location={href:'https://gemini.google.com/app/example'};
  globalThis.document={title:'Ideas - Google Gemini',querySelectorAll:()=>[
    {tagName:'USER-QUERY',innerText:'Question',getClientRects:()=>[{}]},
    {tagName:'MODEL-RESPONSE',innerText:'Answer',getClientRects:()=>[{}]},
    {tagName:'MODEL-RESPONSE',innerText:'Hidden',getClientRects:()=>[]}
  ]};
  assert.equal(captureGeminiPage().content,'Chosen paragraph');
  selection='';const captured=captureGeminiPage();
  assert.equal(captured.content,'我：\nQuestion\n\nGemini：\nAnswer');
  assert.equal(captured.title,'Ideas');
  globalThis.document.querySelectorAll=()=>[];
  globalThis.document.querySelector=()=>({innerText:'Fallback readable main content'});
  assert.match(captureGeminiPage().scope,/未识别/);
  globalThis.document.querySelector=()=>null;
  assert.throws(()=>captureGeminiPage(),/没有读到/);
});


test('pin order survives restart and branches start unpinned',t=>{
 const {engine,store,vault}=setup(t);
 const a=engine.importTranscript({title:'A',content:'answer',product:'Grok'}),b=engine.createConversation();
 engine.updateConversation({id:a,pinned:true});engine.updateConversation({id:b,title:'newer'});
 assert.equal(engine.snapshot().conversations[0].id,a);
 const timestamp=store.get('conversation',a).pinnedAt;engine.updateConversation({id:a,title:'renamed'});
 assert.equal(store.get('conversation',a).pinnedAt,timestamp);
 assert.equal(new Engine(store,vault).snapshot().conversations[0].id,a);
 const branch=engine.branch({conversationId:a,messageId:store.get('conversation',a).messages.at(-1).id});
 assert.equal(store.get('conversation',branch).pinned,false);
 engine.updateConversation({id:a,pinned:false});assert.equal(store.get('conversation',a).pinnedAt,undefined);
});

test('deletion removes only its conversation, excerpts and terminal jobs atomically',t=>{
 const {engine,store}=setup(t);
 const a=engine.importTranscript({title:'A',content:'answer'}),b=engine.importTranscript({title:'B',content:'other'});
 const excerpt=id=>engine.saveExcerpt({conversationId:id,messageId:store.get('conversation',id).messages.at(-1).id,content:store.get('conversation',id).messages.at(-1).content,title:'saved',note:'private'});
 const ea=excerpt(a),eb=excerpt(b);
 store.put('webJob',{id:'job-a',conversationId:a,state:'complete'});store.put('webJob',{id:'job-b',conversationId:b,state:'complete'});
 const remove=store.remove.bind(store);
 store.remove=(kind,id)=>{if(kind==='conversation')throw Error('fixture write failure');remove(kind,id);};
 assert.throws(()=>engine.deleteConversation({id:a}),/fixture/);
 assert.ok(store.get('excerpt',ea));assert.ok(store.get('webJob','job-a'));store.remove=remove;
 assert.equal(engine.deleteConversation({id:a}).deletedExcerpts,1);
 assert.throws(()=>store.get('conversation',a));assert.throws(()=>store.get('excerpt',ea));assert.throws(()=>store.get('webJob','job-a'));
 assert.ok(store.get('conversation',b));assert.ok(store.get('excerpt',eb));assert.ok(store.get('webJob','job-b'));
});

test('deleting active API or web jobs is rejected until they finish',async t=>{
 let release;const done=new Promise(r=>release=r);
 const {engine,store,connection}=setup(t,async()=>done);
 const a=engine.createConversation({connectionIds:[connection('A')]});
 engine.send({conversationId:a,content:'question'});assert.throws(()=>engine.deleteConversation({id:a}),/停止/);
 release();await idle(engine);
 store.put('webJob',{id:'pending',conversationId:a,state:'queued'});assert.throws(()=>engine.deleteConversation({id:a}),/停止/);
 store.put('webJob',{id:'pending',conversationId:a,state:'cancelled'});assert.equal(engine.deleteConversation({id:a}).id,a);
});

test('share excludes notes and context by default, preserves full text and validates source URLs',t=>{
 const {engine,store}=setup(t);
 const id=engine.importTranscript({title:'share',content:'body '.repeat(3000),product:'Grok',urls:['https://x.com/i/grok?conversation=fixture'],note:'PRIVATE_SOURCE'});
 const c=store.get('conversation',id);c.messages.at(-1).context=[{content:'PRIVATE_CONTEXT'}];store.put('conversation',c);
 engine.saveExcerpt({conversationId:id,messageId:c.messages.at(-1).id,content:'body',title:'saved',note:'PRIVATE_EXCERPT'});
 const data=engine.conversationShare({conversationId:id});assert.equal(data.preview.length,12000);assert.equal(data.truncated,true);
 const plain=engine.shareMarkdown({conversationId:id});assert.equal(plain.length,data.characters);assert.doesNotMatch(plain,/PRIVATE_/);
 const notes=engine.shareMarkdown({conversationId:id,includeNotes:true});
 assert.match(notes,/PRIVATE_SOURCE/);assert.match(notes,/PRIVATE_EXCERPT/);assert.doesNotMatch(notes,/PRIVATE_CONTEXT/);
 assert.equal(engine.conversationSource({conversationId:id}),c.source.urls[0]);
 c.source.urls=['javascript:alert(1)'];store.put('conversation',c);assert.throws(()=>engine.conversationSource({conversationId:id}),/安全/);
});

test('Yuanbao launcher reuses the same relay tab and opens a fresh one only when absent',async()=>{
 const {openYuanbaoRelay}=await import('../browser-extension/yuanbao-launch.js');
 const url='chrome-extension://'+'a'.repeat(32)+'/yuanbao.html?tabId=10';
 const tabs=[{id:20,url,windowId:1},{id:21,url:url.replace('10','11'),windowId:1}],created=[],updated=[];
 const browser={runtime:{getURL:path=>'chrome-extension://'+'a'.repeat(32)+'/'+path},tabs:{query:async()=>tabs,update:async(id,options)=>{updated.push({id,options});return tabs.find(t=>t.id===id);},create:async options=>{created.push(options);return {id:30,windowId:1};}},windows:{update:async()=>{}}};
 assert.equal((await openYuanbaoRelay(browser,10)).reused,true);assert.equal(created.length,0);assert.equal(updated[0].id,20);assert.equal(updated[0].options.active,true);
 tabs.splice(0,1);assert.equal((await openYuanbaoRelay(browser,10)).reused,false);assert.equal(created[0].url,url);assert.equal(created[0].active,true);
 await assert.rejects(()=>openYuanbaoRelay(browser,-1),/元宝/);
});
