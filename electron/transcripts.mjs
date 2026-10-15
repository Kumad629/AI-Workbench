import {randomUUID} from 'node:crypto';
import {MAX_ARCHIVE_CHARACTERS,splitCaptureText} from '../browser-extension/transfer.js';
export function createTranscript(input) {
  const bounded=(value,max)=>{if(typeof value!=='string'||value.length>max)throw new Error('导入字段格式不正确或内容过长');return value.trim();};
  const title=bounded(input.title,150),content=bounded(input.content,MAX_ARCHIVE_CHARACTERS),product=bounded(input.product||'Grok',80);
  if(!title||!content)throw new Error('请填写标题并粘贴原始对话');
  if(!Array.isArray(input.urls||[])||(input.urls||[]).length>20)throw new Error('来源链接格式不正确');
  const urls=(input.urls||[]).filter(Boolean).map(value=>{
    const url=new URL(bounded(value,4000));
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('来源只支持不含凭据的网页链接');
    return url.toString();
  });
  const createdAt=new Date().toISOString(),userId=randomUUID();
  const segments=splitCaptureText(content);
  return {
    id:randomUUID(),title,mode:'single',connectionIds:[],createdAt,updatedAt:createdAt,archived:false,
    folder:product+' 存档',tags:['外部对话'],source:{product,urls,note:bounded(input.note||'',20000),importedAt:createdAt},
    messages:[
      {id:userId,role:'user',content:'保存来自 '+product+' 的对话：'+title,status:'complete',createdAt,targetIds:[]},
      ...segments.map((content,index)=>({id:randomUUID(),role:'assistant',content,status:'complete',createdAt,replyTo:userId,connectionId:'archive:'+product,connectionName:product+' · 原文存档',provider:product,model:segments.length===1?'原始记录 · 未拆分发言角色':`原始记录 · 第 ${index+1}/${segments.length} 段`,isTranscript:true,context:[]}))
    ]
  };
}
