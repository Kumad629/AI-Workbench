// Evidence for receiver-only failures; never treat an arbitrary cancellation as recoverable.
export const RECEIVER_TIMEOUT='网页回答接收超时（12 分钟），请先查看原网页；不会自动重发';
export const RECEIVER_EMPTY='已检测到网页回答，但正文读取为空，请复制连接诊断；不会自动重发';
export const receiverError=error=>['本次提问位置已丢失，已停止接收','本次提问位置持续缺失或无法可靠匹配，已停止接收',RECEIVER_TIMEOUT,RECEIVER_EMPTY].includes(error);
export function historyJobsWithReceiverEvidence(store,source,provider,name){
 const jobs=store.all('webJob').filter(j=>j.conversationId===source.id),connections=store.all('connection').filter(c=>c.kind==='web'&&c.webProvider===provider&&c.webConversationId===source.id&&c.webUrl===source.webChat?.url&&c.groupConversationId),groups=store.all('conversation');
 if(!['gemini','chatgpt'].includes(provider))return jobs;
 return jobs.map(job=>{
  if(job.provider!==provider||job.state!=='cancelled'||job.sequence<1||job.images?.length)return job;
  const answer=source.messages.find(m=>m.id===job.messageId),question=answer&&source.messages.find(m=>m.id===answer.replyTo);
  if(!answer||answer.role!=='assistant'||answer.status!=='cancelled'||answer.content||answer.connectionId!=='web:'+provider||answer.error!=='已停止接收；'+name+'网页可能仍在生成，请到网页查看。'||question?.content!==job.text)return job;
  const reports=connections.flatMap(c=>(groups.find(g=>g.id===c.groupConversationId)?.messages||[]).filter(m=>m.role==='assistant'&&m.webAccount&&m.connectionId===c.id&&m.status==='failed'&&m.error==='The operation was aborted'&&!m.content&&m.webJobId===job.id&&m.webSourceMessageId===answer.id&&m.context?.at(-1)?.content===question.content));
  if(reports.length!==1)return job;const report=reports[0],elapsed=Date.parse(report.completedAt)-Date.parse(report.createdAt),startGap=Math.abs(Date.parse(report.createdAt)-job.created),reported=job.touched-job.created;
  if(!(elapsed>=719000&&elapsed<=750000&&startGap<=2000&&reported>=700000&&reported<=750000))return job;
  return {...job,receiverTimeoutConfirmed:true};
 });
}
