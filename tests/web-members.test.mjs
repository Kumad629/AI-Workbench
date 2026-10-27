import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {Engine,markdownExport} from '../electron/engine.mjs';
import {Store} from '../electron/store.mjs';
import {WebChat} from '../electron/web-chat.mjs';
import {createWebMemberTransport,mirrorRecoveredWebReplies} from '../electron/web-members.mjs';
import {RECEIVER_TIMEOUT} from '../electron/web-recovery.mjs';
function setup(t){const dir=mkdtempSync(join(tmpdir(),'awb-web-members-')),store=new Store(dir),requests=[];const engine=new Engine(store,{encrypt:x=>x,decrypt:x=>{assert.ok(x);return x;}},()=>{},async(c,k,m,s,event)=>{requests.push(m);event({delta:'API_PRIVATE_ANSWER'});});const chats=Object.fromEntries(['chatgpt','gemini','yuanbao','doubao'].map(p=>[p,new WebChat(store,()=>{},()=>Date.now(),p)]));engine.webTransport=createWebMemberTransport({store,chats,interval:5});t.after(async()=>{for(const r of engine.running.values())r.controller.abort();await idle(engine);store.close();rmSync(dir,{recursive:true,force:true});});const bind=p=>{const chat=chats[p],url={gemini:'https://gemini.google.com/app/member',chatgpt:'https://chatgpt.com/c/member',yuanbao:'https://yuanbao.tencent.com/chat/naQivTmsDa/member',doubao:'https://www.doubao.com/chat/123456789'}[p],clientId=randomUUID(),b=chat.bind({url,clientId,ready:true,historyEnabled:true}),auth={...b,clientId,url};const result=chat.history({...auth,requestId:chat.status().history.id,messages:[{role:'user',content:'OLD_'+p},{role:'assistant',content:'OLD_ANSWER_'+p}]});assert.equal(result.accepted,true);const id=engine.saveWebConnection({provider:p,conversationId:result.conversationId});return {p,id,chat,auth,source:result.conversationId};};return {store,engine,chats,requests,bind};}
async function idle(engine){for(let i=0;i<500;i++){if(!engine.running.size)return;await pause(5);}throw Error('Test waiting for web member timed out');}
function claim(member){return member.chat.poll({...member.auth,ready:true}).job;}
function report(member,job,content,phase='complete',sequence=1){member.chat.report({...member.auth,jobId:job.id,lease:job.lease,sequence,phase,content,error:phase==='failed'?'FIXTURE_FAILURE':undefined});}
test('broadcast uses dedicated Gemini and ChatGPT pages once; @ and explicit quote stay private',async t=>{const {engine,store,bind,requests}=setup(t),g=bind('gemini'),c=bind('chatgpt'),api=engine.saveConnection({name:'API',provider:'DeepSeek',model:'fixture',baseUrl:'https://example.com',apiKey:'fixture'}),group=engine.createConversation({mode:'group',connectionIds:[g.id,c.id,api]});engine.send({conversationId:group,content:'SHARED_QUESTION'});const gj=claim(g),cj=claim(c);assert.equal(gj.text,'SHARED_QUESTION');assert.equal(cj.text,'SHARED_QUESTION');report(g,gj,'GEMINI_PRIVATE');report(c,cj,'GPT_PRIVATE');await idle(engine);assert.equal(requests.length,1);assert.equal(store.get('conversation',group).messages.length,4);engine.send({conversationId:group,content:'GEMINI_ONLY',targetIds:[g.id]});const follow=claim(g);assert.equal(follow.text,'GEMINI_ONLY');assert.equal(claim(c),null);assert.doesNotMatch(follow.text,/GPT_PRIVATE|API_PRIVATE/);report(g,follow,'GEMINI_FOLLOWUP');await idle(engine);const quote=store.get('conversation',group).messages.find(m=>m.content==='GPT_PRIVATE');engine.send({conversationId:group,content:'CHECK_THIS',targetIds:[g.id],quoteId:quote.id});const cross=claim(g);assert.match(cross.text,/GPT_PRIVATE/);assert.doesNotMatch(cross.text,/API_PRIVATE/);assert.equal(claim(c),null);report(g,cross,'CROSS_REVIEW');await idle(engine);const saved=store.get('conversation',group);assert.equal(saved.messages.at(-1).context.length,1);assert.equal(saved.messages.at(-1).webAccount,true);assert.match(markdownExport(saved),/网页账号/);});
test('cancelling one member keeps sibling running; rewritten streams replace rather than duplicate text',async t=>{const {engine,store,bind}=setup(t),g=bind('gemini'),c=bind('chatgpt'),group=engine.createConversation({mode:'group',connectionIds:[g.id,c.id]});engine.send({conversationId:group,content:'QUESTION'});const gj=claim(g),cj=claim(c),answers=store.get('conversation',group).messages.filter(m=>m.role==='assistant');report(g,gj,'old partial','streaming');await pause(15);engine.cancel({messageId:answers.find(m=>m.connectionId===g.id).id});assert.equal(c.chat.active().id,cj.id);report(c,cj,'prefix','streaming');await pause(15);report(c,cj,'rewritten final','complete',2);await idle(engine);const results=store.get('conversation',group).messages.filter(m=>m.role==='assistant');assert.equal(results.find(m=>m.connectionId===g.id).status,'cancelled');assert.equal(results.find(m=>m.connectionId===c.id).content,'rewritten final');assert.equal(store.get('webJob',gj.id).state,'cancelled');});
test('wrong binding, cross-group reuse, offline and oversized prompts never dispatch to another page',async t=>{const {engine,store,bind}=setup(t),g=bind('gemini'),group=engine.createConversation({mode:'group',connectionIds:[g.id]});engine.send({conversationId:group,content:'FIRST'});const job=claim(g);report(g,job,'DONE');await idle(engine);const other=engine.createConversation({mode:'group',connectionIds:[g.id]});engine.send({conversationId:other,content:'MUST_NOT_SEND'});await idle(engine);assert.match(store.get('conversation',other).messages.at(-1).error,/另一条/);assert.equal(claim(g),null);assert.throws(()=>engine.send({conversationId:group,content:'x'.repeat(100001)}),/过长/);assert.equal(claim(g),null);g.chat.disconnect();g.chat.bind({url:'https://gemini.google.com/app/different',clientId:randomUUID(),ready:true});engine.send({conversationId:group,content:'WRONG_PAGE'});await idle(engine);assert.match(store.get('conversation',group).messages.at(-1).error,/专用网页/);assert.equal(g.chat.active(),undefined);});
test('one disconnected member fails independently; a failed web job is not automatically resent on restart',async t=>{const {engine,store,bind,requests}=setup(t),g=bind('gemini'),api=engine.saveConnection({name:'API',provider:'DeepSeek',model:'fixture',baseUrl:'https://example.com',apiKey:'fixture'}),group=engine.createConversation({mode:'group',connectionIds:[g.id,api]});g.chat.disconnect();engine.send({conversationId:group,content:'QUESTION'});await idle(engine);assert.equal(requests.length,1);assert.equal(store.all('webJob').length,0);assert.equal(store.get('conversation',group).messages.at(-2).status,'failed');const restored=new Engine(store,{decrypt:()=>{throw Error('must not run');}});assert.equal(restored.running.size,0);assert.equal(store.all('webJob').length,0);});
test('saving a web member is idempotent, credential-free, and four providers remain separate',async t=>{const {engine,store,bind}=setup(t),members=['gemini','chatgpt','yuanbao','doubao'].map(bind);for(const m of members){assert.equal(engine.saveWebConnection({provider:m.p,conversationId:m.source}),m.id);assert.equal(store.secret(m.id),undefined);assert.equal(store.get('connection',m.id).kind,'web');}assert.equal(new Set(members.map(m=>m.id)).size,4);assert.throws(()=>engine.saveWebConnection({provider:'chatgpt',conversationId:members[0].source}));});

