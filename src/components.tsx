import {useEffect,useRef,useState,type ReactNode,type FormEvent} from 'react';
import {X,Check,Copy,KeyRound,Plug,LoaderCircle} from 'lucide-react';
import {codeBlockSource,markdownCode} from './code-block';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {Connection,Excerpt,Message} from './types';
import {formatArchiveMarkdown} from './transcript-format';

// Allow only a line break from extracted table cells; never enable arbitrary raw HTML.
function tableBreaks() {
  return (tree:any)=>{const visit=(node:any)=>{if(node.children)node.children=node.children.map((child:any)=>{if(child.type==='html'&&/^<br\s*\/?\s*>$/i.test(child.value))return {type:'break'};visit(child);return child;});};visit(tree);};
}
function CodeBlock({content,language,sourceOffset,depth}:{content:string;language:string;sourceOffset:number;depth:number}) {
  const canPreview=depth<3&&(!language||/^(md|markdown|mdown)$/i.test(language));
  const [reading,setReading]=useState(canPreview&&markdownCode(language,content));
  const [status,setStatus]=useState('');
  useEffect(()=>setStatus(''),[content]);
  const copy=async()=>{
    try{if(!window.workbench)throw new Error('工作台尚未连接');await window.workbench.call('copyText',{text:content});setStatus('已复制');}
    catch{setStatus('复制失败，请切到源码后手动复制');}
  };
  return <div className="code-block">
    <div className="code-block-toolbar"><span>{language||(reading?'Markdown':'文本')}</span>
      <div>{canPreview&&<><button type="button" aria-pressed={reading} onClick={()=>setReading(true)}>阅读</button><button type="button" aria-pressed={!reading} onClick={()=>setReading(false)}>源码</button></>}
        <button type="button" className="code-copy" title="复制原文到剪贴板" aria-label="复制代码块原文" onClick={()=>void copy()}>{status==='已复制'?<Check size={16}/>:<Copy size={16}/>}<span>{status==='已复制'?'已复制':'复制'}</span></button>
      </div>
    </div>
    {status&&<span className="code-copy-status" role="status">{status}</span>}
    {reading?<div className="code-block-reading"><Mark repairTables sourceOffset={sourceOffset} previewDepth={depth+1}>{content}</Mark></div>:<pre><code>{content}</code></pre>}
  </div>;
}
export function Mark({children,repairTables=false,sourceOffset=0,previewDepth=0}:{children:string;repairTables?:boolean;sourceOffset?:number;previewDepth?:number}) {
  const formatted=formatArchiveMarkdown(children,repairTables);
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm,tableBreaks]} components={{img:({src,alt})=>src?.startsWith('data:image/')?<img src={src} alt={alt}/>:<span>[图片]</span>,
    pre:({node,...props})=>{
      const code=node?.children.find(child=>child.type==='element'&&child.tagName==='code');
      if(!code||code.type!=='element')return <pre {...props}/>;
      const content=code.children.map(child=>child.type==='text'?child.value:'').join('').replace(/\n$/,'');
      const classes=Array.isArray(code.properties.className)?code.properties.className:[],language=String(classes.find(c=>String(c).startsWith('language-'))||'').replace(/^language-/,'');
      const start=formatted.sourceOffset(node?.position?.start.offset||0),end=formatted.sourceOffset(node?.position?.end.offset??children.length,true);
      const original=codeBlockSource(children.slice(start,end),content,language);
      return <CodeBlock content={original.content} language={original.language} sourceOffset={sourceOffset+start+original.offset} depth={previewDepth}/>;
    },
    a:({node,...props})=><a {...props} target="_blank" rel="noreferrer"/>,
    table:({node,...props})=><div className="table-scroll" role="region" aria-label="表格" tabIndex={0}
      data-source-start={node?.position?.start.offset===undefined?undefined:sourceOffset+formatted.sourceOffset(node.position.start.offset)}
      data-source-end={node?.position?.end.offset===undefined?undefined:sourceOffset+formatted.sourceOffset(node.position.end.offset,true)}><table {...props}/></div>
  }}>{formatted.markdown}</ReactMarkdown></div>;
}
export function Avatar({name='AI',small=false}:{name?:string;small?:boolean}) {
  const tone=/deepseek/i.test(name)?'blue':/gemini/i.test(name)?'purple':/grok/i.test(name)?'dark':'teal';
  return <span className={'avatar '+tone+(small?' small':'')}>{/deepseek/i.test(name)?'D':/gemini/i.test(name)?'G':name.slice(0,1).toUpperCase()}</span>;
}
export function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();const cancel=(e:Event)=>{e.preventDefault();onClose();};dialog?.addEventListener('cancel',cancel);return()=>{dialog?.removeEventListener('cancel',cancel);dialog?.close();};},[onClose]);
  return <dialog ref={ref} className={'modal '+(wide?'wide':'')} aria-label={title}><div className="modal-head"><h2>{title}</h2><button type="button" className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={19}/></button></div>{children}</dialog>;
}
export function ConnectionEditor({connection,onClose,onSave}:{connection?:Connection;onClose:()=>void;onSave:(data:unknown)=>Promise<any>}) {
  const [provider,setProvider]=useState(connection?.provider||'DeepSeek');
  const [name,setName]=useState(connection?.name||'DeepSeek');
  const [model,setModel]=useState(connection?.model||'deepseek-v4-flash');
  const [baseUrl,setBaseUrl]=useState(connection?.baseUrl||'https://api.deepseek.com');
  const [apiKey,setKey]=useState('');
  const [busy,setBusy]=useState(false);
  const preset=(value:string)=>{
    setProvider(value);setName(value);setKey('');
    setBaseUrl(value==='DeepSeek'?'https://api.deepseek.com':value==='Gemini'?'https://generativelanguage.googleapis.com/v1beta/openai':'');
    setModel(value==='DeepSeek'?'deepseek-v4-flash':'');
  };
  const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);try{const result=await onSave({id:connection?.id,provider,name,model,baseUrl,apiKey});if(result)onClose();}finally{setBusy(false);}};
  return <Modal title={connection?'编辑模型连接':'添加模型连接'} onClose={onClose}><form onSubmit={submit} className="form">
    <p className="muted">连接你的 API。密钥经系统加密后仅保存在本机，不会出现在会话导出中。</p>
    <label>供应商<select value={provider} onChange={e=>preset(e.target.value)}><option>DeepSeek</option><option>Gemini</option><option value="自定义">其他 / OpenAI 兼容接口</option>{!['DeepSeek','Gemini','自定义'].includes(provider)&&<option>{provider}</option>}</select></label>
    <div className="form-row"><label>连接名称<input required value={name} maxLength={80} onChange={e=>setName(e.target.value)} placeholder="例如：DeepSeek · 日常"/></label><label>模型 ID<input required value={model} onChange={e=>setModel(e.target.value)} placeholder="填写账号可用的模型 ID"/></label></div>
    <label>API 基础地址<input required value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1"/></label>
    <label>API Key <span className="optional">{connection?.hasKey?'已保存 · 留空保持原密钥':''}</span><input type="password" autoComplete="off" spellCheck={false} required={!connection?.hasKey} value={apiKey} onChange={e=>setKey(e.target.value)} placeholder={connection?.hasKey?'••••••••（不会回显已存密钥）':'在这里粘贴 API Key'}/></label>
    <div className="info-line"><KeyRound size={16}/>连接同一供应商的不同模型，可分别保存为不同连接。</div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={16}/>:<Plug size={16}/>}保存连接</button></div>
  </form></Modal>;
}
export function ExcerptEditor({message,conversationId,existing,selection,onClose,onSave}:{message:Message;conversationId:string;existing?:Excerpt;selection?:string;onClose:()=>void;onSave:(data:unknown)=>Promise<any>}) {
  const [title,setTitle]=useState(existing?.title||(selection||message.content).replace(/[#*\n]/g,' ').slice(0,38));
  const [note,setNote]=useState(existing?.note||'');
  const [tags,setTags]=useState(existing?.tags.join('，')||'');
  const content=existing?.content||selection||message.content;
  return <Modal title={existing?'编辑精选笔记':'保存到精选库'} onClose={onClose}><form className="form" onSubmit={async e=>{e.preventDefault();if(await onSave({id:existing?.id,conversationId,messageId:message.id,title,content,note,tags:tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean)}))onClose();}}>
    <label>标题<input required value={title} maxLength={150} onChange={e=>setTitle(e.target.value)}/></label>
    <div className="excerpt-preview"><Mark repairTables={message.isTranscript}>{content}</Mark></div>
    <label>标签<span className="optional">用逗号分隔</span><input value={tags} onChange={e=>setTags(e.target.value)} placeholder="灵感，研究，写作"/></label>
    <label>我的笔记<textarea value={note} onChange={e=>setNote(e.target.value)} rows={3} placeholder="为什么值得保留？下次准备怎样使用？"/></label>
    <p className="muted">原始内容与模型来源会一起保存，可随时回到原对话。</p>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary"><Check size={16}/>保存精选</button></div>
  </form></Modal>;
}

export function MessageCopy({content}:{content:string}){
 const [status,setStatus]=useState('');const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 return <button type="button" className="text-button message-copy" title="复制这条消息的完整原文" aria-label="复制消息" disabled={!content} onClick={async()=>{
  try{await window.workbench!.call('copyText',{text:content});setStatus('已复制');}
  catch{setStatus('复制失败');}
  clearTimeout(timer.current);timer.current=setTimeout(()=>setStatus(''),2000);
 }}><Copy size={14}/><span aria-live="polite">{status||'复制'}</span></button>;
}
