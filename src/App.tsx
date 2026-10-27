import {MAX_PROMPT_CHARACTERS} from '../shared/chat-limits.js';
import {useEffect,useState,useRef,useCallback,type FormEvent} from 'react';
import {Plus,Search,MessageSquare,Users,Bookmark,Settings,ArrowUp,ArrowUpRight,ChevronRight,ChevronDown,ChevronUp,PanelLeftClose,PanelLeftOpen,Palette,Sparkles,GitBranch,Quote,RotateCcw,Square,Archive,Download,Upload,Check,Link2,SlidersHorizontal,FileText,Trash2,ExternalLink,MoreHorizontal,LoaderCircle,X,Folder,ShieldCheck,Command,History,Pin} from 'lucide-react';
import {MarkdownPicker,MarkdownFiles,useMarkdownFiles,markdownPrompt} from './MarkdownFiles';
import {useLinkReader,LinkToggle,LinkResults,LinkMessage} from './LinkReader';
import {WebMembers} from './WebMembers';
import {MemberActions,type MemberMenuRequest} from './MemberActions';
import './web-members.css';
import {VoiceInput} from './VoiceInput';
import {AppearancePicker,useAppearance,type Appearance} from './Appearance';
import type {Connection,Conversation,Excerpt,Message,Snapshot} from './types';
import {Avatar,ConnectionEditor,ExcerptEditor,Mark,Modal,MessageCopy} from './components';
import {ConversationIndex} from './ConversationIndex';
import {TranscriptBody} from './TranscriptBody';
import {TranscriptEditor} from './TranscriptEditor';
import {YuanbaoChat} from './YuanbaoChat';
import './yuanbao.css';
import {providerByName,type WebProvider} from './webProviders';
import './sidebar-fold.css';
import {ConversationActions,type ConversationMenuRequest} from './ConversationActions';
import {BrowserAccounts} from './BrowserAccounts';