test('four web providers broadcast independently and exported group messages preserve webpage provenance',async t=>{const {engine,store,bind}=setup(t),members=['gemini','chatgpt','yuanbao','doubao'].map(bind),group=engine.createConversation({mode:'group',connectionIds:members.map(m=>m.id)});engine.send({conversationId:group,content:'FOUR_WAY'});for(const m of members){const job=claim(m);assert.equal(job.text,'FOUR_WAY');report(m,job,m.p+'_ANSWER');}await idle(engine);const saved=store.get('conversation',group);assert.equal(saved.messages.filter(m=>m.role==='assistant'&&m.status==='complete').length,4);const imported=engine.importData(engine.exportData(group)),copied=store.get('conversation',imported);assert.equal(copied.messages.filter(m=>m.webAccount).length,4);assert.ok(copied.messages.filter(m=>m.webAccount).every(m=>/^https:/.test(m.webUrl)));assert.equal(copied.connectionIds.length,0);});

const anchorFailure='本次提问位置已丢失，已停止接收';
async function failedReceiver(t,provider='gemini'){
 const fixture=setup(t),m=fixture.bind(provider),group=fixture.engine.createConversation({mode:'group',connectionIds:[m.id]});
 fixture.engine.send({conversationId:group,content:'UNIQUE_SENT_QUESTION'});const job=claim(m);
 m.chat.report({...m.auth,jobId:job.id,lease:job.lease,sequence:1,phase:'failed',content:'',error:anchorFailure});await idle(fixture.engine);
 return {...fixture,m,group,job,replyId:fixture.store.get('conversation',group).messages.at(-1).id};
}
function syncAnswer(f){const request=f.m.chat.requestHistory({bindingId:f.m.auth.bindingId,conversationId:f.m.source});return f.m.chat.history({...f.m.auth,requestId:f.m.chat.status().history.id,messages:[{role:'user',content:'OLD_'+f.m.p},{role:'assistant',content:'OLD_ANSWER_'+f.m.p},{role:'user',content:'UNIQUE_SENT_QUESTION'},{role:'assistant',content:'ALREADY_GENERATED_WEB_ANSWER'}]});}
for(const provider of ['gemini','chatgpt'])test(provider+' recorded receiver failure restores source and group answers without resending',async t=>{
 const f=await failedReceiver(t,provider),before=f.store.all('webJob').length,sourceId=f.store.get('conversation',f.m.source).messages.at(-1).id;
 assert.equal(f.store.get('conversation',f.group).messages.at(-1).webJobId,f.job.id);
 const result=syncAnswer(f);assert.equal(result.accepted,true);assert.equal(result.recoveredAnswers,1);
 const source=f.store.get('conversation',f.m.source).messages.at(-1);assert.equal(source.id,sourceId);assert.equal(source.status,'complete');assert.equal(source.historyRecovery.previousError,anchorFailure);
 assert.equal(mirrorRecoveredWebReplies(f.store,provider),1);const saved=f.store.get('conversation',f.group),reply=saved.messages.at(-1);
 assert.equal(saved.messages.length,2);assert.equal(reply.id,f.replyId);assert.equal(reply.status,'complete');assert.equal(reply.content,'ALREADY_GENERATED_WEB_ANSWER');assert.equal(reply.recoveredFromWeb,true);assert.equal(reply.error,undefined);
 assert.equal(mirrorRecoveredWebReplies(f.store,provider),0);assert.equal(f.store.all('webJob').length,before);assert.equal(claim(f.m),null);
});
test('legacy group reply recovers only with one unambiguous recorded job and preserves cancelled answers',async t=>{
 const f=await failedReceiver(t);let group=f.store.get('conversation',f.group);delete group.messages.at(-1).webJobId;delete group.messages.at(-1).webSourceMessageId;f.store.put('conversation',group);
 assert.equal(syncAnswer(f).accepted,true);f.store.put('webJob',{...f.store.get('webJob',f.job.id),id:randomUUID()});assert.equal(mirrorRecoveredWebReplies(f.store,'gemini'),0);
 group=f.store.get('conversation',f.group);group.messages.at(-1).webJobId=f.job.id;group.messages.at(-1).status='cancelled';f.store.put('conversation',group);assert.equal(mirrorRecoveredWebReplies(f.store,'gemini'),0);
 group.messages.at(-1).status='failed';delete group.messages.at(-1).webJobId;f.store.put('conversation',group);for(const j of f.store.all('webJob').filter(j=>j.id!==f.job.id))f.store.remove('webJob',j.id);
 assert.equal(mirrorRecoveredWebReplies(f.store,'gemini'),1);
});
test('receiver recovery rejects changed earlier answers and missing send evidence',async t=>{
 const f=await failedReceiver(t),before=f.store.get('conversation',f.m.source),request=f.m.chat.requestHistory({bindingId:f.m.auth.bindingId,conversationId:f.m.source});
 const result=f.m.chat.history({...f.m.auth,requestId:f.m.chat.status().history.id,messages:[{role:'user',content:'OLD_gemini'},{role:'assistant',content:'CHANGED_ANSWER'},{role:'user',content:'UNIQUE_SENT_QUESTION'},{role:'assistant',content:'MUST_NOT_REPLACE'}]});
 assert.equal(result.accepted,false);assert.deepEqual(f.store.get('conversation',f.m.source).messages,before.messages);assert.equal(mirrorRecoveredWebReplies(f.store,'gemini'),0);
 const recorded=f.store.get('webJob',f.job.id);recorded.sequence=0;f.store.put('webJob',recorded);assert.equal(syncAnswer(f).accepted,false);assert.equal(f.store.get('conversation',f.group).messages.at(-1).status,'failed');
});

