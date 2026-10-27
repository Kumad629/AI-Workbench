import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../electron/store.mjs';
import {WebChat,yuanbaoUrl} from '../electron/web-chat.mjs';
import {BrowserBridge} from '../electron/browser-bridge.mjs';
import {Engine,markdownExport} from '../electron/engine.mjs';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'awb-webchat-')),store=new Store(dir);let now=1000;
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const chat=new WebChat(store,()=>{},()=>now);
 const clientId=randomUUID(),url='https://yuanbao.tencent.com/chat/fixture';
 const binding=chat.bind({clientId,url,ready:true});
 const auth={clientId,...binding},send=text=>chat.send({text,bindingId:binding.bindingId});
 const claim=()=>chat.poll({...auth,url,ready:true}).job;
 const report=(job,overrides={})=>chat.report({...auth,jobId:job.id,lease:job.lease,sequence:1,phase:'complete',content:'回答',url,...overrides});
 return {store,chat,auth,url,send,claim,report,advance:ms=>now+=ms};
}
test('web chat claims at most once and persists a complete correlated conversation',t=>{
 const f=fixture(t),sent=f.send('问题');const job=f.claim();
 assert.equal(job.id,sent.jobId);assert.equal(f.claim(),null);
 assert.throws(()=>f.send('second'),/等待/);
 assert.equal(f.report(job).accepted,true);
 assert.equal(f.report(job,{content:'duplicate'}).accepted,false);
 const c=f.store.get('conversation',sent.conversationId);
 assert.deepEqual(c.messages.map(m=>[m.role,m.content,m.status]),[['user','问题','complete'],['assistant','回答','complete']]);
 assert.equal(c.webChat.url,f.url);
 assert.match(markdownExport(c),/网页账号/);
 const engine=new Engine(f.store,{}),copy=engine.importData(engine.exportData(c.id));
 assert.equal(f.store.get('conversation',copy).webChat.url,f.url);
});
test('cancel before claim sends nothing; cancel after claim retains partial text and rejects late completion',t=>{
 const f=fixture(t);f.send('cancel');f.chat.cancel();assert.equal(f.claim(),null);
 const sent=f.send('partial'),job=f.claim();f.report(job,{phase:'streaming',content:'部分'});
 f.chat.cancel();assert.equal(f.report(job,{sequence:2}).accepted,false);
 assert.equal(f.store.get('conversation',sent.conversationId).messages.at(-1).content,'部分');
 const next=f.send('下一条');const delivery=f.chat.poll({...f.auth,jobId:job.id});
 assert.equal(delivery.cancelled,true);assert.equal(delivery.job.id,next.jobId);
});
test('lost claims, stale binding, navigation mismatch and application restart never replay',t=>{
 const f=fixture(t);const sent=f.send('once'),job=f.claim();
 f.advance(46000);assert.equal(f.chat.status().busy,false);assert.equal(f.claim(),null);
 assert.equal(f.store.get('conversation',sent.conversationId).messages.at(-1).status,'interrupted');
 assert.equal(f.report(job).accepted,false);
 assert.throws(()=>f.chat.send({text:'stale',bindingId:randomUUID()}),/连接/);
 f.chat.poll({...f.auth,url:'https://yuanbao.tencent.com/chat/another',ready:true});
 assert.equal(f.chat.status().ready,false);
 assert.throws(()=>f.send('wrong page'),/切换/);
 f.chat.poll({...f.auth,url:f.url,ready:true});f.send('restart');f.claim();
 const restarted=new WebChat(f.store);assert.equal(restarted.status().online,false);assert.equal(restarted.active(),undefined);
});
test('tasks and events are bound to client, lease, origin and sequence',t=>{
 const f=fixture(t);f.send('secure');const j=f.claim();
 assert.throws(()=>f.chat.poll({...f.auth,clientId:randomUUID()}),/失效/);
 assert.throws(()=>f.report({...j,lease:randomUUID()}),/不属于/);
 assert.throws(()=>f.report(j,{url:'https://evil.example/'}),/官方/);
 assert.throws(()=>f.report(j,{content:''}),/为空/);
 assert.equal(f.report(j,{phase:'streaming',content:'new',sequence:5}).accepted,true);
 assert.equal(f.report(j,{phase:'streaming',content:'new',sequence:5}).repeated,true);
 assert.equal(f.report(j,{content:'old',sequence:4}).accepted,false);
 f.chat.disconnect();assert.throws(()=>f.report(j),/失效/);
 for(const url of ['http://yuanbao.tencent.com/','https://yuanbao.tencent.com.evil/','https://a@yuanbao.tencent.com/'])assert.throws(()=>yuanbaoUrl(url));
});
test('paired HTTP bridge validates origins and tokens before handing out one job',async t=>{
 const f=fixture(t),token='b'.repeat(64);
 const bridge=new BrowserBridge({getToken:()=>token,store:f.store,importTranscript:()=>{}});bridge.webChat=f.chat;
 const base=await bridge.start();t.after(()=>bridge.close());
 const req=(body,headers={})=>fetch(base+'/web-chat/poll',{method:'POST',headers:{Connection:'close','Content-Type':'application/json',Authorization:'Bearer '+token,Origin:'chrome-extension://'+'a'.repeat(32),...headers},body:JSON.stringify(body)});
 f.send('bridge');
 assert.equal((await req(f.auth,{Authorization:'Bearer '+'c'.repeat(64)})).status,401);
 assert.equal((await req(f.auth,{Origin:'https://yuanbao.tencent.com'})).status,403);
 assert.ok((await (await req(f.auth)).json()).job);
 assert.equal((await (await req(f.auth)).json()).job,null);
});

test('history prepends old turns into the same conversation, retains IDs/bookmarks, and repeated sync is idempotent',t=>{
 const f=fixture(t),sent=f.send('新问题'),job=f.claim();f.report(job);
 const existing=f.store.get('conversation',sent.conversationId),answerId=existing.messages[1].id;
 const engine=new Engine(f.store,{});const excerpt=engine.saveExcerpt({conversationId:existing.id,messageId:answerId,title:'收藏',content:'回答',tags:[]});
 const binding=f.chat.bind({clientId:f.auth.clientId,url:f.url,ready:true,historyEnabled:true}),auth={clientId:f.auth.clientId,...binding};
 assert.equal(f.chat.status().busy,true);assert.throws(()=>f.chat.send({text:'等待同步',bindingId:binding.bindingId}),/等待/);
 const messages=[{role:'user',content:'旧问题'},{role:'assistant',content:'旧答案'},...existing.messages.map(({role,content})=>({role,content}))];
 const request=f.chat.poll(auth).historyRequest;
 const result=f.chat.history({...auth,requestId:request.id,url:f.url,messages});
 assert.equal(result.conversationId,existing.id);assert.equal(result.added,2);
 assert.equal(f.chat.history({...auth,requestId:request.id,url:f.url,messages}).accepted,true);
 const c=f.store.get('conversation',existing.id);
 assert.deepEqual(c.messages.map(m=>m.content),['旧问题','旧答案','新问题','回答']);
 assert.equal(c.messages[3].id,answerId);assert.equal(f.store.get('excerpt',excerpt).messageId,answerId);
 assert.equal(c.messages[0].webHistory,true);assert.equal(c.messages[1].replyTo,c.messages[0].id);
 f.chat.requestHistory({bindingId:binding.bindingId,conversationId:c.id});
 const second=f.chat.poll(auth).historyRequest;
 assert.equal(f.chat.history({...auth,requestId:second.id,url:f.url,messages}).added,0);
 const copy=engine.importData(engine.exportData(c.id)),copied=f.store.get('conversation',copy);
 assert.equal(copied.messages[0].webHistory,true);assert.equal(copied.webChat.history.loadedMessages,4);
 assert.match(markdownExport(c),/已同步的网页历史/);
});
test('history rejects changed sources, ambiguous repeated turns and disconnected requests without altering messages',t=>{
 const f=fixture(t),sent=f.send('本地'),j=f.claim();f.report(j);
 const original=f.store.get('conversation',sent.conversationId).messages;
 const binding=f.chat.bind({clientId:f.auth.clientId,url:f.url,ready:true,historyEnabled:true}),auth={clientId:f.auth.clientId,...binding};
 let req=f.chat.poll(auth).historyRequest;
 const wrong=f.chat.history({...auth,requestId:req.id,url:'https://yuanbao.tencent.com/chat/other',messages:[]});
 assert.equal(wrong.accepted,false);assert.deepEqual(f.store.get('conversation',sent.conversationId).messages,original);
 f.chat.requestHistory({bindingId:binding.bindingId});
 req=f.chat.poll(auth).historyRequest;
 const pair=original.map(({role,content})=>({role,content}));
 const ambiguous=f.chat.history({...auth,requestId:req.id,url:f.url,messages:[...pair,...pair]});
 assert.equal(ambiguous.accepted,false);assert.match(ambiguous.error,/衔接/);
 assert.deepEqual(f.store.get('conversation',sent.conversationId).messages,original);
 f.chat.disconnect();assert.throws(()=>f.chat.history({...auth,requestId:req.id,url:f.url,messages:pair}),/失效/);
});
test('read-only history starts a local conversation, preserves repeated questions, cancels and times out without sending',t=>{
 const f=fixture(t),binding=f.chat.bind({clientId:f.auth.clientId,url:f.url,ready:true,historyEnabled:true}),auth={clientId:f.auth.clientId,...binding};
 const req=f.chat.poll(auth).historyRequest;
 const messages=[{role:'user',content:'继续'},{role:'assistant',content:'第一轮'},{role:'user',content:'继续'},{role:'assistant',content:'第二轮'}];
 const saved=f.chat.history({...auth,requestId:req.id,url:f.url,messages});
 assert.equal(f.store.all('webJob').length,0);assert.equal(f.store.get('conversation',saved.conversationId).messages.length,4);
 f.chat.requestHistory({bindingId:binding.bindingId});const cancelled=f.chat.poll(auth).historyRequest;f.chat.cancel();
 f.chat.history({...auth,requestId:cancelled.id,url:f.url,messages:[{role:'user',content:'不会写入'}]});
 assert.equal(f.store.get('conversation',saved.conversationId).messages.length,4);
 f.chat.requestHistory({bindingId:binding.bindingId});f.advance(46000);
 assert.equal(f.chat.status().history.phase,'failed');assert.equal(f.chat.status().busy,false);
});

