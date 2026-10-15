import {createHash,randomUUID} from 'node:crypto';
import {validateHistoryImages,enrichHistoryImages} from './history-images.mjs';
const fingerprint=m=>createHash('sha256').update(m.role+'\0'+m.content.replace(/\r\n/g,'\n').trim()).digest('hex');
const imageOnly=m=>m?.role==='user'&&/^(?:\s*\[图片(?:：[^\]\r\n]*)?\]\s*)+$/.test(m.content);
function turns(messages){
 const result=[];for(const m of messages){if(m.role==='user')result.push({key:fingerprint(m),messages:[m]});else if(result.length)result.at(-1).messages.push(m);else return null;}return result;
}
// Only this legacy upload error at the first report proves begin() was never called.
// Require the original local job and attachment ownership; arbitrary failed turns cannot be skipped.
function unsentUploadTurns(existing,jobs,provider){
 const groups=turns(existing)||[];
 return groups.filter(t=>{
  if(t.messages.length!==2)return false;
  const [q,a]=t.messages;
  // This exact Grok error is emitted before click; a first failed report plus
  // the persisted job proves an unsent text attempt. Never skip uncertain sends.
  if(provider.id==='grok'&&!q.images?.length&&a.role==='assistant'&&a.status==='failed'&&!a.content&&
    a.replyTo===q.id&&a.connectionId==='web:grok'&&
    a.error==='未识别到可用的 Grok 发送按钮；已保留网页草稿，请复制连接诊断'){
   return jobs.some(j=>j.provider==='grok'&&j.messageId===a.id&&j.state==='failed'&&j.sequence===1&&j.text===q.content&&!j.images?.length);
  }
  return q.images?.length>0&&a.role==='assistant'&&a.status==='failed'&&!a.content&&
   a.replyTo===q.id&&a.connectionId==='web:'+provider.id&&
   a.error==='网页有多个图片上传入口，请在原网页添加图片'&&
   jobs.some(j=>j.messageId===a.id&&j.provider===provider.id&&j.state==='failed'&&j.sequence===1&&
    j.text===q.content&&JSON.stringify(j.images)===JSON.stringify(q.images));
 });
}
function questionAlignment(existing,incoming,provider){
 const a=turns(incoming),b=turns(existing);if(!a||!b||a.length<2||b.length<2)return null;
 const recoverable=(t,index)=>index===b.length-1&&t.messages.length===2&&
   ['failed','interrupted'].includes(t.messages[1].status)&&t.messages[1].role==='assistant'&&
   t.messages[1].replyTo===t.messages[0].id&&t.messages[1].connectionId==='web:'+provider.id;
 const counts=items=>{const map=new Map();for(const item of items)map.set(item.key,(map.get(item.key)||0)+1);return map;};
 const ac=counts(a),bc=counts(b),candidates=[];
 // A standalone image placeholder between two uniquely matching answered questions
 // can change with lazy previews. Preserve the local fragment; never use it to
 // recover an answer or infer that the underlying image bytes are identical.
 const imageGap=(i,j)=>{
  if(!imageOnly(a[i]?.messages[0])||!imageOnly(b[j]?.messages[0])||
   a[i].messages.length!==1||b[j].messages.length!==1||
   !b[j].messages[0].webHistory||b[j].messages[0].status!=='complete')return false;
  return [-1,1].every(d=>{
   const remote=a[i+d],local=b[j+d];
   return remote&&local&&remote.key===local.key&&ac.get(remote.key)===1&&bc.get(local.key)===1&&
    remote.messages.length===2&&remote.messages[1].role==='assistant'&&local.messages.length===2&&
    local.messages[1].role==='assistant'&&local.messages[1].status==='complete';
  });
 };
 for(let offset=-(b.length-1);offset<a.length;offset++){
  const start=Math.max(0,offset),end=Math.min(a.length,offset+b.length);let anchors=0,equal=true;
  for(let i=start;i<end;i++){
   const local=b[i-offset],remote=a[i];
   if(remote.key!==local.key){if(imageGap(i,i-offset))continue;equal=false;break;}
   // Imported consecutive questions can legitimately have no separate answer.
   if(remote.messages.length===1&&local.messages.length===1&&local.messages[0].webHistory&&local.messages[0].status==='complete')continue;
   if(remote.messages.length!==2||remote.messages[1].role!=='assistant'||local.messages.length!==2||
      !(local.messages[1].status==='complete'||recoverable(local,i-offset))){equal=false;break;}
   // An incomplete turn cannot supply evidence for its own recovery.
   if(local.messages[1].status==='complete'&&ac.get(remote.key)===1&&bc.get(remote.key)===1)anchors++;
  }
  if(equal&&anchors>=2)candidates.push({offset,overlap:end-start});
 }
 const best=candidates.filter(c=>c.overlap===Math.max(0,...candidates.map(x=>x.overlap)));
 if(best.length!==1)return null;
 const offset=best[0].offset,messages=[];let differences=0,recovered=0,imageDifferences=0;
 for(let i=Math.min(0,offset);i<Math.max(a.length,offset+b.length);i++){
  if(i>=offset&&i<offset+b.length){
   const local=b[i-offset];
   if(a[i]&&recoverable(local,i-offset)){
    messages.push({local:local.messages[0]},{local:local.messages[1],recovered:a[i].messages[1]});recovered++;
   }else{
    messages.push(...local.messages.map((message,index)=>({local:enrichHistoryImages(message,a[i]?.messages[index])})));
    if(a[i]&&a[i].key!==local.key&&imageGap(i,i-offset))imageDifferences++;
    if(a[i]?.messages[1]&&local.messages[1]&&fingerprint(a[i].messages[1])!==fingerprint(local.messages[1]))differences++;
   }
  }else messages.push(...a[i].messages.map(message=>({incoming:message})));
 }
 return {messages,differences,recovered,imageDifferences};
}

