import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowUp,Bookmark,ExternalLink,Link2,Square,Download,Plus,ChevronUp,ChevronDown} from 'lucide-react';
import {webProviderInfo,type WebProvider} from './webProviders';
import {VoiceInput} from './VoiceInput';
import type {Conversation,Message} from './types';
import {ConversationIndex} from './ConversationIndex';
import {MessageCopy} from './components';
import {ChatImages,ImagePicker,useChatImages} from './ChatImages';
import {HistoryContent} from './HistoryContent';

function useChatFold(section:string){
 const key='awb-web-chat-fold-'+section;
 const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem(key)==='true';}catch{return false;}});
 useEffect(()=>{try{localStorage.setItem(key,String(collapsed));}catch{}},[key,collapsed]);
 return [collapsed,setCollapsed] as const;
}

type WebStatus={conversationId?:string;history?:{phase:string;message:string;code?:string;copy?:boolean;scan?:boolean;waitingForBrowser?:boolean};online:boolean;ready:boolean;bindingId?:string;url:string;reason:string;busy:boolean};
export function YuanbaoChat({conversation,call:invoke,provider='yuanbao',onOpen,onSetup,onNew,onSave}:{conversation?:Conversation;provider?:WebProvider;call:(action:string,payload?:unknown)=>Promise<any>;onOpen:(id:string)=>void;onSetup:()=>void;onNew:()=>void;onSave:(message:Message)=>void}){
 const config=webProviderInfo[provider],name=config.name;
 const call=(action:string,payload:Record<string,unknown>={})=>invoke(action,{...payload,provider});
 const [status,setStatus]=useState<WebStatus|null>(null),[draft,setDraft]=useState(''),[sending,setSending]=useState(false),[error,setError]=useState('');
 const [detailsCollapsed,setDetailsCollapsed]=useChatFold('details'),[composeCollapsed,setComposeCollapsed]=useChatFold('compose');
 const editorRef=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{const el=editorRef.current;if(el&&!composeCollapsed){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,innerHeight<=760?90:120)+'px';}},[draft,composeCollapsed]);
 const attachments=useChatImages();
 useEffect(()=>{attachments.reset();},[conversation?.id]);
 const copyFrom=useRef<string|null>(null);
 const list=useRef<HTMLDivElement>(null),height=useRef(0),previousConversation=useRef(conversation?.id);
 useEffect(()=>{let live=true,timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const s=await window.workbench!.call('webChatStatus',{provider});if(live){setStatus(s);setError('');}}catch{if(live)setError('本机连接暂不可用，请重试');}finally{if(live)timer=setTimeout(poll,1200);}};void poll();return()=>{live=false;clearTimeout(timer);};},[]);
 useEffect(()=>{if(previousConversation.current&&previousConversation.current!==conversation?.id)setDraft('');previousConversation.current=conversation?.id;height.current=0;},[conversation?.id]);
 useEffect(()=>{const el=list.current;if(el){if(height.current===0||height.current-el.scrollTop-el.clientHeight<180)el.scrollTop=el.scrollHeight;height.current=el.scrollHeight;}},[conversation?.messages]);
 useEffect(()=>{if(!conversation&&status?.conversationId)onOpen(status.conversationId);},[conversation?.id,status?.conversationId]);
 useEffect(()=>{if(copyFrom.current&&status?.history?.copy){if(status.history.phase==='complete'&&status.conversationId&&copyFrom.current===conversation?.id){copyFrom.current=null;onOpen(status.conversationId);}else if(['failed','cancelled'].includes(status.history.phase))copyFrom.current=null;}},[status?.history?.phase,status?.conversationId,conversation?.id]);
 const running=conversation?.messages.some(m=>m.status==='streaming');
 const matches=!conversation||conversation.webChat?.url===status?.url;
 const canSend=status?.online&&status.ready&&!status.busy&&matches&&!conversation?.archived;
 const submit=async(e:FormEvent)=>{e.preventDefault();if(!canSend||(!draft.trim()&&!attachments.images.length)||sending||attachments.loading)return;setSending(true);try{const result=await call('webChatSend',{conversationId:conversation?.id,text:draft,images:attachments.images,bindingId:status.bindingId});if(result){setDraft('');attachments.reset();onOpen(result.conversationId);}}finally{setSending(false);}};
 return <section className="yuanbao-chat">
  <div className="web-chat-header">
   <h1 title={conversation?.title||`和${name}聊一聊`}>{conversation?.title||`和${name}聊一聊`}</h1>
   <span className={'web-chat-badge '+(status?.online&&status.ready&&matches&&!error&&status.history?.phase!=='failed'?'is-connected':'')}>{status?.history?.phase==='loading'?'同步历史中':status?.history?.phase==='failed'?'历史同步失败':status?.online&&status.ready&&matches&&!error?'已连接':status?.online?'网页待处理':'未连接'}</span>
   {composeCollapsed&&(running||status?.busy)&&<button type="button" className="text-button" onClick={()=>void call('webChatCancel')}><Square size={12}/>{status?.history?.phase==='loading'?'停止同步':'停止接收'}</button>}
   <button type="button" className="web-chat-fold" aria-controls="web-chat-details" aria-expanded={!detailsCollapsed} aria-label={detailsCollapsed?'展开顶部信息':'收起顶部信息'} title={detailsCollapsed?'展开同步操作和连接详情':'收起顶部，扩大阅读区域'} onClick={()=>setDetailsCollapsed(!detailsCollapsed)}>{detailsCollapsed?<ChevronDown size={15}/>:<ChevronUp size={15}/>}<span>{detailsCollapsed?'展开':'收起'}</span></button>
  </div>
  {detailsCollapsed&&(error||!status?.online||!status.ready||!matches||status.history?.phase==='failed'||status.history?.phase==='loading')&&<div className="web-chat-notice" role="status"><span>{error||(!matches?'请连接此对话对应的网页':status?.history?.phase==='failed'||status?.history?.phase==='loading'?status.history.message:status?.reason||'请在原网页点击扩展连接工作台')}</span>{status?.busy&&<button className="text-button" onClick={()=>void call('webChatCancel')}>{status.history?.phase==='loading'?'停止同步':'停止接收'}</button>}<button className="text-button" onClick={()=>setDetailsCollapsed(false)}>查看详情</button></div>}
  <div id="web-chat-details" className="web-chat-details" hidden={detailsCollapsed}>
  <div className="yuanbao-heading"><div className="yuanbao-actions">{config.scan&&<button className="primary" disabled={!status?.online||status.busy||!matches} onClick={()=>void call('webChatHistory',{bindingId:status?.bindingId,conversationId:conversation?.id,scan:true})}><Download size={15}/>自动加载并同步历史</button>}<button className="secondary" disabled={!status?.online||status.busy||!matches} onClick={()=>void call('webChatHistory',{bindingId:status?.bindingId,conversationId:conversation?.id})}><Download size={15}/>仅同步已加载</button><button className="secondary" onClick={()=>void call(config.open,{url:conversation?.webChat?.url})}><ExternalLink size={15}/>打开{name}网页</button><button className="secondary" onClick={onSetup}><Link2 size={15}/>连接说明</button>{conversation&&<button className="secondary" onClick={onNew}><Plus size={15}/>另一条网页对话</button>}</div></div>
  <div className={'yuanbao-status '+(status?.online&&status.ready?'connected':'')} role="status"><strong>{status?.online?'浏览器已连接':status?.history?.waitingForBrowser?'等待扫描恢复':'等待浏览器连接'}</strong><span>{error||(!status?.online&&status?.history?.waitingForBrowser?'本次扫描进度暂时保留，请回到原网页并保持连接页打开；恢复后会继续。':!status?.online?`在${name}标签页点击扩展 →「连接${name}网页聊天」，保持${name}和连接页打开。`:!matches?`请打开此记录对应的${name}网页，再在连接页点击「重新连接」。`:status.reason||`可以从下方发送问题。模型和历史上下文沿用${name}网页的设置。`)}</span></div>
  {status?.url&&<div className="yuanbao-source">已绑定：{status.url}</div>}
  {(status?.history||conversation?.webChat?.history)&&<p className="yuanbao-history-status" role="status">{matches&&status?.history?status.history.message:conversation?.webChat?.history?.scope}{status?.history?.scan&&status.history.phase==='loading'?`。自动扫描最长 15 分钟，请保持${name}网页可见。`:''}{conversation?.webChat?.history&&<button className="text-button" onClick={()=>list.current?.scrollTo({top:0})}>查看历史开头</button>}</p>}
  {matches&&status?.history?.phase==='failed'&&status.history.code==='HISTORY_ALIGNMENT'&&<div className="yuanbao-history-status"><p>无法安全合并时，可把当前网页已加载的记录另存为新会话。原会话和收藏会保留。</p><button className="secondary" disabled={!status.online||status.busy} onClick={async()=>{copyFrom.current=conversation?.id||null;const result=await call('webChatHistory',{bindingId:status.bindingId,conversationId:conversation?.id,mode:'copy',scan:!!status.history?.scan});if(!result)copyFrom.current=null;}}>将网页历史另存为新会话</button></div>}
  </div>
  <div className={"conversation-viewport "+(conversation?.messages.length?"has-index":"")}>
  <div className="yuanbao-messages" ref={list}>
   {!conversation?.messages.length&&<div className="yuanbao-empty"><h2>从这里提问，在{name}网页回答</h2><p>先在{name}页面登录，并选择要继续的对话或新建对话。点击浏览器扩展连接后，就可以在这里发送。</p><p>连接后会读取网页已加载的历史；也可以点击「同步网页历史」补充。需要换对话时，请在{name}网页切换，再重新连接。</p></div>}
   {conversation?.messages.map(m=><article id={'message-'+m.id} key={m.id} className={'yuanbao-message '+m.role}><div className="yuanbao-author">{m.role==='user'?'我':`${name} · 网页账号`}<small>{m.webHistory?'网页历史 · 原时间未提供':new Date(m.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</small></div><div className="yuanbao-bubble">{!!m.images?.length&&<ChatImages images={m.images}/>}<HistoryContent content={m.content} images={m.historyImages}/>{m.status==='streaming'&&<p className="muted">{m.phase||`等待${name}…`}</p>}{m.error&&<p className="yuanbao-error">{m.error}</p>}</div><div className="message-tools"><MessageCopy content={m.content}/>{m.role==='assistant'&&m.content&&<button className="text-button" onClick={()=>onSave(m)}><Bookmark size={14}/>收藏</button>}</div></article>)}
  </div>
  {conversation&&<ConversationIndex key={conversation.id} messages={conversation.messages} scrollRef={list}/>}
  </div>
  <div className="yuanbao-compose"><button type="button" className="web-chat-compose-toggle" aria-controls="web-chat-compose-body" aria-expanded={!composeCollapsed} aria-label={composeCollapsed?'展开输入区':'收起输入区'} onClick={()=>setComposeCollapsed(!composeCollapsed)}>{composeCollapsed?<ChevronUp size={13}/>:<ChevronDown size={13}/>}<span>{composeCollapsed?(draft||attachments.images.length?'展开输入区 · 草稿已保留':'展开输入区'):'收起输入区'}</span></button><div id="web-chat-compose-body" className="web-chat-compose-body" hidden={composeCollapsed}><form onSubmit={submit}><ChatImages images={attachments.images} onRemove={sending?undefined:attachments.remove}/>{attachments.imageError&&<p className="image-error" role="alert">{attachments.imageError}</p>}<textarea ref={editorRef} onPaste={e=>{const text=e.clipboardData.getData('text/plain'),start=e.currentTarget.selectionStart,end=e.currentTarget.selectionEnd;if(config.images&&attachments.paste(e)&&text)setDraft(old=>old.slice(0,start)+text+old.slice(end));}} aria-label={`发给${name}的问题`} placeholder={canSend?`想和${name}聊什么？`:`连接${name}网页后，在这里输入问题…`} value={draft} maxLength={20000} onChange={e=>setDraft(e.target.value)} rows={1} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit();}}}/><div className="yuanbao-compose-actions">{config.images&&<ImagePicker disabled={sending||attachments.loading} onFiles={files=>void attachments.add(files)}/>}<VoiceInput key={conversation?.id||'new'} editorRef={editorRef} onText={setDraft} disabled={sending}/><span>Enter 发送 · Shift + Enter 换行</span>{running||status?.busy?<button type="button" className="secondary" onClick={()=>void call('webChatCancel')}><Square size={14}/>{status?.history?.phase==='loading'?'停止同步':'停止接收'}</button>:<button className="primary" type="submit" disabled={!canSend||sending||attachments.loading||(!draft.trim()&&!attachments.images.length)}><ArrowUp size={16}/>{sending?'正在提交…':`发送给${name}`}</button>}</div><p className="image-hint">{!config.images?'当前支持文字提问；图片请在原网页发送':'可直接粘贴截图 · 每次最多 3 张，每张 2 MB'}{attachments.loading?' · 正在读取图片…':''}{attachments.images.length&&!draft.trim()?' · 仅发送图片时会附上“请查看图片。”':''}</p></form><div className="yuanbao-foot"><small>沿用网页额度；停止接收不会撤回问题或停止网页生成。请不要同时在两边发送。</small>{conversation&&<div className="yuanbao-actions">{['md','json'].map(format=><button key={format} className="text-button" onClick={()=>void call('exportConversation',{conversationId:conversation.id,format})}><Download size={13}/>{format==='md'?'Markdown':'JSON'}</button>)}</div>}</div></div></div>
 </section>;
}
