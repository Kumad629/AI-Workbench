import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Store} from '../electron/store.mjs';
import {Engine,buildContext,markdownExport} from '../electron/engine.mjs';
import {BrowserBridge} from '../electron/browser-bridge.mjs';
import {splitCaptureText,uploadCapture,CAPTURE_CHUNK_CHARACTERS} from '../browser-extension/transfer.js';
// Each fixture restarts a bridge on the same preferred port; do not pool sockets across lifetimes.
test('automatic chunks preserve paragraph boundaries, surrogate pairs, and every character',()=>{
  const text='始'+('x'.repeat(59996)+'😀\n\n').repeat(5)+'终';
  const chunks=splitCaptureText(text);
  assert.equal(chunks.join(''),text);
  assert.ok(chunks.every(c=>c.length<=CAPTURE_CHUNK_CHARACTERS));
  assert.ok(chunks.every(c=>!/[\uD800-\uDBFF]$/.test(c)));
});
test('large capture resumes after desktop restart, commits once, and exports all content',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'workbench-transfer-'));
  let store,engine,bridge,url,imports=0;
  const token='a'.repeat(64);
  async function launch(){
    store=new Store(dir);engine=new Engine(store,{encrypt:v=>v,decrypt:v=>v});
    bridge=new BrowserBridge({store,getToken:()=>token,importTranscript:input=>engine.importTranscript(input),onImport:()=>imports++});
    url=await bridge.start();
  }
  t.after(async()=>{await bridge.close();store.close();rmSync(dir,{recursive:true,force:true});});
  await launch();
  let interrupted=true;
  const request=async(path,data={})=>{
    if(interrupted&&path==='/capture/chunk'&&data.index===4)throw new Error('simulated interrupted transfer');
    const response=await fetch(url+path,{method:'POST',headers:{Connection:'close',Authorization:'Bearer '+token,'Content-Type':'application/json',Origin:'chrome-extension://'+'a'.repeat(32)},body:JSON.stringify(data)});
    const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
  };
  const content=Array.from({length:430},(_,i)=>'我：问题 '+i+'\n\nGemini：'+('长对话验证内容😀'.repeat(350))+' [END-'+i+']').join('\n\n');
  assert.ok(content.length>1000000);
  const payload={requestId:'long-transfer-000001',title:'超过百万字符的完整对话',content,url:'https://gemini.google.com/app/long',note:'验证全部原文'};
  await assert.rejects(()=>uploadCapture(request,payload),/interrupted/);
  assert.equal(engine.snapshot().conversations.length,0);
  await bridge.close();store.close();await launch();interrupted=false;
  const saved=await uploadCapture(request,payload);
  const c=store.get('conversation',saved.conversationId);
  assert.equal(c.messages.filter(m=>m.isTranscript).map(m=>m.content).join(''),content);
  assert.ok(c.messages.length>10);
  const duplicate=await uploadCapture(request,payload);
  assert.equal(duplicate.conversationId,c.id);assert.equal(imports,1);
  assert.equal(engine.snapshot().conversations.length,1);
  const exported=engine.exportData(c.id),restored=store.get('conversation',engine.importData(exported));
  assert.equal(restored.messages.filter(m=>m.isTranscript).map(m=>m.content).join(''),content);
  const md=markdownExport(c);assert.ok(md.includes(content));
  for(let i=0;i<430;i++)assert.equal(md.split('[END-'+i+']').length-1,1);
  c.messages.push({id:'followup',role:'user',content:'继续',targetIds:[]});
  const context=buildContext(c,'another-model','followup');
  assert.equal(context.filter(m=>m.content.startsWith('用户保存的外部对话原文')).length,c.messages.filter(m=>m.isTranscript).length);
});
test('partial and inconsistent batches never become a saved conversation',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'workbench-transfer-validation-')),store=new Store(dir);
  const engine=new Engine(store,{encrypt:v=>v,decrypt:v=>v});
  const bridge=new BrowserBridge({store,getToken:()=>'b'.repeat(64),importTranscript:x=>engine.importTranscript(x)});
  const url=await bridge.start();t.after(async()=>{await bridge.close();store.close();rmSync(dir,{recursive:true,force:true});});
  const post=async(path,body,token='b'.repeat(64))=>{
    const response=await fetch(url+path,{method:'POST',headers:{Connection:'close',Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  const meta={requestId:'validation-transfer-001',title:'test',url:'https://gemini.google.com/app/test',parts:2,characters:6,contentHash:createHash('sha256').update('abcdef').digest('hex')};
  assert.equal((await post('/capture/start',meta)).status,200);
  assert.equal((await post('/capture/chunk',{requestId:meta.requestId,index:0,text:'abc'})).status,200);
  assert.equal((await post('/capture/chunk',{requestId:meta.requestId,index:0,text:'xyz'})).status,400);
  assert.equal((await post('/capture/commit',{requestId:meta.requestId})).status,400);
  assert.equal(engine.snapshot().conversations.length,0);
  assert.equal((await post('/capture/chunk',{requestId:meta.requestId,index:1,text:'def'},'c'.repeat(64))).status,401);
  assert.equal((await post('/capture/chunk',{requestId:meta.requestId,index:1,text:'def'})).status,200);
  assert.equal((await post('/capture/commit',{requestId:meta.requestId})).status,200);
  assert.equal((await post('/capture/commit',{requestId:meta.requestId})).status,200);
  assert.equal(engine.snapshot().conversations.length,1);
  const wrong={...meta,requestId:'validation-transfer-002'};
  await post('/capture/start',wrong);
  await post('/capture/chunk',{requestId:wrong.requestId,index:0,text:'123'});
  await post('/capture/chunk',{requestId:wrong.requestId,index:1,text:'456'});
  assert.equal((await post('/capture/commit',{requestId:wrong.requestId})).status,400);
  assert.equal(engine.snapshot().conversations.length,1);
});

test('browser sources retain X conversation IDs and reject unrelated pages',async()=>{
  const {browserSource}=await import('../browser-extension/sources.js');
  assert.deepEqual(browserSource('https://x.com/i/grok?conversation=123-abc&s=20#draft'),{product:'Grok',url:'https://x.com/i/grok?conversation=123-abc'});
  assert.equal(browserSource('https://twitter.com/i/grok?conversation=123').product,'Grok');
  assert.equal(browserSource('https://x.com/i/grok/share/abc').url,'https://x.com/i/grok/share/abc');
  for(const url of ['https://x.com/home','https://x.com/i/grokk','https://x.com.evil.test/i/grok','http://x.com/i/grok','https://user:secret@x.com/i/grok','https://x.com:444/i/grok','https://x.com/i/grok?conversation=a%26secret%3Db']){
    assert.throws(()=>browserSource(url));
  }
});

test('Grok capture is classified from its URL and keeps provenance through storage and export',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'workbench-grok-')),store=new Store(dir);
  const engine=new Engine(store,{encrypt:v=>v,decrypt:v=>v});
  const bridge=new BrowserBridge({store,getToken:()=>'d'.repeat(64),importTranscript:x=>engine.importTranscript(x)});
  const url=await bridge.start();
  t.after(async()=>{await bridge.close();store.close();rmSync(dir,{recursive:true,force:true});});
  const request=async(path,body={})=>{
    const res=await fetch(url+path,{method:'POST',headers:{Connection:'close',Authorization:'Bearer '+'d'.repeat(64),'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await res.json();if(!res.ok)throw new Error(result.error);return result;
  };
  const content='我：\n分析这个观点 https://x.com/example/status/123\n\nGrok：\n可以先做一个原型。';
  const saved=await uploadCapture(request,{requestId:'grok-transfer-example-001',product:'Gemini',title:'X 上的项目讨论',content,url:'https://x.com/i/grok?conversation=456&s=20',note:'项目草案'});
  const conversation=store.get('conversation',saved.conversationId);
  assert.equal(conversation.source.product,'Grok');
  assert.equal(conversation.folder,'Grok 存档');
  assert.deepEqual(conversation.source.urls,['https://x.com/i/grok?conversation=456']);
  assert.equal(conversation.messages[1].content,content);
  assert.ok(markdownExport(conversation).includes('https://x.com/i/grok?conversation=456'));
  const restored=store.get('conversation',engine.importData(engine.exportData(conversation.id)));
  assert.equal(restored.source.product,conversation.source.product);
  assert.deepEqual(restored.source.urls,conversation.source.urls);
  assert.equal(restored.source.note,conversation.source.note);
  assert.ok(Date.parse(restored.source.importedAt)>=Date.parse(conversation.source.importedAt));
  const legacy=await request('/capture',{requestId:'grok-legacy-example-001',title:'短对话',content,url:'https://twitter.com/i/grok?conversation=789'});
  assert.equal(store.get('conversation',legacy.conversationId).source.product,'Grok');
  await assert.rejects(()=>uploadCapture(async()=>({capabilities:['chunkedCaptureV1']}),{product:'Grok',content}),/重新打开/);
});

test('YouTube source validates watch IDs and preserves 30 rounds across save and export',async t=>{
 const {browserSource}=await import('../browser-extension/sources.js');
 assert.deepEqual(browserSource('https://youtube.com/watch?v=subu-xHrp1w&t=62&list=abc#x'),{product:'YouTube 提问',url:'https://www.youtube.com/watch?v=subu-xHrp1w'});
 for(const bad of ['https://youtube.com/','https://youtube.com/watch?v=bad','https://youtube.com/watch?v=subu-xHrp1w&v=abcdefghijk','https://youtube.com.evil.test/watch?v=subu-xHrp1w','http://youtube.com/watch?v=subu-xHrp1w','https://user:pass@youtube.com/watch?v=subu-xHrp1w','https://youtube.com:444/watch?v=subu-xHrp1w','https://studio.youtube.com/watch?v=subu-xHrp1w'])assert.throws(()=>browserSource(bad));
 const dir=mkdtempSync(join(tmpdir(),'awb-youtube-transfer-')),store=new Store(dir),engine=new Engine(store,{encrypt:v=>v,decrypt:v=>v});
 const bridge=new BrowserBridge({store,getToken:()=>'e'.repeat(64),importTranscript:x=>engine.importTranscript(x)}),url=await bridge.start();t.after(async()=>{await bridge.close();store.close();rmSync(dir,{recursive:true,force:true});});
 const request=async(path,body={})=>{const r=await fetch(url+path,{method:'POST',headers:{Connection:'close',Authorization:'Bearer '+'e'.repeat(64),'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw new Error(result.error);return result;};
 const content=Array.from({length:30},(_,i)=>'我：\n问题 '+i+'\n\nYouTube：\n回答 '+i).join('\n\n');
 const saved=await uploadCapture(request,{requestId:'youtube-thirty-rounds-001',title:'视频标题 · 提问',content,url:'https://www.youtube.com/watch?v=subu-xHrp1w&t=62',product:'Gemini',note:'已检查提问栏顶部和底部'});
 const c=store.get('conversation',saved.conversationId);assert.equal(c.source.product,'YouTube 提问');assert.equal(c.folder,'YouTube 提问 存档');assert.equal(c.messages[1].content,content);assert.ok(markdownExport(c).includes('subu-xHrp1w'));assert.ok(markdownExport(c).includes('回答 29'));
 const restored=store.get('conversation',engine.importData(engine.exportData(c.id)));assert.deepEqual(restored.source.urls,['https://www.youtube.com/watch?v=subu-xHrp1w']);assert.equal(restored.messages[1].content,content);
 const retry=await uploadCapture(request,{requestId:'youtube-thirty-rounds-001',title:'视频标题 · 提问',content,url:'https://www.youtube.com/watch?v=subu-xHrp1w&t=62',note:'已检查提问栏顶部和底部'});assert.equal(retry.conversationId,c.id);
});


test('YouTube save explains that an old workbench needs restarting',async()=>{await assert.rejects(()=>uploadCapture(async()=>({capabilities:['chunkedCaptureV1']}),{product:'YouTube 提问',content:'我：\n一个问题'}),/v0.13.0/);});