type View='webchat'|'chat'|'library'|'settings'|'archive'|'browser';
const empty:Snapshot={connections:[],conversations:[],excerpts:[],dataDirectory:'',version:'0.1.0'};
const suggestions=[{icon:Sparkles,title:'从不同角度想一想',text:'我想做一个新的个人项目。请帮我从可行性、价值和风险三个角度分析。'},{icon:FileText,title:'把想法整理清楚',text:'请帮我把下面的零散想法整理成一份清晰、可执行的计划：'},{icon:Users,title:'让观点碰一碰',text:'学习新技能时，先系统学理论还是先动手做项目？请给出你的观点与理由。'}];
function useSidebarFold(section:string,appearance:Appearance='classic'){
  const key='awb-sidebar-fold-'+section+(appearance==='classic'?'':'-'+appearance);
  const [values,setValues]=useState<Record<string,boolean>>({});
  let saved=false;try{saved=localStorage.getItem(key)==='true';}catch{}
  const collapsed=values[key]??saved;
  const setCollapsed=(value:boolean)=>{setValues(old=>({...old,[key]:value}));try{localStorage.setItem(key,String(value));}catch{}};
  return [collapsed,setCollapsed] as const;
}
export function App() {
  const [appearance,setAppearance]=useAppearance(),compact=appearance!=='classic';
  const [appearanceOpen,setAppearanceOpen]=useState(false),[searchOpen,setSearchOpen]=useState(false);
  const closeAppearance=useCallback(()=>setAppearanceOpen(false),[]);
  const [topCollapsed,setTopCollapsed]=useSidebarFold('top',appearance),[bottomCollapsed,setBottomCollapsed]=useSidebarFold('bottom',appearance);
  const [sidebarClosed,setSidebarClosed]=useSidebarFold('whole',appearance);
  const [inspectorClosed,setInspectorClosed]=useSidebarFold('inspector',appearance);
  const [inspectorOpened,setInspectorOpened]=useSidebarFold('inspector-open',appearance);
  const inspector=compact?inspectorOpened:!inspectorClosed;
  const toggleInspector=()=>compact?setInspectorOpened(!inspector):setInspectorClosed(inspector);
  const [data,setData]=useState<Snapshot>(empty),[loaded,setLoaded]=useState(false);
  const [webProvider,setWebProvider]=useState<WebProvider>('yuanbao');
  const [view,setView]=useState<View>('chat'),[activeId,setActiveId]=useState<string|null>(null);
  const [draftMode,setDraftMode]=useState<'single'|'group'>('single'),[draftIds,setDraftIds]=useState<string[]>([]);
  const [archivePage,setArchivePage]=useState(0),[archiveTarget,setArchiveTarget]=useState<string|null>(null);
  const [search,setSearch]=useState(''),[folderFilter,setFolderFilter]=useState('');
  const documents=useMarkdownFiles(),links=useLinkReader();
  const [composer,setComposer]=useState(''),[history,setHistory]=useState(true),[target,setTarget]=useState('');
  const [quoteId,setQuoteId]=useState<string|null>(null),[toast,setToast]=useState('');
  const [webMembersOpen,setWebMembersOpen]=useState(false);
  const [memberMenu,setMemberMenu]=useState<MemberMenuRequest|null>(null);
  const closeMemberMenu=useCallback(()=>setMemberMenu(null),[]);
  const [connectionEditor,setConnectionEditor]=useState<Connection|'new'|null>(null);
  const [excerptEditor,setExcerptEditor]=useState<{message:Message;conversationId:string;existing?:Excerpt;selection?:string}|null>(null);
  const [contextMessage,setContextMessage]=useState<Message|null>(null),[metaEditor,setMetaEditor]=useState(false);
  const [testing,setTesting]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const [transcriptEditor,setTranscriptEditor]=useState(false);
  const [conversationMenu,setConversationMenu]=useState<ConversationMenuRequest|null>(null);
  const closeConversationMenu=useCallback(()=>setConversationMenu(null),[]);
  const closeTranscript=useCallback(()=>setTranscriptEditor(false),[]);
  const listRef=useRef<HTMLDivElement>(null),inputRef=useRef<HTMLTextAreaElement>(null);
  const previousHeight=useRef(0);
  const searchRef=useRef<HTMLInputElement>(null);
  const focusSearch=()=>{setSearchOpen(true);requestAnimationFrame(()=>searchRef.current?.focus());};
  useEffect(()=>{const el=inputRef.current;if(!el)return;el.style.height='';if(compact){el.style.height='auto';el.style.height=Math.min(150,Math.max(30,el.scrollHeight))+'px';}},[composer,compact,view]);
  const active=data.conversations.find(c=>c.id===activeId);
  useEffect(()=>{if(view==='chat'&&active?.webChat)setView('webchat');},[view,active?.id,!!active?.webChat]);
  const currentWebProvider=active?.webChat?(providerByName(active.webChat.provider)||webProvider):webProvider;
  const mode=active?.mode||draftMode;
  const archiveMessages=active?.messages.filter(m=>m.isTranscript)||[];
  const archivePages=Math.ceil(archiveMessages.length/2);
  const shownArchiveIds=new Set(archiveMessages.slice(archivePage*2,archivePage*2+2).map(m=>m.id));
  const selectedIds=(active?.connectionIds||draftIds).filter(id=>data.connections.some(c=>c.id===id));
  const selectedConnections=data.connections.filter(c=>selectedIds.includes(c.id));
  const running=active?.messages.some(m=>m.status==='streaming')||false;
  const closeWebMembers=useCallback(()=>setWebMembersOpen(false),[]);
  const closeConnection=useCallback(()=>setConnectionEditor(null),[]);
  const closeExcerpt=useCallback(()=>setExcerptEditor(null),[]);
  const closeContext=useCallback(()=>setContextMessage(null),[]);
  const closeMeta=useCallback(()=>setMetaEditor(false),[]);
  const notify=(message:string)=>setToast(message);
  const call=async(action:string,payload?:unknown,throwError=false)=>{
    try {
      if(!window.workbench)throw new Error('请使用桌面应用打开此页面');
      const result=await window.workbench.call(action,payload);
      if(action!=='testConnection')setData(await window.workbench.call('snapshot'));
      return result;
    } catch(error) {if(throwError)throw error;setToast(String((error as Error).message).replace(/^Error invoking remote method '[^']+': Error: /,''));return null;}
  };
  useEffect(()=>{
    if(!window.workbench){setLoaded(true);return;}
    void window.workbench.call('snapshot').then(s=>{setData(s);setLoaded(true);}).catch(e=>{setToast(e.message);setLoaded(true);});
    const stop=window.workbench.subscribe(setData);
    const stopImports=window.workbench.subscribeImported(id=>{setActiveId(id);setView('chat');setSearch('');setToast('网页对话已保存到本机');});
    return ()=>{stop();stopImports();};
  },[]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),5500);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{setArchivePage(Math.max(0,Math.floor(archiveMessages.findIndex(m=>m.id===archiveTarget)/2)));setQuoteId(null);setTarget('');setComposer('');documents.reset();links.reset();previousHeight.current=0;},[activeId,archiveTarget]);
  useEffect(()=>{links.reset();},[view]);
  useEffect(()=>{
    const list=listRef.current;
    if(!active?.messages.length){if(list)list.scrollTop=0;previousHeight.current=0;return;}
    if(list&&archivePages>1){list.scrollTop=0;return;}
    if(list){const nearBottom=previousHeight.current-list.scrollTop-list.clientHeight<180;if(nearBottom||previousHeight.current===0)list.scrollTo({top:list.scrollHeight,behavior:'instant'});previousHeight.current=list.scrollHeight;}
  },[active?.messages]);
  const newChat=(nextMode=mode)=>{documents.reset();links.reset();setView('chat');setActiveId(null);setDraftMode(nextMode);setDraftIds(data.connections.slice(0,nextMode==='single'?1:3).map(c=>c.id));setComposer('');setQuoteId(null);setTarget('');setSearch('');};
  const openConversation=(id:string,messageId?:string)=>{setArchiveTarget(messageId||null);setActiveId(id);setView(data.conversations.find(c=>c.id===id)?.webChat?'webchat':'chat');setSearch('');};
  const setSelected=async(ids:string[])=>{if(active)await call('updateConversation',{id:active.id,connectionIds:ids});else setDraftIds(ids);setTarget('');};
  const toggleConnection=(id:string)=>{if(running)return;void setSelected(mode==='single'?[id]:selectedIds.includes(id)?selectedIds.filter(cid=>cid!==id):[...selectedIds,id]);};
  const setMode=(next:'single'|'group')=>{if(next!==mode){newChat(next);}};
  const submit=async(e?:FormEvent)=>{
    e?.preventDefault();if((!composer.trim()&&!documents.files.length)||busy||running||documents.loading)return;
    if(!selectedIds.length){setView('settings');notify('请先添加并选择模型连接');return;}
    let content=composer,targets=target?[target]:selectedIds;
    const mentioned=selectedConnections.find(c=>content.startsWith('@'+c.name+' '));
    if(mentioned){targets=[mentioned.id];content=content.slice(mentioned.name.length+2);}
    else{const alias=content.match(/^@([^\s]+)\s+/),matches=alias?selectedConnections.filter(c=>c.kind==='web'&&c.provider.toLowerCase()===alias[1].toLowerCase()):[];if(matches.length===1){targets=[matches[0].id];content=content.slice(alias![0].length);}}
    setBusy(true);
    try {
      const prepared=await links.prepare(content);if(prepared===null)return;
      try{content=markdownPrompt(prepared,documents.files,MAX_PROMPT_CHARACTERS);}catch(e){documents.setError((e as Error).message);return;}
      let conversationId=activeId;
      if(!conversationId){conversationId=await call('createConversation',{mode,connectionIds:selectedIds});if(!conversationId)return;}
      const result=await call('send',{conversationId,content,targetIds:targets,history,quoteId});
      if(result){documents.reset();setActiveId(conversationId);setComposer('');setQuoteId(null);inputRef.current?.focus();}
    } finally {setBusy(false);}
  };
  const saveExcerpt=(message:Message)=>{
    const selected=window.getSelection();
    let selection=selected?.toString().trim();
    if(selection&&selected?.rangeCount){
      const range=selected.getRangeAt(0),root=document.getElementById('message-'+message.id);
      const tables=root?[...root.querySelectorAll<HTMLElement>('.table-scroll[data-source-start][data-source-end]')].filter(t=>range.intersectsNode(t)):[];
      if(tables.length===1&&tables[0].contains(range.commonAncestorContainer)){
        // Capture the original Markdown, including headers, instead of flattened DOM text.
        const start=Number(tables[0].dataset.sourceStart),end=Number(tables.at(-1)!.dataset.sourceEnd);
        if(start>=0&&end>start&&end<=message.content.length)selection=message.content.slice(start,end);
      }
    }
    if(active)setExcerptEditor({message,conversationId:active.id,selection:selection&&message.content.includes(selection)?selection:undefined});
  };
  const exportConversation=async(format:string)=>{if(active){const path=await call('exportConversation',{conversationId:active.id,format});if(path)notify('已导出到 '+path);}};
  const importConversation=async()=>{const id=await call('importConversation');if(id){openConversation(id);notify('会话已导入。重新选择连接后即可继续对话。');}};
  const matching=(c:Conversation)=>[c.title,c.folder,...c.tags,...c.messages.map(m=>m.content)].join(' ').toLowerCase().includes(search.toLowerCase())&&(!folderFilter||c.folder===folderFilter);
  const conversations=data.conversations.filter(c=>c.archived===(view==='archive')).filter(matching);
  const menuConversation=data.conversations.find(c=>c.id===conversationMenu?.id);
  const folders=[...new Set(data.conversations.map(c=>c.folder).filter(Boolean))];
  const quote=active?.messages.find(m=>m.id===quoteId);
  const totalAnswers=data.conversations.reduce((sum,c)=>sum+c.messages.filter(m=>m.role==='assistant'&&m.status==='complete').length,0);

  if(loaded&&!window.workbench)return <div className="browser-notice"><Command size={40}/><h1>AI Workbench</h1><p>这是本地桌面应用，请在项目目录执行 <code>npm start</code> 打开。</p><p>聊天和密钥保存在桌面端，浏览器预览不会连接模型。</p></div>;
  return <div className={"app-shell appearance-"+appearance}>
    <aside className={"sidebar "+(topCollapsed?"sidebar-top-collapsed":"")} hidden={compact&&sidebarClosed}>
      {compact&&<div className="minimal-brand"><Command size={29}/><strong>AI Workbench</strong><button className="icon-button" aria-label="收起侧边栏" title="收起侧边栏" onClick={()=>setSidebarClosed(true)}><PanelLeftClose size={16}/></button></div>}
      <div id="sidebar-top" className="sidebar-top" hidden={topCollapsed}>
      <div className="brand classic-brand"><div className="brand-icon"><Command size={23}/></div><div><strong>AI Workbench</strong><span>你的 AI 工作台</span></div></div>
      <button hidden={compact} className="new-chat" onClick={()=>newChat()}><Plus size={18}/>新建对话<span>＋</span></button>
      <nav aria-label="主导航">
        {compact&&<><button className="nav-item" onClick={focusSearch}><Search size={18}/>搜索</button><button className="nav-item" onClick={()=>newChat()}><MessageSquare size={18}/>新建对话</button></>}
        <button hidden={compact} className={view==='chat'||view==='webchat'?'nav-item active':'nav-item'} onClick={()=>setView(active?.webChat?'webchat':'chat')}><MessageSquare size={18}/>对话<span className="nav-count">{data.conversations.filter(c=>!c.archived).length}</span></button>
        <button className={view==='library'?'nav-item active':'nav-item'} onClick={()=>setView('library')}><Bookmark size={18}/>精选库<span className="nav-count">{data.excerpts.length}</span></button>
        <button className={view==='browser'?'nav-item active':'nav-item'} onClick={()=>setView('browser')}><Link2 size={18}/>网页账号</button>
        <button hidden={compact} className="nav-item" onClick={()=>setTranscriptEditor(true)}><Upload size={18}/>保存外部对话</button>
        <button hidden={compact} className={view==='archive'?'nav-item active':'nav-item'} onClick={()=>setView('archive')}><Archive size={18}/>已归档</button>
        {compact&&<details className="sidebar-more"><summary><MoreHorizontal size={18}/>更多</summary><button className="nav-item" onClick={()=>setTranscriptEditor(true)}><Upload size={17}/>保存外部对话</button><button className="nav-item" onClick={()=>setView('archive')}><Archive size={17}/>已归档</button><button className="nav-item" onClick={()=>void importConversation()}><Download size={17}/>导入会话</button></details>}
      </nav>
      </div>
      <button className="sidebar-fold" type="button" aria-controls="sidebar-top" aria-expanded={!topCollapsed} aria-label={topCollapsed?'展开顶部功能区':'收起顶部功能区'} title={topCollapsed?'展开顶部功能区':'收起顶部功能区'} onClick={()=>setTopCollapsed(!topCollapsed)}><span/>{topCollapsed?<ChevronDown size={14}/>:<ChevronUp size={14}/>}<small>{topCollapsed?'展开功能区':'收起功能区'}</small><span/></button>
      {compact&&<div className="minimal-folders"><span>文件夹</span><label><Folder size={17}/><select aria-label="文件夹筛选" value={folderFilter} onChange={e=>setFolderFilter(e.target.value)}><option value="">所有对话</option>{folders.map(f=><option key={f}>{f}</option>)}</select><ChevronDown size={14}/></label></div>}
      <div className="sidebar-section"><span>{view==='archive'?'归档会话':'最近对话'}</span>{compact&&<button className="icon-button" aria-label="搜索历史对话" title="搜索历史对话" onClick={focusSearch}><Search size={16}/></button>}<button hidden={compact} className="icon-button" aria-label="导入会话" title="导入 AI Workbench JSON" onClick={()=>void importConversation()}><Upload size={14}/></button></div>
      <div className="search-box" hidden={compact&&!searchOpen&&!search}><Search size={15}/><input ref={searchRef} aria-label="搜索会话" placeholder="搜索对话与内容" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button className="icon-button" aria-label="清除搜索" onClick={()=>setSearch('')}><X size={13}/></button>}</div>
      {!compact&&folders.length>0&&<select className="folder-filter" aria-label="文件夹筛选" value={folderFilter} onChange={e=>setFolderFilter(e.target.value)}><option value="">所有文件夹</option>{folders.map(f=><option key={f}>{f}</option>)}</select>}
      <div className="conversation-list">
        {conversations.map(c=><div key={c.id} className="conversation-row" onContextMenu={e=>{e.preventDefault();setConversationMenu({id:c.id,x:e.clientX,y:e.clientY,trigger:e.currentTarget.querySelector('button')!});}}>
          <button title={c.title} className={'conversation-item '+(activeId===c.id?'selected':'')} onClick={()=>openConversation(c.id)} onKeyDown={e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();const r=e.currentTarget.getBoundingClientRect();setConversationMenu({id:c.id,x:r.right-20,y:r.top,trigger:e.currentTarget});}}}>{c.mode==='group'?<Users size={15}/>:<MessageSquare size={15}/>}<div><span>{c.title}</span><small>{c.pinned&&<Pin size={10} aria-label="已置顶"/>}{c.folder?c.folder+' · ':''}{new Date(c.updatedAt).toLocaleDateString('zh-CN',{month:'short',day:'numeric'})}</small></div>{c.messages.some(m=>m.status==='streaming')&&<span className="live-dot"/>}</button>
          <button className="icon-button conversation-more" aria-label={'更多操作：'+c.title} title="更多操作" aria-haspopup="menu" aria-expanded={conversationMenu?.id===c.id} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setConversationMenu({id:c.id,x:r.right,y:r.top,trigger:e.currentTarget});}}><MoreHorizontal size={17}/></button>
        </div>)}
        {!conversations.length&&<p className="sidebar-empty">{search?'没有匹配的对话':'想法从一次对话开始。'}<br/>{!search&&'你的记录会自动保存在这里。'}</p>}
      </div>
      <button className="sidebar-fold sidebar-fold-bottom" type="button" aria-controls="sidebar-bottom" aria-expanded={!bottomCollapsed} aria-label={bottomCollapsed?'展开底部设置区':'收起底部设置区'} title={bottomCollapsed?'展开底部设置区':'收起底部设置区'} onClick={()=>setBottomCollapsed(!bottomCollapsed)}><span/>{bottomCollapsed?<ChevronUp size={14}/>:<ChevronDown size={14}/>}<small>{bottomCollapsed?'展开设置区':'收起设置区'}</small><span/></button>
      <div id="sidebar-bottom" className="sidebar-bottom" hidden={bottomCollapsed}><div className="local-status"><span className="status-dot"/>本地保存<span>v{data.version}</span></div><button className={view==='settings'?'nav-item active':'nav-item'} onClick={()=>setView('settings')}><Settings size={18}/>连接与设置<span className="nav-count">{data.connections.length}</span></button><div className="profile"><div className="user-avatar">我</div><div><strong>个人空间</strong><span>让每一次思考都有所积累</span></div></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb">{compact&&sidebarClosed&&<button className="icon-button" aria-label="展开侧边栏" title="展开侧边栏" onClick={()=>setSidebarClosed(false)}><PanelLeftOpen size={19}/></button>}<span>个人空间</span><ChevronRight size={14}/><strong>{view==='browser'?'网页账号':view==='library'?'精选库':view==='settings'?'连接与设置':view==='archive'?'已归档':active?.title||'新对话'}</strong>{compact&&view==='chat'&&<select className="header-mode" aria-label="对话模式" value={mode} onChange={e=>setMode(e.target.value as 'single'|'group')}><option value="single">单聊</option><option value="group">群聊</option></select>}</div><div className="top-actions">{compact&&view==='chat'&&mode==='single'&&data.connections.length>0&&<select className="header-model" aria-label="顶部聊天模型" value={selectedIds[0]||''} disabled={running} onChange={e=>void setSelected([e.target.value])}><option value="" disabled>选择模型</option>{data.connections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>}<span className="local-pill"><ShieldCheck size={13}/>Local first</span><button className="icon-button" aria-label="切换外观" title="切换外观" onClick={()=>setAppearanceOpen(true)}><Palette size={18}/></button>{view==='chat'&&<button className="icon-button" aria-label="显示或隐藏会话面板" title="会话面板与参与模型" aria-expanded={inspector} onClick={toggleInspector}><SlidersHorizontal size={18}/></button>}{compact&&active&&view==='chat'&&<button className="icon-button" aria-label="会话信息" title="整理会话" onClick={()=>setMetaEditor(true)}><MoreHorizontal size={19}/></button>}</div></header>
      {view==='webchat'?<YuanbaoChat key={currentWebProvider} provider={currentWebProvider} conversation={active?.webChat?active:undefined} call={call} onOpen={id=>{setActiveId(id);setView('webchat');}} onSetup={()=>setView('browser')} onNew={()=>{setWebProvider(currentWebProvider);setActiveId(null);}} onSave={saveExcerpt}/>:view==='browser'?<BrowserAccounts onChatGPT={()=>{setWebProvider('chatgpt');setActiveId(null);setView('webchat');}} onGemini={()=>{setWebProvider('gemini');setActiveId(null);setView('webchat');}} onGrok={()=>{setWebProvider('grok');setActiveId(null);setView('webchat');}} call={call} onYuanbao={()=>{setWebProvider('yuanbao');setActiveId(null);setView('webchat');}} onDoubao={()=>{setWebProvider('doubao');setActiveId(null);setView('webchat');}}/>:view==='settings'?<section className="page settings-page">
        <div className="page-heading"><div><div className="eyebrow">CONNECTIONS</div><h1>连接你的 AI</h1><p>模型可以不同，思考在同一个地方继续。</p></div><button className="primary" onClick={()=>setConnectionEditor('new')}><Plus size={17}/>添加连接</button></div>
        <AppearancePicker value={appearance} onChange={setAppearance}/><div className="website-nudge"><div><strong>只有 Gemini 网页账号，没有 API？</strong><p>连接专用网页会话后，可添加为群聊成员，无需 API Key。</p></div><button className="secondary" onClick={()=>setView('browser')}><Link2 size={15}/>使用网页账号</button></div>
        <div className="section-title"><h2>模型与网页成员</h2><span>{data.connections.length} 个连接</span></div>
        {!data.connections.length&&<div className="setup-card"><div className="setup-visual"><Avatar name="DeepSeek"/><Link2 size={24}/><div className="brand-icon"><Command size={24}/></div></div><h2>从你已有的 DeepSeek 开始</h2><p>填写 API Key，即可在这里对话。<br/>同一家供应商的不同模型，也可以添加为独立连接。</p><button className="primary" onClick={()=>setConnectionEditor('new')}><KeyIcon/>添加第一个连接</button></div>}
        <div className="connections-grid">{data.connections.map(c=><div className="connection-card" key={c.id}><div className="connection-card-head"><Avatar name={c.provider}/><div><h3>{c.name}</h3><span>{c.provider} · {c.kind==='web'?'网页账号':'API'}</span></div><span className="configured">已配置</span></div><div className="model-code">{c.model}</div><p className="endpoint">{c.kind==='web'?c.webUrl:c.baseUrl}</p><div className="connection-buttons"><button className="secondary small-button" disabled={testing===c.id} onClick={async()=>{setTesting(c.id);try{const result=await call('testConnection',{id:c.id});if(result)notify('连接成功 · '+result.text);}finally{setTesting(null);}}}>{testing===c.id?<LoaderCircle size={14} className="spin"/>:<Check size={14}/>}测试连接</button><button className="text-button" onClick={()=>c.kind==='web'?setWebMembersOpen(true):setConnectionEditor(c)}>编辑</button><button className="icon-button danger" aria-label={'删除连接 '+c.name} onClick={()=>void call('deleteConnection',{id:c.id})}><Trash2 size={15}/></button></div><small className="muted">{c.kind==='web'?'网页连接检查不会发送测试消息；模型设置和上下文沿用网页。':'测试会向此模型发送一条短消息，消耗少量 API 用量。'}</small></div>)}</div>
        <div className="section-title future-title"><h2>你的其他 AI 入口</h2><span>后续接入计划</span></div>
        <div className="roadmap-grid">{['元宝','豆包','ChatGPT','Grok','Gemini','Kimi','Claude Code · DeepSeek','WorkBuddy','豆包工作'].map(name=><div className="roadmap-item" key={name}><span>{name}</span><small>{(name==='元宝'||name==='豆包')?'网页账号聊天试用':name==='Gemini'||name==='Grok'?'浏览器保存入口已提供':name==='Claude Code · DeepSeek'?'工具桥接待实现':'网页 / 工具接入待验证'}</small></div>)}</div>
        <p className="section-note">完整产品的搜索、记忆和历史记录，需要单独接入。API 连接不会自动读取网页会话。</p>
        <div className="storage-card"><ShieldCheck size={22}/><div><h3>对话属于你，保存在本机</h3><p>数据目录独立于项目文件夹，重命名源码目录不会迁移聊天记录。</p><code>{data.dataDirectory||'正在加载…'}</code><p>API Key 使用系统加密保存。向云端模型提问时，选定的上下文会发送给对应供应商。</p></div></div>
      </section>:view==='library'?<section className="page library-page">
        <div className="page-heading"><div><div className="eyebrow">COLLECTION</div><h1>留住值得回看的想法</h1><p>收藏回答、标记灵感，把对话变成自己的积累。</p></div><span className="stat-chip">{data.excerpts.length} 条精选</span></div>
        <div className="library-toolbar"><Search size={17}/><input aria-label="搜索精选" placeholder="搜索标题、标签、笔记或内容" value={search} onChange={e=>setSearch(e.target.value)}/></div>
        {data.excerpts.filter(e=>[e.title,e.content,e.note,...e.tags].join(' ').toLowerCase().includes(search.toLowerCase())).length===0?<div className="empty-library"><div className="empty-icon"><Bookmark size={30}/></div><h2>{search?'没有找到相关精选':'把好答案，变成自己的知识'}</h2><p>在回答下点击收藏，或选中一段文字再收藏。<br/>原始对话与模型来源都会为你保留。</p><button className="secondary" onClick={()=>setView('chat')}>回到对话<ArrowUpRight size={15}/></button></div>:<div className="excerpt-grid">{data.excerpts.filter(e=>[e.title,e.content,e.note,...e.tags].join(' ').toLowerCase().includes(search.toLowerCase())).map(e=><article className="excerpt-card" key={e.id}><div className="excerpt-source"><Avatar name={e.source} small/><span>{e.source}</span><small>{new Date(e.createdAt).toLocaleDateString()}</small></div><h3>{e.title}</h3><div className="excerpt-content"><Mark repairTables={data.conversations.find(c=>c.id===e.conversationId)?.messages.find(m=>m.id===e.messageId)?.isTranscript}>{e.content}</Mark></div>{e.note&&<div className="personal-note"><span>我的笔记</span><p>{e.note}</p></div>}<div className="tags">{e.tags.map(tag=><button key={tag} onClick={()=>setSearch(tag)}>#{tag}</button>)}</div><div className="excerpt-actions"><button className="text-button" onClick={()=>{openConversation(e.conversationId,e.messageId);setTimeout(()=>document.getElementById('message-'+e.messageId)?.scrollIntoView({behavior:'smooth',block:'center'}),150);}}>回到原对话<ArrowUpRight size={14}/></button><button className="text-button" onClick={()=>{const c=data.conversations.find(c=>c.id===e.conversationId);const m=c?.messages.find(m=>m.id===e.messageId);if(m)setExcerptEditor({message:m,conversationId:e.conversationId,existing:e});}}>编辑</button><button className="icon-button" aria-label={'删除精选 '+e.title} onClick={()=>void call('deleteExcerpt',{id:e.id})}><Trash2 size={14}/></button></div></article>)}</div>}
      </section>:view==='archive'?<section className="page"><div className="eyebrow">ARCHIVE</div><h1>已归档对话</h1><p className="muted">暂时收起，随时找回。归档不会删除内容。</p><div className="archive-list">{data.conversations.filter(c=>c.archived).map(c=><div key={c.id}><Archive size={20}/><button className="text-button" onClick={()=>openConversation(c.id)}>{c.title}</button><button className="secondary small-button" onClick={()=>void call('updateConversation',{id:c.id,archived:false})}>恢复会话</button></div>)}</div>{!data.conversations.some(c=>c.archived)&&<div className="empty-library"><Archive size={32}/><h2>还没有归档的对话</h2></div>}</section>:<div className={'chat-layout '+(inspector?'':'no-inspector')+(mode==='group'?' is-group':'')}>
        <main className="chat-main">
          <div className="chat-toolbar" hidden={compact}><div className="mode-tabs"><button className={mode==='single'?'selected':''} onClick={()=>setMode('single')}><MessageSquare size={15}/>单聊</button><button className={mode==='group'?'selected':''} onClick={()=>setMode('group')}><Users size={16}/>群聊</button></div><span className="toolbar-hint">{mode==='group'?'一次提问，多种视角':'随时切换，接着聊'}</span>{active&&<button className="icon-button" aria-label="会话信息" onClick={()=>setMetaEditor(true)}><MoreHorizontal size={19}/></button>}</div>
          <div className={"conversation-viewport "+(active?.messages.length?"has-index":"")}>
          <div className="message-scroll" ref={listRef}>
            {!active?.messages.length?<div className="welcome"><div className="welcome-mark"><Command size={35}/><span className="sparkle"><Sparkles size={14}/></span></div><div className="eyebrow">ONE SPACE. MORE PERSPECTIVES.</div><h1>你的问题，<span>更多视角。</span></h1><p>与不同的 AI 对话，让想法在这里碰撞、沉淀。<br/>从一个问题开始，留住每一个有价值的答案。</p><div className="suggestion-grid">{suggestions.map(s=><button key={s.title} className="suggestion" onClick={()=>{setComposer(s.text);inputRef.current?.focus();}}><s.icon size={20}/><strong>{s.title}</strong><span>{s.text.slice(0,28)}…</span><ArrowUpRight className="suggestion-arrow" size={16}/></button>)}</div><div className="welcome-foot"><span className="status-dot"/>本地保存<span className="dot-separator">·</span>自由切换<span className="dot-separator">·</span>值得珍藏</div></div>:<div className="messages">
              <div className={"conversation-heading "+(!active.source&&!active.sourceId?"plain-heading":"")}><span>{mode==='group'?'群聊':'单聊'} / {new Date(active.createdAt).toLocaleDateString('zh-CN')}</span><h2>{active.title}</h2>{active.sourceId&&<small><GitBranch size={12}/>由已有对话创建的分支</small>}{active.source&&<div className="source-record"><span>来源 · {active.source.product} 原文存档</span><div>{active.source.urls.map((url,i)=><a href={url} target="_blank" rel="noreferrer" key={url}>来源链接 {i+1}<ArrowUpRight size={12}/></a>)}</div>{active.source.note&&<details open><summary>我的想法 / 项目草案</summary><p>{active.source.note}</p></details>}</div>}</div>
              {archivePages>1&&<div className="archive-pagination"><span>长对话 · 第 {archivePage+1} / {archivePages} 页（分页显示，导出包含全部原文）</span><button className="secondary" disabled={archivePage===0} onClick={()=>{setArchivePage(archivePage-1);listRef.current?.scrollTo({top:0});}}>上一页</button><button className="secondary" disabled={archivePage>=archivePages-1} onClick={()=>{setArchivePage(archivePage+1);listRef.current?.scrollTo({top:0});}}>下一页</button><button className="text-button" onClick={()=>setArchivePage(archivePages-1)}>末页</button></div>}
              {active.messages.filter(m=>m.role==='user').map(user=><section className="turn" key={user.id}>
                <div className="user-message" id={'message-'+user.id}><div className="user-message-label"><div className="user-avatar small">我</div><strong>你</strong><time>{new Date(user.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time></div><LinkMessage content={user.content}/><div className="user-message-tools"><MessageCopy content={user.content}/><button className="quiet-button" onClick={async()=>{const id=await call('branch',{conversationId:active.id,messageId:user.id});if(id)openConversation(id);}}><GitBranch size={13}/>从这里分支</button></div></div>
                <div className={'answers '+(mode==='group'?'group-answers':'')}>{active.messages.filter(m=>m.role==='assistant'&&m.replyTo===user.id&&(!m.isTranscript||archivePages<=1||shownArchiveIds.has(m.id))).map(m=><article className={'answer-card '+(m.status==='failed'?'error-card':'')} id={'message-'+m.id} key={m.id} data-testid="answer-card">
                  <div className="answer-head">{compact?<span className="assistant-mark"><Command size={23}/></span>:<Avatar name={m.provider||m.connectionName} small/>}<div><strong>{m.connectionName}</strong>{compact&&<time>{new Date(m.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time>}<span>{m.isTranscript?'网页对话 · 原文保留':m.model}</span></div><span className={'answer-status '+m.status}>{m.status==='streaming'?<><LoaderCircle size={12} className="spin"/>{m.content?'回答中':m.phase||'连接中'}</>:m.status==='complete'?<><Check size={12}/>已完成</>:m.status==='cancelled'?'已停止':m.status==='interrupted'?'已中断':'连接失败'}</span></div>
                  {m.recoveredFromWeb&&<div className="retry-label">已补回网页回答 · 未重新发送问题</div>}{m.retryOf&&<div className="retry-label">重新生成 · 原回答已保留</div>}
                  <div className="answer-body">{m.content?(m.isTranscript?<TranscriptBody content={m.content} messageId={m.id}/>:<Mark>{m.content}</Mark>):m.status==='streaming'?<div className="thinking-dots"><i/><i/><i/></div>:<p className="muted">没有收到回答内容</p>}</div>
                  {m.error&&<div className="message-error">{m.error}</div>}
                  {m.finishReason==='length'&&<div className="message-error">回答达到输出上限，内容可能尚未完成。</div>}
                  <div className="answer-actions"><MessageCopy content={m.content}/>{m.status==='streaming'?<button className="text-button" onClick={()=>void call('cancel',{messageId:m.id})}><Square size={13}/>停止</button>:<><button className="text-button" disabled={!m.content} onClick={()=>saveExcerpt(m)}><Bookmark size={14}/>{data.excerpts.some(e=>e.messageId===m.id)?'再次收藏':'收藏'}</button><button className="text-button" disabled={!m.content||running} onClick={()=>{setQuoteId(m.id);inputRef.current?.focus();}}><Quote size={14}/>引用</button><button className="icon-button" title="保留原答案并重试" aria-label={'重试 '+m.connectionName} disabled={active.messages.some(x=>x.connectionId===m.connectionId&&x.status==='streaming')||m.isTranscript} onClick={()=>void call('retry',{conversationId:active.id,messageId:m.id})}><RotateCcw size={14}/></button>{m.status==='complete'&&<button className="icon-button" title="从这条回答创建分支" aria-label={'分支 '+m.connectionName} onClick={async()=>{const id=await call('branch',{conversationId:active.id,messageId:m.id});if(id)openConversation(id);}}><GitBranch size={14}/></button>}</>}<button className="context-button" onClick={()=>setContextMessage(m)} title="查看本次实际发送的上下文">上下文 {m.context?.length||0}</button></div>
                  {m.usage&&<div className="usage-line">Token · 输入 {m.usage.prompt_tokens??'未知'} / 输出 {m.usage.completion_tokens??'未知'}</div>}
                </article>)}</div>
              </section>)}
            </div>}
          </div>
          {active&&<ConversationIndex key={active.id} messages={active.messages} scrollRef={listRef} page={archivePage} onPage={setArchivePage}/>}
          </div>
          <div className="composer-area">
            {active?.archived?<div className="archived-banner"><Archive size={18}/>此对话已归档<button className="secondary" onClick={()=>void call('updateConversation',{id:active.id,archived:false})}>恢复并继续</button></div>:<form className="composer" onSubmit={submit} {...documents.dragProps(busy||running)}>
              <div className="composer-connections">{!data.connections.length?<button type="button" className="connect-prompt" onClick={()=>setConnectionEditor('new')}><Plus size={15}/>连接第一个模型</button>:mode==='single'?<div className="single-picker"><Avatar name={selectedConnections[0]?.provider||'AI'} small/><select aria-label="选择聊天模型" disabled={running} value={selectedIds[0]||''} onChange={e=>void setSelected([e.target.value])}><option value="" disabled>选择一个模型</option>{data.connections.map(c=><option key={c.id} value={c.id}>{c.name} · {c.model}</option>)}</select><ChevronDown size={13}/></div>:<>{selectedConnections.map(c=><span className="mini-chip" key={c.id}><Avatar name={c.provider} small/>{c.name}</span>)}<span className="muted">{selectedIds.length?selectedIds.length+' 位参与者':'尚未选择参与模型'}</span></>}
              {compact&&mode==='group'&&<button type="button" className="text-button" onClick={()=>setInspectorOpened(true)}><Users size={15}/>选择参与模型</button>}</div>
              <div className="composer-materials">{quote&&<div className="quote-preview"><Quote size={15}/><div><strong>引用 {quote.connectionName}</strong><span>{quote.content.slice(0,110)}</span></div><button type="button" className="icon-button" aria-label="取消引用" onClick={()=>setQuoteId(null)}><X size={15}/></button></div>}
              <MarkdownFiles state={documents} disabled={busy||running}/><LinkResults state={links}/></div>
              <textarea ref={inputRef} aria-label="输入问题" placeholder={mode==='group'?'问问大家，或者 @某个模型继续聊…':compact?'继续追问，或记录一个新想法…':'把问题、灵感，或还没想清楚的想法写在这里…'} value={composer} onChange={e=>setComposer(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void submit();}}} rows={compact?1:3} disabled={busy}/>
              <div className="composer-bottom"><label className="history-toggle" title="携带当前模型的历史上下文"><input type="checkbox" checked={history} onChange={e=>setHistory(e.target.checked)}/><History size={14}/>携带历史</label><LinkToggle state={links} disabled={busy||running}/>{mode==='group'&&selectedConnections.length>0&&<select className="target-picker" aria-label="发送给" value={target} onChange={e=>setTarget(e.target.value)}><option value="">@所有参与者</option>{selectedConnections.map(c=><option key={c.id} value={c.id}>@{c.name}</option>)}</select>}<span className="keyboard-hint">Enter 发送 · Shift + Enter 换行</span><MarkdownPicker state={documents} disabled={busy||running}/><VoiceInput key={activeId||'new'} editorRef={inputRef} onText={setComposer} disabled={busy}/><button type="submit" className="send-button" aria-label="发送问题" disabled={(!composer.trim()&&!documents.files.length)||busy||running||documents.loading}>{busy?<LoaderCircle size={20} className="spin"/>:<ArrowUp size={20}/>}</button></div>
            </form>}
            <p className="composer-disclaimer">{mode==='group'?'各模型独立回答；引用时才共享其他模型的答案。':'回答可能有误，请核实重要信息。'} 对话自动保存在本机。</p>
          </div>
        </main>
        {inspector&&<aside className="inspector"><div className="inspector-title"><h3>{mode==='group'?'群聊成员':'会话空间'}</h3><span>{mode==='group'?selectedIds.length+' 位':'PRIVATE'}</span></div><p className="inspector-description">{mode==='group'?'选择一起思考的 AI。每位成员独立回答，互不等待。':'选择这一轮的回答者，或切换到群聊比较不同观点。'}</p><div className="participants">{data.connections.map(c=><button key={c.id} className={'participant '+(selectedIds.includes(c.id)?'chosen':'')} onContextMenu={c.kind==='web'?e=>{e.preventDefault();setMemberMenu({connection:c,x:e.clientX,y:e.clientY,trigger:e.currentTarget});}:undefined} onKeyDown={c.kind==='web'?e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();const r=e.currentTarget.getBoundingClientRect();setMemberMenu({connection:c,x:r.left,y:r.bottom,trigger:e.currentTarget});}}:undefined} title={c.kind==='web'?'右键删除网页成员 · '+c.webUrl:undefined} onClick={()=>toggleConnection(c.id)} disabled={running}><Avatar name={c.provider} small/><div><strong>{c.name}</strong><small>{c.kind==='web'?'网页账号 · ':''}{c.model}</small></div><span className={'check-circle '+(selectedIds.includes(c.id)?'checked':'')}>{selectedIds.includes(c.id)&&<Check size={11}/>}</span></button>)}<button className="add-participant" onClick={()=>setWebMembersOpen(true)}><Link2 size={16}/>添加网页账号成员</button><button className="add-participant" onClick={()=>setConnectionEditor('new')}><Plus size={16}/>添加模型连接</button></div><div className="inspector-divider"/><div className="inspector-subtitle"><span>对话规则</span><SlidersHorizontal size={14}/></div><div className="rule-row"><span>回答方式</span><strong>{mode==='group'?'独立并发':'单模型'}</strong></div><div className="rule-row"><span>历史记录</span><strong>{history?(mode==='group'?'各自上下文':'当前分支'):'仅本次提问'}</strong></div><div className="rule-row"><span>保存位置</span><strong>本机</strong></div>{active&&<><div className="inspector-divider"/><div className="inspector-subtitle"><span>整理与导出</span><Folder size={14}/></div><button className="inspector-action" onClick={()=>setMetaEditor(true)}><FileText size={15}/>名称、文件夹与标签</button><button className="inspector-action" onClick={()=>void exportConversation('md')}><Download size={15}/>导出 Markdown</button><button className="inspector-action" onClick={()=>void exportConversation('json')}><Download size={15}/>导出 JSON 备份</button><button className="inspector-action" onClick={()=>void call('updateConversation',{id:active.id,archived:!active.archived})}><Archive size={15}/>{active.archived?'恢复会话':'归档会话'}</button></>}<div className="inspector-bottom"><Bookmark size={20}/><h4>好答案，值得留下</h4><p>收藏完整回答，或选中一段文字。加上笔记，让灵感变成积累。</p><button className="text-button" onClick={()=>setView('library')}>打开精选库<ArrowUpRight size={14}/></button></div></aside>}
      </div>}
    </div>
    {conversationMenu&&menuConversation&&<ConversationActions key={conversationMenu.id} request={conversationMenu} conversation={menuConversation} folders={folders} excerptCount={data.excerpts.filter(e=>e.conversationId===menuConversation.id).length} call={(action,payload)=>call(action,payload,true)} onClose={closeConversationMenu} notify={notify} onDeleted={id=>{if(activeId===id){setActiveId(null);setView('chat');setMetaEditor(false);setContextMessage(null);setQuoteId(null);}if(excerptEditor?.conversationId===id)setExcerptEditor(null);}}/>}
    {appearanceOpen&&<Modal title="工作台外观" onClose={closeAppearance} wide><AppearancePicker value={appearance} onChange={setAppearance}/></Modal>}
    {toast&&<div className="toast" role="status"><span>{toast}</span><button className="icon-button" aria-label="关闭提示" onClick={()=>setToast('')}><X size={15}/></button></div>}
    {transcriptEditor&&<TranscriptEditor onClose={closeTranscript} onSave={async input=>{const id=await call('importTranscript',input);if(id){openConversation(id);notify('原文和来源已保存在本机');}return id;}}/>}
    {memberMenu&&<MemberActions request={memberMenu} onClose={closeMemberMenu} onDelete={async id=>{await call('deleteConnection',{id},true);setDraftIds(ids=>ids.filter(value=>value!==id));setTarget(value=>value===id?'':value);notify('网页成员已删除，已有对话和收藏已保留');}}/>}
    {webMembersOpen&&<WebMembers connections={data.connections} conversationId={activeId} call={call} onClose={closeWebMembers} onSetup={()=>{setWebMembersOpen(false);setView('browser');}} onAdded={id=>{void setSelected([...new Set(mode==='single'?[id]:[...selectedIds,id])]);setWebMembersOpen(false);notify('网页成员已添加，可在群聊中选择并 @');}}/>}
    {connectionEditor&&<ConnectionEditor connection={connectionEditor==='new'?undefined:connectionEditor} onClose={closeConnection} onSave={async input=>{const id=await call('saveConnection',input);if(id){notify('连接已保存，可以开始对话');if(!active)setDraftIds(mode==='single'?[id]:[...draftIds,id]);}return id;}}/>}
    {excerptEditor&&<ExcerptEditor {...excerptEditor} onClose={closeExcerpt} onSave={async input=>{const id=await call('saveExcerpt',input);if(id)notify('已保存到精选库');return id;}}/>}
    {contextMessage&&<Modal title="本次发送的上下文" onClose={closeContext} wide><div className="context-details"><p className="muted">{contextMessage.webAccount?'这是本次转交网页的问题；历史由专用网页自行保留，工作台不会将其他模型回答自动加入。':'这是生成这条回答时实际发送的文本快照。模型服务可能另有自己的系统设置。'}</p><div className="context-summary">{contextMessage.connectionName} · {contextMessage.model} · {contextMessage.context?.length||0} 条消息</div>{contextMessage.context?.map((m,i)=><div className="context-item" key={i}><strong>{m.role==='user'?'用户':'助手'}</strong><pre>{m.content}</pre></div>)}{!contextMessage.context?.length&&<p>这条历史记录没有保存请求上下文。</p>}</div></Modal>}
    {metaEditor&&active&&<MetadataEditor conversation={active} onClose={closeMeta} onSave={async input=>{await call('updateConversation',input);closeMeta();}}/>}
  </div>;
}
function KeyIcon(){return <Link2 size={16}/>;}
function MetadataEditor({conversation,onClose,onSave}:{conversation:Conversation;onClose:()=>void;onSave:(data:unknown)=>Promise<void>}) {
  const [title,setTitle]=useState(conversation.title),[folder,setFolder]=useState(conversation.folder),[tags,setTags]=useState(conversation.tags.join('，'));
  return <Modal title="整理会话" onClose={onClose}><form className="form" onSubmit={e=>{e.preventDefault();void onSave({id:conversation.id,title,folder,tags:tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean)});}}><label>会话名称<input required maxLength={150} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>文件夹<input maxLength={80} value={folder} onChange={e=>setFolder(e.target.value)} placeholder="例如：项目灵感"/></label><label>标签<input value={tags} onChange={e=>setTags(e.target.value)} placeholder="用逗号分隔"/></label><div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary"><Check size={16}/>保存</button></div></form></Modal>;
}