function imagePrefixCount(message){
 return imageOnly(message)?[...message.content.matchAll(/\[图片(?:：[^\]\r\n]*)?\]/g)].length:0;
}
function uploadedTailAlignment(existing,incoming,provider,jobs){
 // Recover only the historical Doubao receiver failure after upload ack + begin + tick.
 // A unique caption and the split preview must agree with the persisted image job.
 // Preview counts corroborate the attempt; they do not verify remote image bytes.
 if(provider.id!=='doubao')return null;
 const local=turns(existing),remote=turns(incoming),last=local?.at(-1);
 if(!last||last.messages.length!==2||!remote||remote.length<2)return null;
 const [q,a]=last.messages;
 if(a.role!=='assistant'||a.status!=='failed'||a.content||a.replyTo!==q.id||
  a.connectionId!=='web:doubao'||a.error!=='本次提问与原会话无法可靠衔接，请核对豆包网页'||
  !q.images?.length||q.images.length>3)return null;
 const matches=jobs.filter(j=>j.messageId===a.id&&j.provider==='doubao'&&j.state==='failed'&&j.sequence===3&&
  j.text===q.content&&JSON.stringify(j.images)===JSON.stringify(q.images));
 if(matches.length!==1||local.filter(t=>t.key===last.key).length!==1||
  remote.filter(t=>t.key===last.key).length!==1)return null;
 const prefix=remote[0],target=remote[1];
 if(prefix.messages.length!==1||imagePrefixCount(prefix.messages[0])!==q.images.length||
  target.key!==last.key||target.messages.length!==2||target.messages[1].role!=='assistant')return null;
 // This narrow window starts with the image preview and the caption. Every later
 // turn must be complete and new, so no out-of-order local turn can be appended.
 if(remote.slice(2).some(t=>t.messages.length!==2||t.messages[1].role!=='assistant'||
  local.some(old=>old.key===t.key))||new Set(remote.slice(1).map(t=>t.key)).size!==remote.length-1)return null;
 const messages=existing.slice(0,-2).map(message=>({local:message}));
 messages.push({local:q,imagePrefix:{content:prefix.messages[0].content,jobId:matches[0].id}},
  {local:a,recovered:target.messages[1]});
 messages.push(...remote.slice(2).flatMap(t=>t.messages.map(message=>({incoming:message}))));
 return {messages,differences:0,recovered:1,imageDifferences:0,method:'uploaded-job'};
}
function normalizeObservedPrefix(existing,incoming,provider){
 // A previously recovered upload has an observed split-preview attached to its
 // local caption. Full scans put that same turn in the middle, not necessarily
 // at the start. Normalize only that recorded representation, at any position.
 if(provider.id!=='doubao')return incoming;
 const questions=messages=>{
  const byKey=new Map();
  for(const m of messages)if(m.role==='user'){
   const key=fingerprint(m);byKey.set(key,[...(byKey.get(key)||[]),m]);
  }
  return byKey;
 };
 const local=questions(existing),remote=questions(incoming),skip=new Set();
 for(let i=0;i+2<incoming.length;i++){
  const preview=incoming[i],caption=incoming[i+1];
  if(!imagePrefixCount(preview)||caption.role!=='user'||incoming[i+2].role!=='assistant')continue;
  const key=fingerprint(caption),matches=local.get(key)||[];
  if(matches.length!==1||remote.get(key)?.length!==1)continue;
  const question=matches[0],observation=question.webHistoryImagePrefix;
  if(!observation?.jobId||question.status!=='complete'||!question.images?.length||
    imagePrefixCount(preview)!==question.images.length||
    imagePrefixCount({role:'user',content:observation.content})!==question.images.length)continue;
  // Preview counts are only evidence of the already recorded display shape,
  // never equality of image bytes. Keep the original local images and metadata.
  skip.add(i);
 }
 return skip.size?incoming.filter((_,i)=>!skip.has(i)):incoming;
}
function alignmentError(existing,incoming){
 const existingQuestions=existing.filter(m=>m.role==='user'),incomingQuestions=incoming.filter(m=>m.role==='user');
 const incomingKeys=new Set(incomingQuestions.map(fingerprint));
 const e=new Error('历史与本地记录无法可靠衔接；可在原网页加载包含已有问答的内容后重试，或将网页历史另存为新会话。原记录和收藏保持不变');
 e.code='HISTORY_ALIGNMENT';e.diagnostics={localMessages:existing.length,webMessages:incoming.length,localQuestions:existingQuestions.length,webQuestions:incomingQuestions.length,matchingQuestions:existingQuestions.filter(m=>incomingKeys.has(fingerprint(m))).length,
  questionOutline:incomingQuestions.slice(0,50).map((m,index)=>({
   index,characters:m.content.length,imageOnly:imageOnly(m),
   matchingLocalIndexes:existingQuestions.flatMap((q,i)=>fingerprint(q)===fingerprint(m)?[i]:[]).slice(0,50)
  })),outlineTruncated:incomingQuestions.length>50,
  localImageOnlyIndexes:existingQuestions.flatMap((m,i)=>imageOnly(m)?[i]:[]).slice(0,50)};

 return e;
}
function historyMessage(m,capturedAt,provider){
 return {...(m.historyImages?.length?{historyImages:m.historyImages}:{}),id:randomUUID(),role:m.role,content:m.content,status:'complete',createdAt:capturedAt,webHistory:true,
 ...(m.role==='assistant'?{connectionId:'web:'+provider.id,connectionName:provider.name+' · 网页账号',provider:provider.name,model:'网页历史 · 型号未记录',context:[]}:{targetIds:[]})};
}
function linkReplies(messages){
 let lastUser;for(const m of messages){if(m.role==='user')lastUser=m.id;else if(m.webHistory&&!m.replyTo)m.replyTo=lastUser;}
}
export function mergeWebHistory(existing,incoming,provider={id:'yuanbao',name:'元宝'},jobs=[]){
 if(!Array.isArray(incoming)||incoming.length>1000)throw new Error('历史消息数量超过容量');
 let total=0;
 for(const m of incoming){
  if(!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.trim())throw new Error('历史消息格式不完整');
  total+=m.content.length;
 }
 if(total>400000)throw new Error('已加载历史超过 40 万字符，未修改本地记录');
 let imageBytes=0;
 incoming=incoming.map(m=>{
  const images=validateHistoryImages(m.historyImages,m.content);
  imageBytes+=images.reduce((n,image)=>n+image.src.length,0);
  if(imageBytes>10000000)throw new Error('历史图片超过本次容量');
  return images.length?{...m,historyImages:images}:m;
 });
 if(!incoming.length)return {messages:existing,added:0};
 const unsent=unsentUploadTurns(existing,jobs,provider);
 if(unsent.length){
  const skipped=new Set(unsent.flatMap(t=>t.messages.map(m=>m.id)));
  const kept=existing.filter(m=>!skipped.has(m.id));
  let merged;
  try{merged=mergeWebHistory(kept,incoming,provider,jobs);}
  catch(error){
   if(error.code==='HISTORY_ALIGNMENT'){
    const report=alignmentError(existing,incoming);
    report.diagnostics.comparedLocalMessages=kept.length;
    report.diagnostics.retainedUnsentAttempts=unsent.length;
    throw report;
   }
   throw error;
  }
  // Reinsert untouched local attempts before the next original message. All IDs and
  // attachments survive, so existing bookmarks keep their target.
  const before=new Map();let pending=[];
  for(const m of existing){
   if(skipped.has(m.id))pending.push(m);
   else if(pending.length){before.set(m.id,pending);pending=[];}
  }
  const messages=merged.messages.flatMap(m=>[...(before.get(m.id)||[]),m]);
  messages.push(...pending);
  return {...merged,messages,added:messages.length-existing.length,retainedUnsentAttempts:unsent.length};
 }
 incoming=normalizeObservedPrefix(existing,incoming,provider);
 const a=incoming.map(fingerprint),b=existing.map(fingerprint);
 // Accept only a unique contiguous alignment that covers the shared interval.
 // Repeated prompts retain their positions; content is never globally deduplicated.
 let offsets=[];
 if(!b.length)offsets=[0];
 else for(let offset=-(b.length-1);offset<a.length;offset++){
  const start=Math.max(0,offset),end=Math.min(a.length,offset+b.length);
  if(end-start<Math.min(2,a.length,b.length))continue;
  let equal=true;
  for(let i=start;i<end;i++)if(a[i]!==b[i-offset]){equal=false;break;}
  if(equal)offsets.push({offset,overlap:end-start});
 }
 let offset=0;
 if(b.length){
  const max=Math.max(0,...offsets.map(x=>x.overlap)),best=offsets.filter(x=>x.overlap===max);
  const aligned=(best.length!==1||['failed','interrupted'].includes(existing.at(-1)?.status))?(questionAlignment(existing,incoming,provider)||uploadedTailAlignment(existing,incoming,provider,jobs)):null;
  if(aligned){
   const capturedAt=new Date().toISOString(),messages=aligned.messages.map(m=>{
    if(m.recovered){
      const {error,phase,...local}=m.local;
      return {...local,content:m.recovered.content,status:'complete',historyRecovery:{capturedAt,previousContent:m.local.content,previousStatus:m.local.status,previousError:error||''}};
    }
    if(m.imagePrefix)return {...m.local,webHistoryImagePrefix:{...m.imagePrefix,capturedAt}};
    return m.local||historyMessage(m.incoming,capturedAt,provider);
   });linkReplies(messages);
   return {messages,added:messages.length-existing.length,retainedDifferences:aligned.differences,retainedImageDifferences:aligned.imageDifferences,recoveredAnswers:aligned.recovered,alignment:aligned.method||'questions'};
  }
  if(best.length!==1)throw alignmentError(existing,incoming);
  offset=best[0].offset;
 }
 const messages=[],capturedAt=new Date().toISOString();
 for(let i=Math.min(0,offset);i<Math.max(a.length,offset+b.length);i++){
  if(i>=offset&&i<offset+b.length){messages.push(enrichHistoryImages(existing[i-offset],incoming[i]));continue;}
  const m=incoming[i];
  messages.push(historyMessage(m,capturedAt,provider));
 }
 linkReplies(messages);
 return {messages,added:messages.length-existing.length};
}