test('web-member automatic timeout persists an explicit receiver failure while user cancellation stays cancelled',async t=>{
 const {store,chats,engine,bind}=setup(t),m=bind('gemini'),group=engine.createConversation({mode:'group',connectionIds:[m.id]}),transport=createWebMemberTransport({store,chats,interval:5});
 await assert.rejects(transport.run(store.get('connection',m.id),'TIMEOUT_TEST',AbortSignal.timeout(25),()=>{},{conversationId:group}),e=>e.message===RECEIVER_TIMEOUT);
 const job=store.all('webJob').at(-1),reply=store.get('conversation',m.source).messages.at(-1);assert.equal(job.state,'failed');assert.equal(reply.status,'failed');assert.equal(reply.error,RECEIVER_TIMEOUT);assert.equal(m.chat.active(),undefined);
});
async function legacyTimeout(t){
 const f=await failedReceiver(t),group=f.store.get('conversation',f.group),source=f.store.get('conversation',f.m.source),job=f.store.get('webJob',f.job.id),time=Date.now()-720100;
 job.state='cancelled';job.created=time;job.touched=time+719425;job.sequence=676;f.store.put('webJob',job);
 source.messages.at(-1).status='cancelled';source.messages.at(-1).error='已停止接收；Gemini网页可能仍在生成，请到网页查看。';f.store.put('conversation',source);
 const reply=group.messages.at(-1);reply.status='failed';reply.error='The operation was aborted';reply.createdAt=new Date(time).toISOString();reply.completedAt=new Date(time+720040).toISOString();f.store.put('conversation',group);return f;
}
test('recorded legacy twelve-minute abort repairs source and original group reply without repeating the question',async t=>{
 const f=await legacyTimeout(t),sourceId=f.store.get('conversation',f.m.source).messages.at(-1).id,before=f.store.all('webJob').length;assert.equal(syncAnswer(f).accepted,true);const source=f.store.get('conversation',f.m.source).messages.at(-1);assert.equal(source.id,sourceId);assert.equal(source.historyRecovery.previousStatus,'cancelled');assert.equal(mirrorRecoveredWebReplies(f.store,'gemini'),1);const reply=f.store.get('conversation',f.group).messages.at(-1);assert.equal(reply.id,f.replyId);assert.equal(reply.content,'ALREADY_GENERATED_WEB_ANSWER');assert.equal(reply.status,'complete');assert.equal(reply.recoveredFromWeb,true);assert.equal(f.store.all('webJob').length,before);assert.equal(claim(f.m),null);
});
test('legacy timeout evidence never converts user cancellation, early abort, missing IDs or wrong question into recovery',async t=>{
 for(const mode of ['user-cancelled','early','missing-task','wrong-source','wrong-question','wrong-url']){
  const f=await legacyTimeout(t),group=f.store.get('conversation',f.group),reply=group.messages.at(-1),source=f.store.get('conversation',f.m.source);
  if(mode==='user-cancelled')reply.status='cancelled';if(mode==='early')reply.completedAt=new Date(Date.parse(reply.createdAt)+20000).toISOString();if(mode==='missing-task')delete reply.webJobId;if(mode==='wrong-source')reply.webSourceMessageId='other';if(mode==='wrong-question')reply.context.at(-1).content='OTHER';f.store.put('conversation',group);if(mode==='wrong-url'){const c=f.store.get('connection',f.m.id);c.webUrl='https://gemini.google.com/app/other';f.store.put('connection',c);}
  assert.equal(syncAnswer(f).accepted,false,mode);assert.deepEqual(f.store.get('conversation',f.m.source).messages,source.messages,mode);assert.equal(mirrorRecoveredWebReplies(f.store,'gemini'),0,mode);
 }
});


