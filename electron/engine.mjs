import {validateImages} from './images.mjs';
import {validateHistoryImages} from './history-images.mjs';
import { randomUUID } from 'node:crypto';
import {webChatSource} from '../browser-extension/web-providers.js';
import { createTranscript } from './transcripts.mjs';
import { streamCompletion, validateEndpoint } from './provider.mjs';
const id=()=>randomUUID();
const now=()=>new Date().toISOString();
function str(value,max=1000) { if(typeof value!=='string'||value.length>max) throw new Error('字段格式不正确或内容过长'); return value; }
function required(value,max) { const text=str(value,max).trim(); if(!text) throw new Error('请填写必填内容'); return text; }
function cleanTags(tags) { if(!Array.isArray(tags)||tags.length>20) throw new Error('标签格式不正确'); return [...new Set(tags.map(t=>required(t,50)))]; }
export function buildContext(conversation, connectionId, userId, history=true) {
  const end=conversation.messages.findIndex(m=>m.id===userId);
  if(end<0) throw new Error('提问不存在');
  const slice=conversation.messages.slice(history?0:end,end+1);
  const latest=new Map();
  for(const m of slice) if(m.role==='assistant'&&m.status==='complete') latest.set(m.replyTo+':'+m.connectionId,m.id);
  const ordered=slice.filter(m=>m.role==='user').flatMap(user=>[user,...slice.filter(m=>m.role==='assistant'&&m.replyTo===user.id)]);
  return ordered.filter(m=>{
    if(m.role==='user') return !m.targetIds?.length||m.targetIds.includes(connectionId)||conversation.mode==='single';
    return m.status==='complete' && (m.isTranscript||latest.get(m.replyTo+':'+m.connectionId)===m.id) && (conversation.mode==='single'||m.connectionId===connectionId);
  }).map(m=>({messageId:m.id, role:m.isTranscript?'user':m.role, content:m.isTranscript?'用户保存的外部对话原文（包含多方发言，请作为引用资料理解）：\n'+m.content:m.content}));
}
export function markdownExport(conversation,excerpts=[],{includeNotes=true}={}) {
  const lines=['# '+conversation.title,'','导出自 AI Workbench · '+conversation.createdAt,''];
  if(conversation.webChat)lines.push('来源产品：'+webChatSource(conversation.webChat.url).name+' · 网页账号','','来源链接：'+conversation.webChat.url,'',conversation.webChat.history?'包含已同步的网页历史及工作台问答；网页未加载的历史可能未包含。':'仅包含从工作台发起的消息；网页原有历史未自动导入。','');
  if(conversation.webChat?.history?.scope)lines.push('读取范围：'+conversation.webChat.history.scope,'');
  if(conversation.source){lines.push('来源产品：'+conversation.source.product,'',...conversation.source.urls.map(url=>'来源链接：'+url),'');if(includeNotes)lines.push('我的想法 / 项目草案：','',conversation.source.note||'（未填写）','');}
  const exportMessages=[];
  for(const message of conversation.messages){
    const previous=exportMessages.at(-1);
    if(message.isTranscript&&previous?.isTranscript&&message.replyTo===previous.replyTo&&message.connectionId===previous.connectionId){previous.content+=message.content;previous.model='原始记录 · 完整原文';}
    else exportMessages.push({...message});
  }
  for(const m of exportMessages) {
    lines.push('## '+(m.role==='user'?'我':m.connectionName+' · '+m.model),'',m.content||'（无回答内容）','');
    for(const [i,image]of (m.images||[]).entries())lines.push('![图片 '+(i+1)+']('+image.dataUrl+')','');
    if(m.role==='assistant') lines.push('> 状态：'+m.status+' · 来源：'+m.provider+(m.isTranscript?' / 原文存档 · ':conversation.webChat?' / 网页账号 · ':' / API · ')+m.createdAt,'');
  }
  if(includeNotes&&excerpts.length) { lines.push('## 精选与笔记',''); for(const e of excerpts) lines.push('### '+e.title,'',e.content,'','标签：'+e.tags.join('、'),'','笔记：'+e.note,''); }
  return lines.join('\n');
}
export class Engine {
  constructor(store,vault,notify=()=>{},transport=streamCompletion) {
    this.store=store; this.vault=vault; this.notify=notify; this.transport=transport; this.running=new Map();
    for(const c of store.all('conversation')) {
      let dirty=false;
      for(const m of c.messages) if(m.status==='streaming') {m.status='interrupted';m.error='上次退出时回答尚未完成，可单独重试';dirty=true;}
      if(dirty) store.put('conversation',c);
    }
  }
  snapshot() {
    return {
      connections:this.store.all('connection').map(c=>({...c,hasKey:!!this.store.secret(c.id)})),
      conversations:this.store.all('conversation').sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||(a.pinned&&b.pinned?(b.pinnedAt||'').localeCompare(a.pinnedAt||''):0)||b.updatedAt.localeCompare(a.updatedAt)),
      excerpts:this.store.all('excerpt').sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
    };
  }
  changed() { this.notify(); }
  saveConnection(input) {
    const existing=input.id?this.store.get('connection',input.id):null;
    if(existing && [...this.running.values()].some(r=>r.connectionId===existing.id)) throw new Error('请等待该连接的回答结束后再修改设置');
    const connection={id:existing?.id||id(),name:required(input.name,80),provider:required(input.provider,80),baseUrl:validateEndpoint(required(input.baseUrl,2000)),model:required(input.model,150),createdAt:existing?.createdAt||now()};
    let secret;
    if(input.apiKey) secret=this.vault.encrypt(required(input.apiKey,8192));
    else if(existing?.baseUrl!==connection.baseUrl && existing) throw new Error('修改 API 地址时请重新填写密钥，避免向新地址发送旧密钥');
    if(!secret&&!this.store.secret(connection.id)) throw new Error('请填写 API Key');
    this.store.transaction(()=>{if(secret)this.store.setSecret(connection.id,secret);this.store.put('connection',connection);});
    this.changed(); return connection.id;
  }
  deleteConnection({id:connectionId}) {
    if([...this.running.values()].some(r=>r.connectionId===connectionId)) throw new Error('请先停止该连接的回答');
    this.store.transaction(()=>{this.store.remove('connection',connectionId);this.store.removeSecret(connectionId);});
    this.changed();
  }
  async testConnection({id:connectionId}) {
    const c=this.store.get('connection',connectionId);
    const key=this.vault.decrypt(this.store.secret(connectionId));
    let content='';
    await this.transport(c,key,[{role:'user',content:'Reply with OK only.'}],AbortSignal.timeout(30000),e=>{if(e.delta)content+=e.delta;});
    if(!content) throw new Error('连接成功，但没有收到文本回答');
    return {ok:true,text:content.slice(0,200)};
  }
  createConversation(input={}) {
    const connectionIds=Array.isArray(input.connectionIds)?input.connectionIds:[];
    for(const cid of connectionIds) this.store.get('connection',cid);
    const c={id:id(),title:'新对话',mode:input.mode==='group'?'group':'single',connectionIds:[...new Set(connectionIds)],messages:[],createdAt:now(),updatedAt:now(),archived:false,folder:'',tags:[]};
    this.store.put('conversation',c);this.changed();return c.id;
  }
  updateConversation(input) {
    const c=this.store.get('conversation',input.id);
    if(input.title!==undefined)c.title=required(input.title,150);
    if(input.folder!==undefined)c.folder=str(input.folder,80).trim();
    if(input.tags!==undefined)c.tags=cleanTags(input.tags);
    if(input.archived!==undefined)c.archived=!!input.archived;
    if(input.pinned!==undefined){if(input.pinned&&!c.pinned)c.pinnedAt=now();c.pinned=!!input.pinned;if(!c.pinned)delete c.pinnedAt;}
    if(input.mode!==undefined) {
      if(c.messages.length && input.mode!==c.mode) throw new Error('已有消息的会话请通过新建或分支切换模式');
      c.mode=input.mode==='group'?'group':'single';
    }
    if(input.connectionIds!==undefined) {
      if(!Array.isArray(input.connectionIds)||input.connectionIds.length>8)throw new Error('最多选择 8 个连接');
      for(const cid of input.connectionIds)this.store.get('connection',cid);
      c.connectionIds=[...new Set(input.connectionIds)];
    }
    c.updatedAt=now();this.store.put('conversation',c);this.changed();return c.id;
  }
  deleteConversation({id:conversationId}) {
    const c=this.store.get('conversation',conversationId);
    const jobs=this.store.all('webJob').filter(j=>j.conversationId===c.id);
    if([...this.running.values()].some(r=>r.conversationId===c.id)||c.messages.some(m=>m.status==='streaming')||jobs.some(j=>!['complete','failed','cancelled','interrupted'].includes(j.state)))throw new Error('请先停止回答，等待保存完成后再删除会话');
    const excerpts=this.store.all('excerpt').filter(e=>e.conversationId===c.id);
    this.store.transaction(()=>{for(const e of excerpts)this.store.remove('excerpt',e.id);for(const j of jobs)this.store.remove('webJob',j.id);this.store.remove('conversation',c.id);});
    this.changed();return {id:c.id,deletedExcerpts:excerpts.length};
  }
  shareMarkdown({conversationId,includeNotes=false}) {
    const data=this.exportData(conversationId);
    return markdownExport(data.conversation,data.excerpts,{includeNotes:includeNotes===true});
  }
  conversationShare(input) {
    const text=this.shareMarkdown(input);
    return {preview:text.slice(0,12000),characters:text.length,truncated:text.length>12000};
  }
  conversationSource({conversationId}) {
    const c=this.store.get('conversation',conversationId);
    const value=c.webChat?.url||c.source?.urls?.[0];
    let url;try{url=new URL(value);}catch{throw new Error('此会话没有可打开的来源链接');}
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('来源链接格式不安全，无法打开');
    return url.href;
  }
  send(input) {
    const c=this.store.get('conversation',input.conversationId);
    if(c.archived) throw new Error('请先恢复已归档会话');
    if([...this.running.values()].some(r=>r.conversationId===c.id)) throw new Error('请等待本轮结束，或先停止回答');
    let text=required(input.content,100000);
    let targets=Array.isArray(input.targetIds)&&input.targetIds.length?input.targetIds:c.connectionIds;
    targets=[...new Set(targets)];
    if(!targets.length||targets.length>8)throw new Error('请选择 1 至 8 个模型连接');
    if(c.mode==='single'&&targets.length!==1)throw new Error('单聊每次选择一个模型');
    for(const cid of targets) {
      if(!c.connectionIds.includes(cid))throw new Error('请先将该模型加入会话');
      this.store.get('connection',cid);
    }
    if(input.quoteId) {
      const quote=c.messages.find(m=>m.id===input.quoteId);
      if(!quote)throw new Error('引用的消息不存在');
      text='引用 '+(quote.connectionName||'我')+' 的回答：\n'+quote.content+'\n\n我的问题：\n'+text;
    }
    const user={id:id(),role:'user',content:text,createdAt:now(),status:'complete',targetIds:targets.length===c.connectionIds.length?[]:targets};
    c.messages.push(user);
    if(c.title==='新对话')c.title=required(input.content,100000).slice(0,32);
    const replies=targets.map(cid=>{
      const conn=this.store.get('connection',cid);
      const context=buildContext(c,cid,user.id,input.history!==false);
      if(context.reduce((n,m)=>n+m.content.length,0)>400000)throw new Error('历史内容较长，请关闭携带历史或从选定消息建立分支');
      return {id:id(),role:'assistant',content:'',createdAt:now(),status:'streaming',replyTo:user.id,connectionId:cid,connectionName:conn.name,provider:conn.provider,model:conn.model,context};
    });
    c.messages.push(...replies);c.updatedAt=now();this.store.put('conversation',c);
    for(const reply of replies)this.launch(c.id,reply);
    this.changed();return user.id;
  }
  launch(conversationId,message) {
    const controller=new AbortController();
    this.running.set(message.id,{controller,conversationId,connectionId:message.connectionId});
    void this.execute(conversationId,message,controller);
  }
  async execute(conversationId,message,controller) {
    let lastWrite=0;
    const persist=()=>{
      const c=this.store.get('conversation',conversationId);
      const index=c.messages.findIndex(m=>m.id===message.id);
      if(index>=0) {c.messages[index]={...message}; c.updatedAt=now(); this.store.put('conversation',c);this.changed();}
    };
    try {
      const conn=this.store.get('connection',message.connectionId);
      const key=this.vault.decrypt(this.store.secret(conn.id));
      await this.transport(conn,key,message.context.map(({role,content})=>({role,content})),AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]),event=>{
        if(event.delta)message.content+=event.delta;
        if(event.usage)message.usage=event.usage;
        if(event.reasoning)message.phase='思考中';
        if(event.finishReason)message.finishReason=event.finishReason;
        if(Date.now()-lastWrite>90) {persist();lastWrite=Date.now();}
      });
      if(controller.signal.aborted) message.status='cancelled';
      else if(!message.content)throw new Error('服务没有返回文本回答，请检查模型设置');
      else message.status='complete';
    } catch(error) {
      message.status=controller.signal.aborted?'cancelled':'failed';
      message.error=controller.signal.aborted?'已停止，保留已生成内容':error.name==='TimeoutError'?'请求超时，可重试':error.message==='fetch failed'?'无法连接模型服务，请检查网络和 API 地址':error.message;
    } finally {
      message.completedAt=now();this.running.delete(message.id);persist();
    }
  }
  cancel({messageId}) { this.running.get(messageId)?.controller.abort(); }
  retry({conversationId,messageId}) {
    const c=this.store.get('conversation',conversationId);
    if(c.archived)throw new Error('请先恢复会话');
    const original=c.messages.find(m=>m.id===messageId&&m.role==='assistant');
    if(!original)throw new Error('回答不存在');
    if([...this.running.values()].some(r=>r.conversationId===c.id&&r.connectionId===original.connectionId))throw new Error('该连接仍在回答，请等待或先停止它');
    const conn=this.store.get('connection',original.connectionId);
    if(conn.model!==original.model)throw new Error('该连接的模型已修改，请切换回来重试，或发送新问题');
    const reply={...original,id:id(),content:'',status:'streaming',createdAt:now(),retryOf:original.id};
    for(const field of ['error','usage','completedAt','finishReason','phase'])delete reply[field];
    c.messages.push(reply);c.updatedAt=now();this.store.put('conversation',c);this.launch(c.id,reply);this.changed();return reply.id;
  }
  branch({conversationId,messageId}) {
    const origin=this.store.get('conversation',conversationId);
    const index=origin.messages.findIndex(m=>m.id===messageId);
    if(index<0)throw new Error('消息不存在');
    const selected=origin.messages[index];
    if(selected.status!=='complete')throw new Error('请从已完成消息创建分支');
    const available=new Set(this.store.all('connection').map(c=>c.id));
    const c={...origin,pinned:false,pinnedAt:undefined,id:id(),title:origin.title.slice(0,120)+' · 分支',mode:'single',connectionIds:(selected.connectionId?[selected.connectionId]:origin.connectionIds.slice(0,1)).filter(cid=>available.has(cid)),archived:false,sourceId:origin.id,createdAt:now(),updatedAt:now()};
    const copied=origin.messages.slice(0,index+1).filter(m=>m.status==='complete'&&(selected.isTranscript||selected.role!=='assistant'||m.role!=='assistant'||m.replyTo!==selected.replyTo||m.id===selected.id));
    const mapping=new Map(copied.map(m=>[m.id,id()]));
    c.messages=copied.map(m=>({...m,id:mapping.get(m.id),replyTo:mapping.get(m.replyTo),context:m.context?.map(x=>({...x,messageId:mapping.get(x.messageId)||x.messageId}))}));
    this.store.put('conversation',c);this.changed();return c.id;
  }
  saveExcerpt(input) {
    const c=this.store.get('conversation',input.conversationId);
    const m=c.messages.find(m=>m.id===input.messageId);
    if(!m)throw new Error('原消息不存在');
    const content=required(input.content,200000);
    if(!m.content.includes(content))throw new Error('精选内容必须来自原消息');
    const previous=input.id?this.store.get('excerpt',input.id):null;
    const e={id:previous?.id||id(),conversationId:c.id,messageId:m.id,title:required(input.title,150),content,note:str(input.note||'',20000),tags:cleanTags(input.tags||[]),createdAt:previous?.createdAt||now(),source:m.connectionName||'我',model:m.model||''};
    this.store.put('excerpt',e);this.changed();return e.id;
  }
  deleteExcerpt({id:excerptId}) {this.store.remove('excerpt',excerptId);this.changed();}
  importTranscript(input) {
    const c=createTranscript(input);this.store.put('conversation',c);this.changed();return c.id;
  }
  exportData(conversationId) {
    const conversation=this.store.get('conversation',conversationId);
    const excerpts=this.store.all('excerpt').filter(e=>e.conversationId===conversationId);
    return {format:'ai-workbench',version:1,exportedAt:now(),conversation,excerpts};
  }
  importData(data) {
    if(data?.format!=='ai-workbench'||data.version!==1||!data.conversation||!Array.isArray(data.conversation.messages)||data.conversation.messages.length>10000)throw new Error('仅支持 AI Workbench v1 JSON 会话文件');
    const source=data.conversation;
    const c={id:id(),title:required(source.title,150)+' · 导入',mode:source.mode==='group'?'group':'single',connectionIds:[],messages:[],createdAt:now(),updatedAt:now(),archived:false,folder:str(source.folder||'',80),tags:cleanTags(source.tags||[])};
    if(source.webChat){const platform=webChatSource(source.webChat.url);c.webChat={provider:platform.name,url:platform.url};if(source.webChat.history)c.webChat.history={capturedAt:str(source.webChat.history.capturedAt,80),loadedMessages:Number.isInteger(source.webChat.history.loadedMessages)?Math.min(1000,Math.max(0,source.webChat.history.loadedMessages)):0,scope:'网页已加载消息；更早未加载内容不在本次范围内'};}
    if(source.source) c.source=createTranscript({title:source.title,content:'validation',...source.source}).source;
    const mapping=new Map(source.messages.map(m=>[required(m.id,100),id()]));
    if(mapping.size!==source.messages.length)throw new Error('文件包含重复消息 ID');
    c.messages=source.messages.map(m=>{
      if(!['user','assistant'].includes(m.role))throw new Error('文件包含不支持的消息类型');
      return {id:mapping.get(m.id),role:m.role,images:validateImages(m.images),historyImages:validateHistoryImages(m.historyImages,str(m.content,500000)),content:str(m.content,500000),status:m.status==='complete'?'complete':'interrupted',createdAt:str(m.createdAt||now(),80),replyTo:mapping.get(m.replyTo),connectionId:m.connectionId?'imported:'+str(m.connectionId,100):undefined,connectionName:str(m.connectionName||'导入的模型',80),provider:str(m.provider||'未知',80),model:str(m.model||'',150),isTranscript:m.isTranscript===true,webHistory:m.webHistory===true&&!!c.webChat,context:[],targetIds:[]};
    });
    if(!Array.isArray(data.excerpts||[])||(data.excerpts||[]).length>10000)throw new Error('精选内容格式不正确');
    const excerpts=(data.excerpts||[]).map(e=>{
      const messageId=mapping.get(e.messageId);
      if(!messageId)throw new Error('精选内容缺少原消息');
      const content=required(e.content,200000);
      if(!c.messages.find(m=>m.id===messageId).content.includes(content))throw new Error('精选内容与原消息不一致');
      return {id:id(),conversationId:c.id,messageId,title:required(e.title,150),content,note:str(e.note||'',20000),tags:cleanTags(e.tags||[]),createdAt:now(),source:str(e.source||'导入',80),model:str(e.model||'',150)};
    });
    this.store.transaction(()=>{this.store.put('conversation',c);for(const e of excerpts)this.store.put('excerpt',e);});
    this.changed();return c.id;
  }
}