test('relay binding errors distinguish a competing tab from a disconnected or restarted desktop',t=>{
 const f=fixture(t);
 const replacement=f.chat.bind({clientId:randomUUID(),url:f.url,ready:true});
 assert.throws(()=>f.chat.poll(f.auth),e=>e.code==='WEB_CHAT_REPLACED'&&e.message.includes('另一个'));
 assert.equal(f.chat.binding.id,replacement.bindingId);
 f.chat.disconnect();
 assert.throws(()=>f.chat.poll(f.auth),e=>e.code==='WEB_CHAT_DISCONNECTED'&&e.message.includes('重新连接'));
 assert.equal(f.store.all('webJob').length,0);
});

test('two unique continuous prompts align changed answers while keeping local IDs, versions and bookmarks',t=>{
 const f=fixture(t),engine=new Engine(f.store,{});
 f.send('第一个唯一问题');f.report(f.claim(),{content:'含思考过程的本地回答一'});
 const sent=f.send('第二个唯一问题');f.report(f.claim(),{content:'本地回答二'});
 const original=f.store.get('conversation',sent.conversationId),ids=original.messages.map(m=>m.id);
 const excerpt=engine.saveExcerpt({conversationId:original.id,messageId:ids[1],title:'保留',content:'本地回答一',note:'笔记'});
 const binding=f.chat.bind({clientId:f.auth.clientId,url:f.url,ready:true,historyEnabled:true}),auth={clientId:f.auth.clientId,...binding};
 const incoming=[{role:'user',content:'更早的问题'},{role:'assistant',content:'更早的答案'},{role:'user',content:'第一个唯一问题'},{role:'assistant',content:'网页简化回答一'},{role:'user',content:'第二个唯一问题'},{role:'assistant',content:'网页重新排版的回答二'},{role:'user',content:'最新的问题'},{role:'assistant',content:'最新的答案'}];
 const request=f.chat.poll(auth).historyRequest,result=f.chat.history({...auth,requestId:request.id,url:f.url,messages:incoming});
 assert.equal(result.accepted,true);assert.equal(result.added,4);assert.equal(result.retainedDifferences,2);
 const merged=f.store.get('conversation',original.id);assert.deepEqual(merged.messages.slice(2,6),original.messages);
 assert.equal(f.store.get('excerpt',excerpt).messageId,ids[1]);assert.match(f.chat.status().history.message,/保留本地版本/);
 assert.match(merged.webChat.history.scope,/2 轮回答/);assert.match(markdownExport(merged),/保留本地版本/);
 f.chat.requestHistory({bindingId:binding.bindingId});const req=f.chat.poll(auth).historyRequest;
 assert.equal(f.chat.history({...auth,requestId:req.id,url:f.url,messages:incoming}).added,0);
 assert.equal(f.store.get('conversation',original.id).messages.length,8);
});

test('single prompt mismatch stays a conflict; explicit copy saves history without modifying original or bookmarks',t=>{
 const f=fixture(t),engine=new Engine(f.store,{}),sent=f.send('共同问题');f.report(f.claim(),{content:'本地版本'});
 const original=f.store.get('conversation',sent.conversationId);
 const excerpt=engine.saveExcerpt({conversationId:original.id,messageId:original.messages[1].id,title:'原收藏',content:'本地版本'});
 const binding=f.chat.bind({clientId:f.auth.clientId,url:f.url,ready:true,historyEnabled:true}),auth={clientId:f.auth.clientId,...binding};
 const incoming=[{role:'user',content:'更早'},{role:'assistant',content:'网页旧回答'},{role:'user',content:'共同问题'},{role:'assistant',content:'网页不同版本'}];
 let req=f.chat.poll(auth).historyRequest;
 const conflict=f.chat.history({...auth,requestId:req.id,url:f.url,messages:incoming});
 assert.equal(conflict.code,'HISTORY_ALIGNMENT');assert.equal(conflict.diagnostics.matchingQuestions,1);
 assert.doesNotMatch(JSON.stringify(conflict.diagnostics),/共同问题|本地版本|网页不同/);
 f.chat.requestHistory({bindingId:binding.bindingId,conversationId:original.id,mode:'copy'});req=f.chat.poll(auth).historyRequest;
 const saved=f.chat.history({...auth,requestId:req.id,url:f.url,messages:incoming});
 assert.equal(saved.accepted,true);assert.notEqual(saved.conversationId,original.id);
 assert.deepEqual(f.store.get('conversation',original.id),original);assert.equal(f.store.get('excerpt',excerpt).conversationId,original.id);
 assert.deepEqual(f.store.get('conversation',saved.conversationId).messages.map(({role,content})=>({role,content})),incoming);
 assert.equal(f.chat.status().conversationId,saved.conversationId);
 assert.equal(f.chat.history({...auth,requestId:req.id,url:f.url,messages:incoming}).conversationId,saved.conversationId);
 assert.equal(f.store.all('conversation').length,2);
});

test('question fallback rejects reordered or repeated anchors and unfinished local turns',async()=>{
 const {mergeWebHistory}=await import('../electron/web-history.mjs');
 const pair=(q,a,status='complete')=>[{role:'user',content:q,status:'complete'},{role:'assistant',content:a,status}];
 const original=[...pair('A','local A'),...pair('B','local B')];
 assert.throws(()=>mergeWebHistory(original,[...pair('B','web B'),...pair('A','web A')]),e=>e.code==='HISTORY_ALIGNMENT');
 assert.throws(()=>mergeWebHistory(original,[...pair('A','web A'),...pair('B','web B'),...pair('A','web A'),...pair('B','web B')]),e=>e.code==='HISTORY_ALIGNMENT');
 assert.throws(()=>mergeWebHistory([...pair('A','partial','cancelled'),...pair('B','local B')],[...pair('A','web A'),...pair('B','web B')]),e=>e.code==='HISTORY_ALIGNMENT');
});

test('scan progress extends history lease but cancellation and total deadline still stop it',t=>{
 const f=fixture(t);
 const bound=f.chat.bind({clientId:f.auth.clientId,url:f.url,ready:true,historyEnabled:true,historyScanEnabled:true}),auth={clientId:f.auth.clientId,...bound};
 f.chat.cancel();f.chat.requestHistory({bindingId:bound.bindingId,scan:true});
 const task=f.chat.poll(auth).historyRequest;assert.equal(task.scan,true);
 for(let i=0;i<3;i++){f.advance(30000);f.chat.poll({...auth,historyProgress:{requestId:task.id,count:18,characters:500,direction:'up'}});}
 assert.equal(f.chat.status().history.phase,'loading');assert.match(f.chat.status().history.message,/18 条/);
 assert.throws(()=>f.chat.send({bindingId:bound.bindingId,text:'blocked'}),/等待/);
 f.advance(60001);assert.equal(f.chat.status().history.waitingForBrowser,true);
 f.chat.cancel();assert.equal(f.chat.status().history.waitingForBrowser,false);assert.equal(f.chat.poll(auth).historyRequest,null);
 assert.equal(f.chat.history({...auth,url:f.url,requestId:task.id,messages:[{role:'user',content:'late'}]}).accepted,false);
 assert.equal(f.store.all('conversation').length,0);
 f.chat.requestHistory({bindingId:bound.bindingId,scan:true});f.advance(940000);
 assert.equal(f.chat.status().history.phase,'failed');
});

test('scan capability and persisted partial-range labels are explicit',t=>{
 const f=fixture(t);
 assert.throws(()=>f.chat.requestHistory({bindingId:f.auth.bindingId,scan:true}),/0.7.0/);
 const bound=f.chat.bind({clientId:f.auth.clientId,url:f.url,ready:true,historyEnabled:true,historyScanEnabled:true}),auth={clientId:f.auth.clientId,...bound};
 f.chat.cancel();f.chat.requestHistory({bindingId:bound.bindingId,scan:true});
 const task=f.chat.poll(auth).historyRequest;
 const result=f.chat.history({...auth,url:f.url,requestId:task.id,messages:[{role:'user',content:'question'},{role:'assistant',content:'answer'}],scan:{reason:'capacity'}});
 assert.equal(result.accepted,true);assert.match(f.store.get('conversation',result.conversationId).webChat.history.scope,/部分记录/);
});