test('100k web prompt passes intact for all providers; excess including quoted text fails before dispatch',async t=>{
 const {engine,store,bind}=setup(t);
 for(const provider of ['gemini','chatgpt','yuanbao','doubao']){
  const m=bind(provider),group=engine.createConversation({mode:'group',connectionIds:[m.id]}),text='甲'.repeat(99996)+'END!';
  assert.throws(()=>m.chat.send({bindingId:m.auth.bindingId,conversationId:m.source,text:text+'x'}),/100,000/);
  engine.send({conversationId:group,content:text});const job=claim(m);assert.equal(job.text,text);report(m,job,'QUOTE_BODY');await idle(engine);
  const before=store.get('conversation',group),quoteId=before.messages.at(-1).id;
  assert.throws(()=>engine.send({conversationId:group,content:text,quoteId}),/合计超过 100,000/);
  assert.deepEqual(store.get('conversation',group),before);assert.equal(claim(m),null);
 }
});
test('deleting a web member clears selections but preserves source, messages and excerpts; busy deletion rejected',async t=>{
 const {engine,store,bind}=setup(t),g=bind('gemini'),c=bind('chatgpt'),group=engine.createConversation({mode:'group',connectionIds:[g.id,c.id]});
 engine.send({conversationId:group,content:'KEEP',targetIds:[g.id]});const job=claim(g);
 assert.throws(()=>engine.deleteConnection({id:g.id}),/停止/);assert.ok(store.get('connection',g.id));
 report(g,job,'KEEP_REPLY');await idle(engine);
 const before=store.get('conversation',group),source=store.get('conversation',g.source);
 const excerpt={id:randomUUID(),conversationId:group,messageId:before.messages.at(-1).id,content:'KEEP_REPLY',note:'KEEP_NOTE'};store.put('excerpt',excerpt);
 engine.deleteConnection({id:g.id});assert.equal(store.all('connection').some(x=>x.id===g.id),false);
 assert.deepEqual(store.get('conversation',group).connectionIds,[c.id]);assert.deepEqual(store.get('conversation',group).messages,before.messages);
 assert.deepEqual(store.get('conversation',g.source),source);assert.deepEqual(store.get('excerpt',excerpt.id),excerpt);
 assert.ok(engine.saveWebConnection({provider:'gemini',conversationId:g.source}));
});
