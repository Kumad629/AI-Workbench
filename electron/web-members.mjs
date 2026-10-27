import {MAX_PROMPT_CHARACTERS} from '../shared/chat-limits.js';
import {setTimeout as pause} from 'node:timers/promises';
import {RECEIVER_TIMEOUT,receiverError} from './web-recovery.mjs';
export function createWebMemberTransport({store,chats,interval=180}){
 const validate=(connection,conversationId)=>{
  const chat=chats[connection.webProvider];if(!chat)throw Error('不支持的网页成员');
  const status=chat.status();
  if(!status.online||!status.ready||status.busy)throw Error(connection.name+'：'+(status.reason||'请连接专用网页并等待当前回答/同步完成'));
  if(status.conversationId!==connection.webConversationId||status.url!==connection.webUrl)throw Error(connection.name+'：当前连接的不是已绑定的专用网页，请打开原对话并重新连接');
  const source=store.get('conversation',connection.webConversationId);
  if(source.archived||source.webChat?.url!==status.url)throw Error('专用网页会话已归档或发生变化');
  if(conversationId&&connection.groupConversationId&&connection.groupConversationId!==conversationId)throw Error('这条专用网页已用于另一条工作台对话，请另建网页会话后添加成员，避免混入其他上下文');
  return {chat,status};
 };
 const run=async(connection,text,signal,onEvent,{conversationId})=>{
  signal.throwIfAborted();
  const {chat,status}=validate(connection,conversationId);
  if(typeof text!=='string'||!text.trim()||text.length>MAX_PROMPT_CHARACTERS)throw Error('网页成员每次最多接收 100,000 字符，请减少文件、引用或链接资料');
  const claimed={...connection,groupConversationId:conversationId};
  store.put('connection',claimed);
  const submitted=chat.send({conversationId:connection.webConversationId,bindingId:status.bindingId,text});
  const submittedJob=store.get('webJob',submitted.jobId);onEvent({webJobId:submitted.jobId,webSourceMessageId:submittedJob.messageId});
  const cancel=()=>{const active=chat.active();if(active?.id===submitted.jobId){if(signal.reason?.name==='TimeoutError')chat.finish(active,'failed',RECEIVER_TIMEOUT);else chat.cancel();}};
  signal.addEventListener('abort',cancel,{once:true});
  let previous='',previousPhase='';
  try{while(true){
   signal.throwIfAborted();chat.status();
   const job=store.get('webJob',submitted.jobId),source=store.get('conversation',submitted.conversationId),answer=source.messages.find(m=>m.id===job.messageId);
   if(!answer)throw Error('网页回答记录丢失，请查看原网页');
   if(answer.content!==previous){previous=answer.content;onEvent({content:answer.content});}
   const phase=answer.phase||'等待网页回答';if(phase!==previousPhase){previousPhase=phase;onEvent({phase});}
   if(['complete','failed','cancelled','interrupted'].includes(answer.status)){
    if(answer.status!=='complete')throw Error(answer.error||'网页接收已停止；不会自动重发，请先查看原网页');
    const current=store.get('connection',connection.id);
    if(current.webConversationId===source.id)store.put('connection',{...current,webUrl:source.webChat.url});
    return;
   }
   await pause(interval,undefined,{signal});
  }}catch(error){if(signal.aborted&&signal.reason?.name==='TimeoutError')throw Error(RECEIVER_TIMEOUT);throw error;}finally{signal.removeEventListener('abort',cancel);if(signal.aborted)cancel();}
 };
 return {validate,run};
}

export function mirrorRecoveredWebReplies(store,provider){
 let count=0;
 for(const connection of store.all('connection').filter(c=>c.kind==='web'&&c.webProvider===provider&&c.groupConversationId)){
  const source=store.all('conversation').find(c=>c.id===connection.webConversationId),group=store.all('conversation').find(c=>c.id===connection.groupConversationId);if(!source||!group)continue;
  const jobs=store.all('webJob').filter(j=>j.provider===provider&&j.conversationId===source.id&&['failed','cancelled'].includes(j.state));let dirty=false;
  for(const reply of group.messages.filter(m=>m.role==='assistant'&&m.webAccount&&m.connectionId===connection.id&&['failed','interrupted'].includes(m.status)&&(receiverError(m.error)||m.error==='The operation was aborted'))){
   const prompt=reply.context?.at(-1)?.content;if(!prompt)continue;
   const candidates=jobs.filter(j=>j.text===prompt&&(reply.webJobId?j.id===reply.webJobId:true));if(candidates.length!==1)continue;
   const job=candidates[0],answer=source.messages.find(m=>m.id===job.messageId),question=answer&&source.messages.find(m=>m.id===answer.replyTo);
   if(!answer||answer.status!=='complete'||!answer.content||question?.content!==prompt)continue;
   if(reply.webSourceMessageId&&reply.webSourceMessageId!==answer.id)continue;
   if(job.state==='cancelled'&&reply.error!=='The operation was aborted')continue;
   if(reply.error==='The operation was aborted'&&!(reply.webJobId===job.id&&reply.webSourceMessageId===answer.id&&answer.historyRecovery?.previousStatus==='cancelled'))continue;
   if(!reply.webJobId&&group.messages.filter(m=>m.connectionId===connection.id&&m.context?.at(-1)?.content===prompt).length!==1)continue;
   reply.content=answer.content;reply.status='complete';reply.webJobId=job.id;reply.webSourceMessageId=answer.id;reply.recoveredFromWeb=true;delete reply.error;delete reply.phase;dirty=true;count++;
  }
  if(dirty){group.updatedAt=new Date().toISOString();store.put('conversation',group);}
 }
 return count;
}