test('Doubao and Yuanbao bindings, jobs and cancellations remain independent',t=>{
 const f=fixture(t),doubao=new WebChat(f.store,()=>{},()=>1000,'doubao');
 const clientId=randomUUID(),url='https://www.doubao.com/chat/123';
 const binding=doubao.bind({clientId,url,ready:true}),auth={clientId,...binding};
 const ys=f.send('元宝问题'),ds=doubao.send({bindingId:binding.bindingId,text:'豆包问题'});
 const y=f.claim(),d=doubao.poll(auth).job;
 assert.equal(y.id,ys.jobId);assert.equal(d.id,ds.jobId);assert.equal(f.chat.status().online,true);
 assert.throws(()=>doubao.poll({...auth,jobId:y.id}),/不属于/);
 assert.throws(()=>f.chat.report({...f.auth,jobId:d.id,lease:d.lease,sequence:1,url:f.url,content:'错误平台',phase:'complete'}),/不属于/);
 doubao.cancel();assert.equal(f.chat.status().busy,true);
 assert.equal(f.report(y).accepted,true);
 assert.equal(f.store.get('conversation',ds.conversationId).messages.at(-1).status,'cancelled');
 assert.equal(f.store.get('conversation',ds.conversationId).messages.at(-1).provider,'豆包');
 assert.equal(f.store.get('conversation',ys.conversationId).messages.at(-1).provider,'元宝');
});
test('Doubao history preserves provenance, no-op sync, export, import and source validation',t=>{
 const f=fixture(t),chat=new WebChat(f.store,()=>{},()=>1000,'doubao'),clientId=randomUUID(),url='https://www.doubao.com/chat/bot/chat/123';
 const auth={clientId,...chat.bind({clientId,url,ready:true,historyEnabled:true,historyScanEnabled:true})};
 const messages=[{role:'user',content:'原有问题'},{role:'assistant',content:'| 阶段 | 内容 |\n| --- | --- |\n| 起步 | 学习 |'}];
 const task=chat.poll(auth).historyRequest;
 const saved=chat.history({...auth,url,requestId:task.id,messages});assert.equal(saved.accepted,true);
 const c=f.store.get('conversation',saved.conversationId);
 assert.equal(c.webChat.provider,'豆包');assert.equal(c.messages[1].connectionId,'web:doubao');
 assert.equal(c.messages[1].replyTo,c.messages[0].id);assert.match(markdownExport(c),/来源产品：豆包/);
 const engine=new Engine(f.store,{}),copy=engine.importData(engine.exportData(c.id));
 assert.equal(f.store.get('conversation',copy).webChat.provider,'豆包');
 chat.requestHistory({bindingId:auth.bindingId,scan:true});
 const scan=chat.poll(auth).historyRequest;
 assert.equal(chat.history({...auth,url,requestId:scan.id,messages,scan:{reason:'boundaries-checked'}}).added,0);
 assert.equal(f.store.get('conversation',c.id).messages[0].id,c.messages[0].id);
 assert.throws(()=>chat.bind({clientId,url:f.url,ready:true}),/官方/);
 assert.throws(()=>chat.send({bindingId:auth.bindingId,conversationId:f.send('另一平台').conversationId,text:'wrong platform'}),/不同/);
});
test('Doubao allowlist excludes spoofed domains, credentials, ports and non-chat pages',async()=>{
 const {doubaoUrl}=await import('../electron/web-chat.mjs');
 for(const url of ['http://www.doubao.com/chat/1','https://www.doubao.com.evil.test/chat/1','https://evil@www.doubao.com/chat/1','https://www.doubao.com:444/chat/1','https://www.doubao.com/settings','https://yuanbao.tencent.com/chat/1'])assert.throws(()=>doubaoUrl(url));
 assert.equal(doubaoUrl('https://www.doubao.com/chat/123#fragment'),'https://www.doubao.com/chat/123');
});
test('restarting Doubao state does not interrupt another provider job',t=>{
 const f=fixture(t),sent=f.send('仍在元宝进行中');
 new WebChat(f.store,()=>{},()=>1000,'doubao');
 assert.equal(f.store.get('webJob',sent.jobId).state,'queued');
 assert.equal(f.chat.status().busy,true);
});

test('scan progress survives a brief disconnection and resumes the same task',t=>{
 const f=fixture(t),bound=f.chat.bind({clientId:f.auth.clientId,url:f.url,ready:true,historyEnabled:true,historyScanEnabled:true}),auth={clientId:f.auth.clientId,...bound};
 f.chat.cancel();f.chat.requestHistory({bindingId:bound.bindingId,scan:true});
 const task=f.chat.poll(auth).historyRequest;
 f.advance(60001);let status=f.chat.status();
 assert.equal(status.online,false);assert.equal(status.history.phase,'loading');assert.equal(status.history.waitingForBrowser,true);
 assert.match(status.history.message,/保留/);assert.equal(status.busy,true);
 // A poll for a different task cannot renew the scan's progress.
 f.chat.poll({...auth,historyProgress:{requestId:'wrong',count:64,characters:42012}});
 f.advance(60001);assert.equal(f.chat.status().history.waitingForBrowser,true);
 const resumed=f.chat.poll({...auth,historyProgress:{requestId:task.id,count:64,characters:42012,direction:'up'}});
 assert.equal(resumed.historyRequest.id,task.id);assert.equal(f.chat.status().history.waitingForBrowser,false);
 assert.match(f.chat.status().history.message,/64 条/);
 const saved=f.chat.history({...auth,requestId:task.id,url:f.url,messages:[{role:'user',content:'问题'},{role:'assistant',content:'回答'}],scan:{reason:'boundaries-checked'}});
 assert.equal(saved.accepted,true);assert.equal(f.store.all('conversation').length,1);
});
test('expired scans report the terminal reason and reject late results',t=>{
 const f=fixture(t),bound=f.chat.bind({clientId:f.auth.clientId,url:f.url,ready:true,historyEnabled:true,historyScanEnabled:true}),auth={clientId:f.auth.clientId,...bound};
 f.chat.cancel();f.chat.requestHistory({bindingId:bound.bindingId,scan:true});
 const task=f.chat.poll(auth).historyRequest;
 f.advance(180001);
 const polled=f.chat.poll({...auth,historyProgress:{requestId:task.id,count:64,characters:42012}});
 assert.equal(polled.historyRequest,null);assert.equal(polled.historyStatus.id,task.id);
 assert.equal(polled.historyStatus.phase,'failed');assert.equal(polled.historyStatus.code,'HISTORY_CONNECTION_TIMEOUT');
 const late=f.chat.history({...auth,requestId:task.id,url:f.url,messages:[{role:'user',content:'不得保存'}]});
 assert.equal(late.accepted,false);assert.match(late.error,/未收到浏览器进度/);assert.equal(f.store.all('conversation').length,0);
});
test('quick history keeps its timeout and late requests cannot bypass expiry',t=>{
 const f=fixture(t),bound=f.chat.bind({clientId:f.auth.clientId,url:f.url,ready:true,historyEnabled:true}),auth={clientId:f.auth.clientId,...bound};
 const task=f.chat.poll(auth).historyRequest;f.advance(45001);
 const late=f.chat.history({...auth,requestId:task.id,url:f.url,messages:[{role:'user',content:'late'}]});
 assert.equal(late.accepted,false);assert.equal(f.chat.status().history.phase,'failed');
 assert.equal(f.store.all('conversation').length,0);
});

test('web images persist, export and import, are capability gated, and leave invalid sends untouched',t=>{
 const f=fixture(t),images=[{name:'截图.png',dataUrl:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD9sAAAAASUVORK5CYII="}];
 assert.throws(()=>f.chat.send({bindingId:f.auth.bindingId,text:'看图',images}),/更新扩展/);
 assert.equal(f.store.all('conversation').length,0);
 const bound=f.chat.bind({clientId:f.auth.clientId,url:f.url,ready:true,imageEnabled:true}),auth={clientId:f.auth.clientId,...bound};
 assert.throws(()=>f.chat.send({bindingId:bound.bindingId,text:'看图',images:[{name:'bad',dataUrl:'https://example.com/private.png'}]}),/支持|格式/);
 assert.equal(f.store.all('conversation').length,0);
 const sent=f.chat.send({bindingId:bound.bindingId,text:'',images});
 const job=f.chat.poll(auth).job;assert.deepEqual(job.images,images);assert.equal(job.text,'请查看图片。');
 const c=f.store.get('conversation',sent.conversationId);assert.deepEqual(c.messages[0].images,images);
 assert.match(markdownExport(c),/data:image\/png;base64/);
 const engine=new Engine(f.store,{}),copy=engine.importData(engine.exportData(c.id));
 assert.deepEqual(f.store.get('conversation',copy).messages[0].images,images);
 assert.equal(f.chat.poll(auth).job,null);
});

test('reconnect fills failed last answer using two earlier unique question anchors and keeps 306 message IDs',t=>{
 const f=fixture(t),engine=new Engine(f.store,{});
 const bound=f.chat.bind({clientId:f.auth.clientId,url:f.url,ready:true,historyEnabled:true}),auth={clientId:f.auth.clientId,...bound};
 const older=Array.from({length:152},(_,i)=>[{role:'user',content:'历史问题 '+i},{role:'assistant',content:'历史回答 '+i}]).flat();
 const first=f.chat.history({...auth,url:f.url,requestId:f.chat.poll(auth).historyRequest.id,messages:older});
 const sent=f.chat.send({bindingId:bound.bindingId,text:'本次待补回问题'}),job=f.chat.poll({...auth,url:f.url,ready:true}).job;
 f.chat.report({...auth,jobId:job.id,lease:job.lease,sequence:1,phase:'failed',content:'已收到的一部分',url:f.url,error:'提问位置发生变化，已停止接收'});
 const before=f.store.get('conversation',first.conversationId),ids=before.messages.map(m=>m.id);
 const excerpt=engine.saveExcerpt({conversationId:before.id,messageId:ids[1],title:'旧收藏',content:'历史回答 0'});
 const reconnect=f.chat.bind({clientId:auth.clientId,url:f.url,ready:true,historyEnabled:true}),nextAuth={clientId:auth.clientId,...reconnect};
 const messages=[...older.slice(-14),{role:'user',content:'本次待补回问题'},{role:'assistant',content:'网页中的完整回答'}];
 const result=f.chat.history({...nextAuth,url:f.url,requestId:f.chat.poll(nextAuth).historyRequest.id,messages});
 assert.equal(result.accepted,true);assert.equal(result.added,0);assert.equal(result.recoveredAnswers,1);
 const saved=f.store.get('conversation',sent.conversationId);
 assert.deepEqual(saved.messages.map(m=>m.id),ids);assert.equal(saved.messages.length,306);
 assert.deepEqual(saved.messages.slice(0,-1),before.messages.slice(0,-1));
 assert.equal(saved.messages.at(-1).content,'网页中的完整回答');assert.equal(saved.messages.at(-1).status,'complete');assert.equal(saved.messages.at(-1).error,undefined);
 assert.equal(saved.messages.at(-1).historyRecovery.previousContent,'已收到的一部分');
 assert.equal(f.store.get('excerpt',excerpt).messageId,ids[1]);assert.match(f.chat.status().history.message,/已补回 1 条/);
 f.chat.requestHistory({bindingId:reconnect.bindingId});
 const repeated=f.chat.history({...nextAuth,url:f.url,requestId:f.chat.poll(nextAuth).historyRequest.id,messages});
 assert.equal(repeated.recoveredAnswers,0);assert.deepEqual(f.store.get('conversation',saved.id).messages,saved.messages);
});
test('failed answer recovery rejects weak anchors, cancellations and wrong reply ownership',async()=>{
 const {mergeWebHistory}=await import('../electron/web-history.mjs');
 const pair=(q,status='complete')=>[{id:q,role:'user',content:q,status:'complete'},{id:q+'a',role:'assistant',content:status==='complete'?'local '+q:'',status,replyTo:q,connectionId:'web:yuanbao'}];
 const original=[...pair('A'),...pair('B'),...pair('C','failed')],incoming=['A','B','C'].flatMap(q=>[{role:'user',content:q},{role:'assistant',content:'web '+q}]);
 assert.equal(mergeWebHistory(original,incoming).recoveredAnswers,1);
 for(const change of [{status:'cancelled'},{status:'streaming'},{replyTo:'wrong'},{connectionId:'web:doubao'}]){
  const broken=structuredClone(original);Object.assign(broken.at(-1),change);
  assert.throws(()=>mergeWebHistory(broken,incoming),e=>e.code==='HISTORY_ALIGNMENT');
 }
 assert.throws(()=>mergeWebHistory(original,incoming.slice(2)),e=>e.code==='HISTORY_ALIGNMENT');
 assert.throws(()=>mergeWebHistory(original,[...incoming.slice(2,4),...incoming.slice(0,2),...incoming.slice(4)]),e=>e.code==='HISTORY_ALIGNMENT');
});

test('Doubao 9 local / 7 web messages retain an unsent duplicate and orphan question while recovering the sent retry',t=>{
 const f=fixture(t),chat=new WebChat(f.store,()=>{},()=>1000,'doubao');
 const url='https://www.doubao.com/chat/recovery',clientId=randomUUID();
 const auth={clientId,...chat.bind({clientId,url,ready:true,historyEnabled:true,imageEnabled:true})};
 const initial=[{role:'user',content:'A'},{role:'assistant',content:'answer A'},{role:'user',content:'B unanswered'},{role:'user',content:'C'},{role:'assistant',content:'answer C'}];
 const first=chat.history({...auth,url,requestId:chat.poll(auth).historyRequest.id,messages:initial});
 const images=[{name:'image.png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD9sAAAAASUVORK5CYII='}];
 for(const attempt of [1,2]){
  chat.send({bindingId:auth.bindingId,text:'same image question',images});
  const job=chat.poll(auth).job;
  chat.report({...auth,url,jobId:job.id,lease:job.lease,sequence:attempt===1?1:3,phase:'failed',content:'',error:attempt===1?'网页有多个图片上传入口，请在原网页添加图片':'本次提问与原会话无法可靠衔接，请核对豆包网页'});
 }
 const before=f.store.get('conversation',first.conversationId),engine=new Engine(f.store,{});
 assert.equal(before.messages.length,9);
 const bookmark=engine.saveExcerpt({conversationId:before.id,messageId:before.messages[5].id,title:'保留图片问题',content:'same image question'});
 const incoming=[...initial,{role:'user',content:'same image question'},{role:'assistant',content:'real answer'}];
 chat.requestHistory({bindingId:auth.bindingId});
 const result=chat.history({...auth,url,requestId:chat.poll(auth).historyRequest.id,messages:incoming});
 assert.equal(result.accepted,true);assert.equal(result.added,0);assert.equal(result.recoveredAnswers,1);
 const saved=f.store.get('conversation',before.id);
 assert.deepEqual(saved.messages.map(m=>m.id),before.messages.map(m=>m.id));
 assert.deepEqual(saved.messages.slice(0,-1),before.messages.slice(0,-1));
 assert.equal(saved.messages[6].status,'failed');assert.equal(saved.messages[8].status,'complete');
 assert.equal(saved.messages[8].content,'real answer');assert.match(result.message,/保留 1 次/);
 assert.equal(f.store.get('excerpt',bookmark).messageId,before.messages[5].id);
 chat.requestHistory({bindingId:auth.bindingId});
 const repeated=chat.history({...auth,url,requestId:chat.poll(auth).historyRequest.id,messages:incoming});
 assert.equal(repeated.accepted,true);assert.equal(repeated.added,0);assert.equal(repeated.recoveredAnswers,0);
 assert.deepEqual(f.store.get('conversation',before.id).messages,saved.messages);
 // Reconstruct the application service and verify the same persisted evidence still works.
 const restarted=new WebChat(f.store,()=>{},()=>2000,'doubao');
 const next={clientId,...restarted.bind({clientId,url,ready:true,historyEnabled:true})};
 assert.equal(restarted.history({...next,url,requestId:restarted.poll(next).historyRequest.id,messages:incoming}).accepted,true);
});

test('unsent attempt exclusion requires exact persisted upload job evidence and preserves input on failure',async()=>{
 const {mergeWebHistory}=await import('../electron/web-history.mjs'),provider={id:'doubao',name:'豆包'};
 const pair=(q,status='complete')=>[{id:q,role:'user',content:q,status:'complete'},{id:q+'a',role:'assistant',content:status==='complete'?'local '+q:'',status,replyTo:q,connectionId:'web:doubao'}];
 const base=[...pair('A'),...pair('C')],unsent=pair('D','failed'),retry=pair('D','failed');
 unsent[0].id='unsent';unsent[0].images=[{name:'a',dataUrl:'image'}];unsent[1].id='unsent-a';unsent[1].replyTo='unsent';unsent[1].error='网页有多个图片上传入口，请在原网页添加图片';
 const original=[...base,...unsent,...retry],snapshot=structuredClone(original);
 const job={messageId:'unsent-a',provider:'doubao',state:'failed',sequence:1,text:'D',images:unsent[0].images};
 const incoming=['A','C','D'].flatMap(q=>[{role:'user',content:q},{role:'assistant',content:'web '+q}]);
 assert.equal(mergeWebHistory(original,incoming,provider,[job]).recoveredAnswers,1);
 for(const change of [null,{sequence:2},{state:'cancelled'},{provider:'yuanbao'},{messageId:'wrong'},{text:'other'},{images:[]}]){
  assert.throws(()=>mergeWebHistory(original,incoming,provider,change===null?[]:[{...job,...change}]),e=>e.code==='HISTORY_ALIGNMENT');
 }
 assert.deepEqual(original,snapshot);
 assert.throws(()=>mergeWebHistory(original,incoming.slice(2),provider,[job]),e=>e.code==='HISTORY_ALIGNMENT');
 const cancelled=structuredClone(original);cancelled.at(-1).status='cancelled';
 assert.throws(()=>mergeWebHistory(cancelled,incoming,provider,[job]),e=>e.code==='HISTORY_ALIGNMENT');
});

test('an unanswered imported question can match in order but is not a recovery anchor',async()=>{
 const {mergeWebHistory}=await import('../electron/web-history.mjs');
 const existing=[{id:'A',role:'user',content:'A',webHistory:true,status:'complete'},
 {id:'B',role:'user',content:'B',status:'complete'},{id:'Ba',role:'assistant',content:'old B',status:'complete'},
 {id:'C',role:'user',content:'C',status:'complete'},{id:'Ca',role:'assistant',content:'',status:'failed',replyTo:'C',connectionId:'web:yuanbao'}];
 const incoming=[{role:'user',content:'A'},{role:'user',content:'B'},{role:'assistant',content:'new B'},{role:'user',content:'C'},{role:'assistant',content:'new C'}];
 assert.throws(()=>mergeWebHistory(existing,incoming),e=>e.code==='HISTORY_ALIGNMENT');
});

test('Doubao shortened image-only history keeps all 9 local messages and does not invent recovery',async()=>{
 const {mergeWebHistory}=await import('../electron/web-history.mjs'),provider={id:'doubao',name:'豆包'};
 const pair=q=>[{id:q,role:'user',content:q,status:'complete',webHistory:true},{id:q+'a',role:'assistant',content:'local '+q,status:'complete',replyTo:q,connectionId:'web:doubao'}];
 const original=[...pair('A'),{id:'image-fragment',role:'user',content:'[图片]\n\n[图片]\n\n[图片]',status:'complete',webHistory:true},...pair('C')];
 const images=[{name:'image',dataUrl:'image'}];
 for(const [id,error] of [['first','网页有多个图片上传入口，请在原网页添加图片'],['second','接收失败']]){
  original.push({id,role:'user',content:'D',status:'complete',images},{id:id+'a',role:'assistant',content:'',status:'failed',replyTo:id,connectionId:'web:doubao',error});
 }
 const job={messageId:'firsta',provider:'doubao',state:'failed',sequence:1,text:'D',images};
 const incoming=[{role:'user',content:'A'},{role:'assistant',content:'web A'},{role:'user',content:'[图片：预览]'},{role:'user',content:'C'},{role:'assistant',content:'web C'}];
 const saved=structuredClone(original);
 const result=mergeWebHistory(original,incoming,provider,[job]);
 assert.equal(result.added,0);assert.equal(result.retainedUnsentAttempts,1);assert.equal(result.retainedImageDifferences,1);
 assert.equal(result.recoveredAnswers,0);assert.deepEqual(result.messages,saved);assert.deepEqual(original,saved);
 const repeat=mergeWebHistory(result.messages,incoming,provider,[job]);assert.deepEqual(repeat.messages,saved);
 // Once the newest question/answer is actually present, it can be recovered using A and C.
 const full=[...incoming,{role:'user',content:'D'},{role:'assistant',content:'actual reply'}];
 const recovered=mergeWebHistory(original,full,provider,[job]);
 assert.equal(recovered.recoveredAnswers,1);assert.equal(recovered.messages.at(-1).content,'actual reply');
 assert.deepEqual(recovered.messages.slice(0,-1),saved.slice(0,-1));
});

test('image gaps reject captions, answered images, missing/duplicate neighbor anchors and changed order',async()=>{
 const {mergeWebHistory}=await import('../electron/web-history.mjs');
 const pair=q=>[{id:q,role:'user',content:q,status:'complete',webHistory:true},{id:q+'a',role:'assistant',content:'local '+q,status:'complete'}];
 const base=[...pair('A'),{id:'img',role:'user',content:'[图片]\n\n[图片]',status:'complete',webHistory:true},...pair('C')];
 const incoming=[{role:'user',content:'A'},{role:'assistant',content:'web A'},{role:'user',content:'[图片]'},{role:'user',content:'C'},{role:'assistant',content:'web C'}];
 const variants=[
  incoming.map((m,i)=>i===2?{...m,content:'[图片] 请评价'}:m),
  [...incoming.slice(0,3),{role:'assistant',content:'image answer'},...incoming.slice(3)],
  incoming.slice(2),
  [...incoming.slice(3),incoming[2],...incoming.slice(0,2)],
  incoming.map((m,i)=>i===3?{...m,content:'A'}:m)
 ];
 for(const web of variants)assert.throws(()=>mergeWebHistory(base,web),e=>e.code==='HISTORY_ALIGNMENT');
 const notImported=structuredClone(base);delete notImported[2].webHistory;
 assert.throws(()=>mergeWebHistory(notImported,incoming),e=>e.code==='HISTORY_ALIGNMENT');
});

test('alignment diagnostics show original counts, compared counts and only bounded structural matches',async()=>{
 const {mergeWebHistory}=await import('../electron/web-history.mjs'),provider={id:'doubao',name:'豆包'};
 const images=[{name:'private image name',dataUrl:'private image bytes'}];
 const original=[{id:'old',role:'user',content:'private original',status:'complete'},{id:'olda',role:'assistant',content:'old answer',status:'complete'},
 {id:'q',role:'user',content:'private prompt',images},{id:'a',role:'assistant',content:'',status:'failed',replyTo:'q',connectionId:'web:doubao',error:'网页有多个图片上传入口，请在原网页添加图片'}];
 const job={messageId:'a',provider:'doubao',state:'failed',sequence:1,text:'private prompt',images};
 assert.throws(()=>mergeWebHistory(original,[{role:'user',content:'private other'}],provider,[job]),e=>{
  assert.equal(e.diagnostics.localMessages,4);assert.equal(e.diagnostics.comparedLocalMessages,2);
  assert.equal(e.diagnostics.retainedUnsentAttempts,1);
  assert.deepEqual(e.diagnostics.questionOutline,[{index:0,characters:13,imageOnly:false,matchingLocalIndexes:[]}]);
  assert.ok(!JSON.stringify(e.diagnostics).includes('private'));return true;
 });
});

test('persisted Doubao upload failure recovers from the exact five-row split-preview window without older anchors',t=>{
 const f=fixture(t),chat=new WebChat(f.store,()=>{},()=>1000,'doubao');
 const url='https://www.doubao.com/chat/recovery',clientId=randomUUID();
 const auth={clientId,...chat.bind({clientId,url,ready:true,historyEnabled:true,imageEnabled:true})};
 const initial=[{role:'user',content:'older question A'},{role:'assistant',content:'answer A'},
 {role:'user',content:'[图片]\n\n[图片]\n\n[图片]'},{role:'user',content:'older question C'},{role:'assistant',content:'answer C'}];
 const saved=chat.history({...auth,url,requestId:chat.poll(auth).historyRequest.id,messages:initial});
 const images=[{name:'picture.png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD9sAAAAASUVORK5CYII='}];
 for(const attempt of [1,2]){
  chat.send({bindingId:auth.bindingId,text:'image question',images});const job=chat.poll(auth).job;
  chat.report({...auth,url,jobId:job.id,lease:job.lease,sequence:attempt===1?1:3,phase:'failed',content:'',
   error:attempt===1?'网页有多个图片上传入口，请在原网页添加图片':'本次提问与原会话无法可靠衔接，请核对豆包网页'});
 }
 const before=f.store.get('conversation',saved.conversationId),engine=new Engine(f.store,{});
 const bookmark=engine.saveExcerpt({conversationId:before.id,messageId:before.messages[7].id,title:'image question',content:'image question'});
 const incoming=[{role:'user',content:'[图片]'},{role:'user',content:'image question'},{role:'assistant',content:'completed webpage answer'},
 {role:'user',content:'new question from web'},{role:'assistant',content:'new web answer'}];
 chat.requestHistory({bindingId:auth.bindingId});
 let result=chat.history({...auth,url,requestId:chat.poll(auth).historyRequest.id,messages:incoming});
 assert.equal(result.accepted,true);assert.equal(result.added,2);assert.equal(result.recoveredAnswers,1);
 const after=f.store.get('conversation',before.id);
 assert.equal(after.messages.length,11);assert.deepEqual(after.messages.slice(0,7),before.messages.slice(0,7));
 assert.deepEqual(after.messages.slice(0,9).map(m=>m.id),before.messages.map(m=>m.id));
 assert.deepEqual(after.messages[7].images,images);assert.equal(after.messages[7].webHistoryImagePrefix.content,'[图片]');
 assert.equal(after.messages[8].status,'complete');assert.equal(after.messages[8].content,'completed webpage answer');
 assert.equal(after.messages[8].historyRecovery.previousError,before.messages[8].error);
 assert.equal(after.messages[10].replyTo,after.messages[9].id);
 assert.equal(f.store.get('excerpt',bookmark).messageId,before.messages[7].id);
 const jobCount=f.store.all('webJob').length;
 chat.requestHistory({bindingId:auth.bindingId});
 result=chat.history({...auth,url,requestId:chat.poll(auth).historyRequest.id,messages:incoming});
 assert.equal(result.accepted,true);assert.equal(result.added,0);assert.equal(result.recoveredAnswers,0);
 assert.deepEqual(f.store.get('conversation',before.id).messages,after.messages);assert.equal(f.store.all('webJob').length,jobCount);
 const restarted=new WebChat(f.store,()=>{},()=>2000,'doubao');
 const next={clientId,...restarted.bind({clientId,url,ready:true,historyEnabled:true})};
 result=restarted.history({...next,url,requestId:restarted.poll(next).historyRequest.id,messages:incoming});
 assert.equal(result.accepted,true);assert.equal(result.added,0);
 assert.deepEqual(f.store.get('conversation',before.id).messages,after.messages);
});

test('uploaded-job recovery rejects unknown send stages, ambiguous questions, missing previews and partial turns',async()=>{
 const {mergeWebHistory}=await import('../electron/web-history.mjs'),provider={id:'doubao',name:'豆包'};
 const images=[{name:'image',dataUrl:'image data'}];
 const original=[{id:'old',role:'user',content:'old',status:'complete'},
 {id:'olda',role:'assistant',content:'old answer',status:'complete'},
 {id:'q',role:'user',content:'caption',images,status:'complete'},
 {id:'a',role:'assistant',content:'',status:'failed',replyTo:'q',connectionId:'web:doubao',error:'本次提问与原会话无法可靠衔接，请核对豆包网页'}];
 const job={id:'job',messageId:'a',provider:'doubao',state:'failed',sequence:3,text:'caption',images};
 const incoming=[{role:'user',content:'[图片]'},{role:'user',content:'caption'},{role:'assistant',content:'real answer'}];
 assert.equal(mergeWebHistory(original,incoming,provider,[job]).recoveredAnswers,1);
 for(const change of [null,{sequence:1},{sequence:2},{sequence:4},{provider:'yuanbao'},{state:'cancelled'},{messageId:'other'},{text:'other'},{images:[]}]){
  assert.throws(()=>mergeWebHistory(original,incoming,provider,change===null?[]:[{...job,...change}]),e=>e.code==='HISTORY_ALIGNMENT');
 }
 for(const change of [{status:'cancelled'},{status:'interrupted'},{status:'streaming'},{error:'another failure'},{content:'partial answer'},{replyTo:'other'},{connectionId:'web:yuanbao'}]){
  const bad=structuredClone(original);Object.assign(bad.at(-1),change);
  assert.throws(()=>mergeWebHistory(bad,incoming,provider,[job]),e=>e.code==='HISTORY_ALIGNMENT');
 }
 for(const web of [incoming.slice(1),[{role:'user',content:'[图片]\n\n[图片]'},...incoming.slice(1)],
 [{role:'user',content:'[图片] caption'},...incoming.slice(1)],incoming.slice(0,-1),
 [...incoming,...incoming.slice(1)], [...incoming,{role:'user',content:'not answered yet'}],
 [...incoming,{role:'user',content:'old'},{role:'assistant',content:'reordered answer'}]]){
  assert.throws(()=>mergeWebHistory(original,web,provider,[job]),e=>e.code==='HISTORY_ALIGNMENT');
 }
 const repeated=structuredClone(original);repeated.unshift({id:'repeat',role:'user',content:'caption'},{id:'repeata',role:'assistant',content:'earlier answer',status:'complete'});
 assert.throws(()=>mergeWebHistory(repeated,incoming,provider,[job]),e=>e.code==='HISTORY_ALIGNMENT');
 assert.throws(()=>mergeWebHistory(original,incoming,provider,[job,{...job,id:'duplicate'}]),e=>e.code==='HISTORY_ALIGNMENT');
});


function fullDoubaoScanFixture(){
 const pairs=[[115,2296],[16,1611],[12,1229],[24,1026],[18,615],[20,1094],[27,1174],[13,1395],[14,1925],[30,485],[23,671],[44,750],[33,1144],[23,499]];
 const shape=pairs.flatMap(([q,a])=>[['user',q],['assistant',a]]);
 for(const [q,a] of [[8,512],[27,386],[11,342],[13,304]])shape.push(['image',4],['user',q],['assistant',a]);
 shape.push(['user',11],['assistant',302],['image',4],['user',5],['assistant',388],['user',30],['assistant',856],
  ['image',4],['user',18],['assistant',896],['image',4],['user',29],['assistant',738],['image',16],['user',23],['assistant',582],
  ['image',4],['user',25],['assistant',518],['user',12],['assistant',571],['user',13],['assistant',263]);
 return shape.map(([role,length],i)=>({role:role==='image'?'user':role,content:role==='image'?(length===4?'[图片]':'[图片：'+'图'.repeat(11)+']'):String.fromCharCode(0x4e00+i).repeat(length)}));
}

test('full 63-message scan merges after recovered image preview moves into the middle, preserving 13 local IDs and bookmarks',t=>{
 const f=fixture(t),chat=new WebChat(f.store,()=>{},()=>1000,'doubao');
 const url='https://www.doubao.com/chat/full-scan',clientId=randomUUID();
 const auth={clientId,...chat.bind({clientId,url,ready:true,historyEnabled:true,historyScanEnabled:true,imageEnabled:true})};
 const web=fullDoubaoScanFixture();assert.equal(web.length,63);assert.equal(web.reduce((sum,m)=>sum+m.content.length,0),23257);
 const saved=chat.history({...auth,url,requestId:chat.poll(auth).historyRequest.id,messages:web.slice(51,56)});
 const images=[{name:'fixture.png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD9sAAAAASUVORK5CYII='}];
 for(const attempt of [1,2]){
  chat.send({bindingId:auth.bindingId,text:web[57].content,images});const job=chat.poll(auth).job;
  chat.report({...auth,url,jobId:job.id,lease:job.lease,sequence:attempt===1?1:3,phase:'failed',content:'',
   error:attempt===1?'网页有多个图片上传入口，请在原网页添加图片':'本次提问与原会话无法可靠衔接，请核对豆包网页'});
 }
 chat.requestHistory({bindingId:auth.bindingId});
 const recovered=chat.history({...auth,url,requestId:chat.poll(auth).historyRequest.id,messages:web.slice(56,61)});
 assert.equal(recovered.accepted,true);assert.equal(recovered.recoveredAnswers,1);
 chat.requestHistory({bindingId:auth.bindingId});
 assert.equal(chat.history({...auth,url,requestId:chat.poll(auth).historyRequest.id,messages:web.slice(56)}).accepted,true);
 const before=f.store.get('conversation',saved.conversationId);assert.equal(before.messages.length,13);
 const engine=new Engine(f.store,{}),bookmark=engine.saveExcerpt({conversationId:before.id,messageId:before.messages[8].id,title:'saved answer',content:before.messages[8].content});
 const jobCount=f.store.all('webJob').length;
 chat.requestHistory({bindingId:auth.bindingId,scan:true});
 const result=chat.history({...auth,url,requestId:chat.poll(auth).historyRequest.id,messages:web,scan:{reason:'boundaries-checked'}});
 assert.equal(result.accepted,true,JSON.stringify(result.diagnostics));assert.equal(result.added,51);
 const after=f.store.get('conversation',before.id);assert.equal(after.messages.length,64);
 assert.deepEqual(after.messages.slice(0,51).map(({role,content})=>({role,content})),web.slice(0,51));
 assert.deepEqual(after.messages.slice(51),before.messages);assert.equal(f.store.get('excerpt',bookmark).messageId,before.messages[8].id);
 assert.equal(after.webChat.history.loadedMessages,63);
 // Repeated full scans and a process restart are no-ops for messages and jobs.
 const restarted=new WebChat(f.store,()=>{},()=>2000,'doubao'),next={clientId,...restarted.bind({clientId,url,ready:true,historyEnabled:true})};
 const repeated=restarted.history({...next,url,requestId:restarted.poll(next).historyRequest.id,messages:web});
 assert.equal(repeated.accepted,true);assert.equal(repeated.added,0);
 assert.deepEqual(f.store.get('conversation',before.id).messages,after.messages);assert.equal(f.store.all('webJob').length,jobCount);
});


test('recorded split previews normalize at multiple positions without removing independent image messages',async()=>{
 const {mergeWebHistory}=await import('../electron/web-history.mjs'),provider={id:'doubao',name:'豆包'};
 const pair=q=>[{id:q,role:'user',content:q,status:'complete'}, {id:q+'a',role:'assistant',content:'answer '+q,status:'complete',replyTo:q}];
 const original=[...pair('A'),...pair('B'),{id:'independent',role:'user',content:'[图片：独立记录]',status:'complete',webHistory:true},...pair('C'),...pair('D')];
 for(const q of original.filter(m=>m.role==='user'&&['B','D'].includes(m.content))){
  q.images=[{name:'kept',dataUrl:'kept local image'}];q.webHistoryImagePrefix={content:'[图片]',jobId:'job-'+q.id,capturedAt:'saved time'};
 }
 const web=original.flatMap(({role,content})=>[...(role==='user'&&['B','D'].includes(content)?[{role:'user',content:'[图片]'}]:[]),{role,content}]);
 const before=structuredClone(original),incoming=structuredClone(web);
 const result=mergeWebHistory(original,web,provider);
 assert.equal(result.added,0);assert.deepEqual(result.messages,original);
 assert.deepEqual(original,before);assert.deepEqual(web,incoming);
 assert.deepEqual(mergeWebHistory(result.messages,web,provider).messages,before);
});

test('middle preview normalization requires a recorded unique caption and matching attachment shape',async()=>{
 const {mergeWebHistory}=await import('../electron/web-history.mjs'),provider={id:'doubao',name:'豆包'};
 const pair=q=>[{id:q,role:'user',content:q,status:'complete'}, {id:q+'a',role:'assistant',content:'answer '+q,status:'complete',replyTo:q}];
 const original=[...pair('A'),...pair('B'),...pair('C')];
 Object.assign(original[2],{images:[{name:'kept',dataUrl:'kept'}],webHistoryImagePrefix:{content:'[图片]',jobId:'confirmed-job'}});
 const web=[...original.slice(0,2),{role:'user',content:'[图片]'},...original.slice(2)].map(({role,content})=>({role,content}));
 assert.deepEqual(mergeWebHistory(original,web,provider).messages,original);
 for(const change of [{webHistoryImagePrefix:null},{webHistoryImagePrefix:{content:'[图片]'}},
  {webHistoryImagePrefix:{content:'[图片][图片]',jobId:'job'}},{images:[]},{images:[{},{}]},{status:'failed'}]){
  const local=structuredClone(original);Object.assign(local[2],change);const snapshot=structuredClone(local);
  assert.throws(()=>mergeWebHistory(local,web,provider),e=>e.code==='HISTORY_ALIGNMENT');
  assert.deepEqual(local,snapshot);
 }
 for(const incoming of [
  web.map((m,i)=>i===2?{...m,content:'[图片][图片]'}:m),
  web.map((m,i)=>i===2?{...m,content:'[图片] 附加文字'}:m),
  [...web.slice(0,3),{role:'assistant',content:'独立图片的回答'},...web.slice(3)],
  [...web.slice(0,2),...web.slice(3,5),...web.slice(2)]
 ]){
  assert.throws(()=>mergeWebHistory(original,incoming,provider),e=>e.code==='HISTORY_ALIGNMENT');
 }
 const duplicate=structuredClone(original);duplicate.push(...pair('B'));
 assert.throws(()=>mergeWebHistory(duplicate,web,provider),e=>e.code==='HISTORY_ALIGNMENT');
 assert.throws(()=>mergeWebHistory(original,web,{id:'yuanbao',name:'元宝'}),e=>e.code==='HISTORY_ALIGNMENT');
});


test('history pictures enrich existing rows without changing identity; repeat, export and import preserve previews',async t=>{
 const {mergeWebHistory}=await import('../electron/web-history.mjs');
 const f=fixture(t),web=[{role:'user',content:'[图片]\n\n[图片]\n问题'},{role:'assistant',content:'回答'}];
 const original=mergeWebHistory([],web).messages,before=structuredClone(original);
 const incoming=structuredClone(web);incoming[0].historyImages=[{index:0,src:'https://images.example.com/a.jpg'},{index:1,src:'https://images.example.com/b.jpg'}];
 const result=mergeWebHistory(original,incoming);
 assert.equal(result.added,0);assert.equal(result.messages[0].historyImages.length,2);
 assert.deepEqual(original,before);assert.deepEqual(result.messages.map(m=>m.id),original.map(m=>m.id));
 assert.deepEqual(mergeWebHistory(result.messages,incoming).messages,result.messages);
 assert.deepEqual(mergeWebHistory(result.messages,web).messages,result.messages);
 f.store.put('conversation',{id:'pictures',title:'图片',messages:result.messages,mode:'single',connectionIds:[],tags:[],webChat:{url:f.url}});
 const engine=new Engine(f.store,{encrypt:v=>v,decrypt:v=>v});
 engine.importData(engine.exportData('pictures'));
 const restored=f.store.all('conversation').find(c=>c.id!=='pictures');
 assert.deepEqual(restored.messages[0].historyImages,result.messages[0].historyImages);
});

test('history image validation rejects active/local sources and ambiguous positions',async()=>{
 const {mergeWebHistory}=await import('../electron/web-history.mjs');
 for(const src of ['javascript:alert(1)','file:///a.png','http://example.com/a','https://127.0.0.1/a','https://user:pass@example.com/a','data:image/svg+xml;base64,PHN2Zz4=']){
  assert.throws(()=>mergeWebHistory([],[{role:'user',content:'[图片]',historyImages:[{index:0,src}]}]));
 }
 assert.throws(()=>mergeWebHistory([],[{role:'user',content:'[图片]',historyImages:[{index:1,src:'https://example.com/a'}]}]));
 assert.throws(()=>mergeWebHistory([],[{role:'user',content:'[图片]',historyImages:[{index:0,src:'https://example.com/a'},{index:0,src:'https://example.com/b'}]}]));
});

test('question alignment enriches only identical rows and retains existing local image bytes',async()=>{
 const {mergeWebHistory}=await import('../electron/web-history.mjs');
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=';
 const original=mergeWebHistory([],[{role:'user',content:'A [图片]'},{role:'assistant',content:'old A'},{role:'user',content:'B'},{role:'assistant',content:'old B'}]).messages;
 const incoming=[{role:'user',content:'A [图片]',historyImages:[{index:0,src:png}]},{role:'assistant',content:'new A'},{role:'user',content:'B'},{role:'assistant',content:'new B'}];
 const result=mergeWebHistory(original,incoming);assert.equal(result.retainedDifferences,2);assert.equal(result.messages[0].historyImages[0].src,png);
 incoming[0].historyImages[0].src='https://example.com/expired.png';
 assert.equal(mergeWebHistory(result.messages,incoming).messages[0].historyImages[0].src,png);
});


test('X Grok canonical URLs, isolated jobs and loaded-history roundtrip',t=>{
 const f=fixture(t),grok=new WebChat(f.store,()=>{},()=>1000,'grok');
 const clientId=randomUUID(),url='https://x.com/i/grok?conversation=known';
 const binding=grok.bind({clientId,url:url+'&s=20',ready:true,historyEnabled:true});
 assert.equal(grok.status().url,url);const task=grok.poll({clientId,...binding,url,ready:true}).historyRequest;
 const saved=grok.history({clientId,...binding,url,requestId:task.id,messages:[{role:'user',content:'原问题'},{role:'assistant',content:'原回答'}]});assert.equal(saved.accepted,true);
 const sent=grok.send({bindingId:binding.bindingId,text:'新问题'}),job=grok.poll({clientId,...binding,url,ready:true}).job;assert.equal(job.id,sent.jobId);assert.equal(f.chat.active(),undefined);
 assert.equal(grok.report({clientId,...binding,url,jobId:job.id,lease:job.lease,sequence:1,phase:'complete',content:'新回答'}).accepted,true);
 const engine=new Engine(f.store,{encrypt:v=>v,decrypt:v=>v});const exported=engine.exportData(saved.conversationId);engine.importData(exported);assert.equal(f.store.all('conversation').filter(c=>c.webChat?.provider==='Grok').length,2);
 for(const bad of ['https://grok.com/','https://x.com/home','https://x.com.evil.test/i/grok','http://x.com/i/grok','https://u:p@x.com/i/grok','https://x.com/i/grok?conversation=%2Fbad'])assert.throws(()=>grok.bind({clientId,url:bad,ready:true}));
});


test('proven Grok unsent text attempt is retained without blocking the subsequent sent retry history',async()=>{
 const {mergeWebHistory}=await import('../electron/web-history.mjs'),provider={id:'grok',name:'Grok'};
 const web=[{role:'user',content:'原问题'},{role:'assistant',content:'原回答'},{role:'user',content:'重试问题'},{role:'assistant',content:'新回答'}];
 const base=mergeWebHistory([],web.slice(0,2),provider).messages;
 const failedQ={id:'attempt',role:'user',content:'重试问题',status:'complete',images:[]},failedA={id:'failed',role:'assistant',content:'',status:'failed',replyTo:'attempt',connectionId:'web:grok',error:'未识别到可用的 Grok 发送按钮；已保留网页草稿，请复制连接诊断'};
 const sent=mergeWebHistory([],web.slice(2),provider).messages;
 const local=[...base,failedQ,failedA,...sent],job={provider:'grok',messageId:'failed',state:'failed',sequence:1,text:'重试问题',images:[]};
 const before=structuredClone(local),merged=mergeWebHistory(local,web,provider,[job]);assert.equal(merged.retainedUnsentAttempts,1);assert.equal(merged.added,0);assert.deepEqual(merged.messages,before);assert.deepEqual(local,before);
 for(const jobs of [[],[{...job,sequence:2}],[{...job,text:'其他'}]])assert.throws(()=>mergeWebHistory(local,web,provider,jobs),e=>e.code==='HISTORY_ALIGNMENT');
});


test('ChatGPT and Gemini canonicalize official conversation URLs and reject unrelated pages',async()=>{
 const {webChatSource}=await import('../browser-extension/web-providers.js');
 assert.equal(webChatSource('https://chatgpt.com/c/uuid/?model=gpt#x','chatgpt').url,'https://chatgpt.com/c/uuid');
 assert.equal(webChatSource('https://gemini.google.com/app/abc/?hl=zh#x','gemini').url,'https://gemini.google.com/app/abc');
 for(const bad of ['http://chatgpt.com/','https://chatgpt.com.evil.test/','https://u:p@chatgpt.com/','https://chatgpt.com:444/','https://chatgpt.com/auth/login','https://chatgpt.com/share/abc','https://chatgpt.com/g/gpt-test','https://gemini.google.com/share/abc','https://gemini.google.com/app/a/b'])assert.throws(()=>webChatSource(bad));
 assert.throws(()=>webChatSource('https://gemini.google.com/app/abc','chatgpt'));
});

test('ChatGPT and Gemini jobs, histories, cancellation and reconnect are independent',t=>{
 const f=fixture(t),platforms=[['chatgpt','ChatGPT','https://chatgpt.com/c/test'],['gemini','Gemini','https://gemini.google.com/app/test']];
 const chats=platforms.map(([provider,name,url])=>{const chat=new WebChat(f.store,()=>{},()=>1000,provider),clientId=randomUUID(),binding=chat.bind({clientId,url,ready:true,historyEnabled:true,imageEnabled:true,historyScanEnabled:true}),auth={clientId,...binding};const task=chat.poll(auth).historyRequest;assert.equal(chat.history({...auth,url,requestId:task.id,messages:[{role:'user',content:'原问题'},{role:'assistant',content:name+'原回答'}]}).accepted,true);assert.throws(()=>chat.requestHistory({bindingId:binding.bindingId,scan:true}),/已加载/);const sent=chat.send({bindingId:binding.bindingId,text:name+'新问题'}),job=chat.poll({...auth,url,ready:true}).job;return {chat,auth,binding,sent,job,url,name};});
 assert.notEqual(chats[0].sent.conversationId,chats[1].sent.conversationId);assert.notEqual(chats[0].job.id,chats[1].job.id);assert.throws(()=>chats[1].chat.report({...chats[1].auth,jobId:chats[0].job.id,lease:chats[0].job.lease,sequence:1,phase:'complete',content:'wrong',url:chats[1].url}),/不属于/);
 chats[0].chat.cancel();assert.equal(chats[1].chat.status().busy,true);
 const c=chats[1];assert.equal(c.chat.report({...c.auth,jobId:c.job.id,lease:c.job.lease,sequence:1,phase:'complete',content:'Gemini新回答',url:c.url}).accepted,true);
 const saved=f.store.get('conversation',c.sent.conversationId);assert.equal(saved.webChat.provider,'Gemini');assert.equal(saved.messages.at(-1).content,'Gemini新回答');
 const again=c.chat.bind({clientId:c.auth.clientId,url:c.url,ready:true});assert.equal(c.chat.status().conversationId,saved.id);assert.throws(()=>c.chat.poll(c.auth),/失效/);assert.equal(c.chat.poll({clientId:c.auth.clientId,...again,url:c.url,ready:true}).job,null);
 for(const item of chats){const engine=new Engine(f.store,{}),original=f.store.get('conversation',item.sent.conversationId),copy=engine.importData(engine.exportData(original.id));assert.equal(f.store.get('conversation',copy).webChat.provider,item.name);assert.equal(f.store.get('conversation',copy).webChat.url,item.url);assert.match(markdownExport(original),new RegExp(item.name));}
});

test('ChatGPT and Gemini allow a new-chat URL promotion but refuse changing an established conversation',t=>{
 const f=fixture(t);for(const [provider,start,next] of [['chatgpt','https://chatgpt.com/','https://chatgpt.com/c/new'],['gemini','https://gemini.google.com/app','https://gemini.google.com/app/new']]){
 const chat=new WebChat(f.store,()=>{},()=>1000,provider),clientId=randomUUID(),binding=chat.bind({clientId,url:start,ready:true}),auth={clientId,...binding};const sent=chat.send({bindingId:binding.bindingId,text:'first'}),job=chat.poll({...auth,url:start,ready:true}).job;
 assert.equal(chat.report({...auth,jobId:job.id,lease:job.lease,sequence:1,phase:'streaming',content:'partial',url:next}).accepted,true);assert.equal(f.store.get('conversation',sent.conversationId).webChat.url,next);
 assert.throws(()=>chat.report({...auth,jobId:job.id,lease:job.lease,sequence:2,phase:'complete',content:'wrong',url:next.replace('/new','/other')}),/切换/);assert.equal(f.store.get('conversation',sent.conversationId).messages.at(-1).content,'partial');chat.cancel();
 }
});


test('joining establishes only a local identity for a connected page and is idempotent',t=>{const f=fixture(t);assert.equal(f.chat.status().conversationId,undefined);const id=f.chat.ensureConversation({bindingId:f.auth.bindingId});const c=f.store.get('conversation',id);assert.equal(c.webChat.url,f.url);assert.equal(c.webChat.history,undefined);assert.deepEqual(c.messages,[]);assert.equal(f.chat.status().conversationId,id);assert.equal(f.chat.ensureConversation({bindingId:f.auth.bindingId,conversationId:id}),id);assert.equal(f.store.all('conversation').length,1);assert.equal(f.store.all('webJob').length,0);});
test('failed or empty initial history does not prevent creating a member identity or fabricate history',t=>{for(const mode of ['failed','empty']){const f=fixture(t),b=f.chat.bind({clientId:f.auth.clientId,url:f.url,ready:true,historyEnabled:true}),auth={clientId:f.auth.clientId,...b};const result=f.chat.history({...auth,requestId:f.chat.status().history.id,url:f.url,messages:[],...(mode==='failed'?{error:'FIXTURE_HISTORY_FAILED'}:{})});assert.equal(result.accepted,mode==='empty');assert.equal(f.chat.status().conversationId,undefined);const phase=f.chat.status().history.phase,id=f.chat.ensureConversation({bindingId:b.bindingId}),c=f.store.get('conversation',id);assert.deepEqual(c.messages,[]);assert.equal(c.webChat.history,undefined);assert.equal(f.chat.status().history.phase,phase);}});
test('member identity creation rejects stale binding, wrong record, offline, draft and busy states',t=>{const f=fixture(t);assert.throws(()=>f.chat.ensureConversation({bindingId:'stale'}),/变化/);assert.throws(()=>f.chat.ensureConversation({bindingId:f.auth.bindingId,conversationId:'wrong'}),/变化/);assert.equal(f.store.all('conversation').length,0);f.chat.poll({...f.auth,url:f.url,ready:false,reason:'网页有草稿'});assert.throws(()=>f.chat.ensureConversation({bindingId:f.auth.bindingId}),/草稿/);f.chat.poll({...f.auth,url:f.url,ready:true});const busyBinding=f.chat.bind({clientId:f.auth.clientId,url:f.url,ready:true,historyEnabled:true});assert.throws(()=>f.chat.ensureConversation({bindingId:busyBinding.bindingId}),/同步/);f.chat.cancel();f.advance(16000);assert.throws(()=>f.chat.ensureConversation({bindingId:busyBinding.bindingId}),/变化/);assert.equal(f.store.all('conversation').length,0);});
test('member identity reuses existing history unchanged and refuses archived records',t=>{const f=fixture(t),sent=f.send('preserved question'),job=f.claim();f.report(job);const original=f.store.get('conversation',sent.conversationId);assert.equal(f.chat.ensureConversation({bindingId:f.auth.bindingId,conversationId:original.id}),original.id);assert.deepEqual(f.store.get('conversation',original.id),original);f.store.put('conversation',{...original,archived:true});assert.throws(()=>f.chat.ensureConversation({bindingId:f.auth.bindingId}),/归档/);assert.equal(f.store.all('conversation').length,1);});

const chatgptPreflight='无法确认当前消息位置，请复制连接诊断';
function unsentChatgptFixture(t){
 const dir=mkdtempSync(join(tmpdir(),'awb-gpt-unsent-')),store=new Store(dir);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const chat=new WebChat(store,()=>{},()=>Date.now(),'chatgpt'),url='https://chatgpt.com/c/unsent-fixture',clientId=randomUUID(),binding=chat.bind({url,clientId,ready:true,historyEnabled:true}),auth={...binding,clientId,url};
 // Reproduce the older unreadable-history state without inventing webpage messages.
 chat.history({...auth,requestId:chat.status().history.id,messages:[],error:'部分ChatGPT历史消息无法识别，请复制连接诊断'});
 const attempts=[];for(const text of ['FIRST_NEVER_SENT','SECOND_NEVER_SENT']){const sent=chat.send({bindingId:auth.bindingId,text}),job=chat.poll({...auth,ready:true}).job;chat.report({...auth,jobId:job.id,lease:job.lease,sequence:1,phase:'failed',content:'',error:chatgptPreflight});attempts.push({...sent,job});}
 const conversationId=attempts[0].conversationId,original=store.get('conversation',conversationId).messages;
 const sync=()=>{chat.requestHistory({bindingId:auth.bindingId,conversationId});return chat.history({...auth,requestId:chat.status().history.id,messages:[{role:'user',content:'你好'},{role:'assistant',content:'真实网页已有回答'}]});};return {store,chat,auth,attempts,conversationId,original,sync};
}
test('ChatGPT imports real history around two proven preflight failures, keeping attempts and bookmarks without sending',t=>{
 const f=unsentChatgptFixture(t);f.store.put('excerpt',{id:randomUUID(),conversationId:f.conversationId,messageId:f.original[1].id,content:'keep bookmark'});
 const result=f.sync();assert.equal(result.accepted,true);assert.equal(result.added,2);assert.match(result.message,/保留 2 次未发送成功的本地尝试/);
 const saved=f.store.get('conversation',f.conversationId);assert.equal(saved.messages.length,6);assert.deepEqual(saved.messages.slice(2),f.original);assert.equal(saved.messages[0].content,'你好');assert.equal(saved.messages[1].replyTo,saved.messages[0].id);assert.equal(f.store.all('excerpt')[0].messageId,f.original[1].id);assert.equal(f.store.all('webJob').length,2);assert.equal(f.chat.poll({...f.auth,ready:true}).job,null);
 const ids=saved.messages.map(m=>m.id);const again=f.sync();assert.equal(again.accepted,true);assert.equal(again.added,0);assert.deepEqual(f.store.get('conversation',f.conversationId).messages.map(m=>m.id),ids);
 const next=f.chat.send({bindingId:f.auth.bindingId,conversationId:f.conversationId,text:'NEW_EXPLICIT_QUESTION'}),job=f.chat.poll({...f.auth,ready:true}).job;assert.equal(job.id,next.jobId);assert.equal(job.text,'NEW_EXPLICIT_QUESTION');assert.equal(f.chat.poll({...f.auth,ready:true}).job,null);
});
test('ChatGPT preflight exclusion requires exact error, first report, text and message ownership; uncertain sends remain conflicts',t=>{
 for(const mutation of ['missing','sequence','text','owner','provider','error','partial']){
  const f=unsentChatgptFixture(t),first=f.attempts[0].job,j=f.store.get('webJob',first.id),c=f.store.get('conversation',f.conversationId);
  if(mutation==='missing')f.store.remove('webJob',j.id);
  else if(mutation==='error'){c.messages[1].error='发送状态不确定，请检查ChatGPT网页；不会自动重发';f.store.put('conversation',c);}
  else if(mutation==='partial'){c.messages[1].content='possible generated answer';f.store.put('conversation',c);}
  else{if(mutation==='sequence')j.sequence=2;if(mutation==='text')j.text='OTHER';if(mutation==='owner')j.messageId=c.messages[3].id;if(mutation==='provider')j.provider='gemini';f.store.put('webJob',j);}
  const before=f.store.get('conversation',f.conversationId).messages,result=f.sync();assert.equal(result.accepted,false,mutation);assert.equal(result.code,'HISTORY_ALIGNMENT',mutation);assert.deepEqual(f.store.get('conversation',f.conversationId).messages,before,mutation);
 }
});
