import {MAX_PROMPT_CHARACTERS} from '../shared/chat-limits.js';
import {useRef,useState,useCallback,type DragEvent} from 'react';
import {FileText,Paperclip,X} from 'lucide-react';
import {Modal} from './components';
import './markdown-files.css';

type MarkdownFile={id:string;name:string;content:string;format?:string;notice?:string};
const textFile=(name:string)=>/\.(md|markdown|mdown|txt|csv|tsv)$/i.test(name);
const acceptedFile=(name:string)=>/\.(md|markdown|mdown|txt|csv|tsv|doc|docx|xls|xlsx|ppt|pptx|pdf)$/i.test(name);
export function markdownPrompt(text:string,files:MarkdownFile[],limit:number){
 let result=text;
 if(files.length){
  result=text.trim()||'请阅读以下文件内容。';
  for(const file of files){
   const fence='~'.repeat(Math.max(3,...[...file.content.matchAll(/~+/g)].map(m=>m[0].length+1)));
   result+='\n\n文件：'+file.name+'\n'+fence+(file.format||'markdown')+'\n'+file.content+'\n'+fence;
  }
 }
 if(result.length>limit)throw new Error('问题和文件内容合计超过 '+limit.toLocaleString()+' 字符，请减少文件或拆分发送；文件尚未发送。');
 return result;
}
export function useMarkdownFiles(limit:number=MAX_PROMPT_CHARACTERS){
 const [files,setFiles]=useState<MarkdownFile[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const generation=useRef(0),reading=useRef(false);
 const reset=()=>{generation.current++;reading.current=false;setFiles([]);setError('');setLoading(false);};
 const add=async(incoming:File[])=>{
  if(!incoming.length||reading.current)return;
  const ticket=generation.current;reading.current=true;setLoading(true);setError('');
  try{
   if(files.length+incoming.length>5)throw new Error('每次最多添加 5 个文件');
   const added:MarkdownFile[]=[];
   for(const file of incoming){
    if(!acceptedFile(file.name))throw new Error('支持 MD、TXT、CSV、Word（doc/docx）、Excel（xls/xlsx）、PowerPoint（ppt/pptx）和 PDF');
    const sizeLimit=textFile(file.name)?1:10;
    if(file.size>sizeLimit*1024*1024)throw new Error(file.name+' 超过 '+sizeLimit+' MB，请拆分后添加');
    if(!file.size)throw new Error(file.name+' 是空文件');
    if(!window.workbench)throw new Error('请在新版桌面工作台中读取文件');
    const bytes=new Uint8Array(await file.arrayBuffer());
    const result=await window.workbench.call('readChatFile',{name:file.name.replace(/[\r\n]/g,' '),bytes,limit});
    added.push({id:crypto.randomUUID(),...result});
   }
   markdownPrompt('',[...files,...added],limit);
   if(ticket===generation.current)setFiles(old=>[...old,...added]);
  }catch(e){if(ticket===generation.current)setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /,''));}
  finally{if(ticket===generation.current){reading.current=false;setLoading(false);}}
 };
 const dragProps=(disabled=false)=>({
  onDragOver:(e:DragEvent)=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect=disabled?'none':'copy';}},
  onDrop:(e:DragEvent)=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.stopPropagation();if(!disabled)void add([...e.dataTransfer.files]);}}
 });
 return {files,error,loading,reset,add,setError,dragProps,remove:(id:string)=>{setFiles(old=>old.filter(f=>f.id!==id));setError('');}};
}
type MarkdownState=ReturnType<typeof useMarkdownFiles>;
export function MarkdownPicker({state,disabled=false}:{state:MarkdownState;disabled?:boolean}){
 const input=useRef<HTMLInputElement>(null);
 return <><input ref={input} className="md-file-input" type="file" accept=".md,.markdown,.mdown,.txt,.csv,.tsv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf" multiple aria-label="选择文件" disabled={disabled||state.loading} onChange={e=>{const files=[...(e.target.files||[])];e.target.value='';void state.add(files);}}/><button type="button" className="text-button md-file-picker" disabled={disabled||state.loading} title="添加 MD、TXT、Word、Excel、PPT、PDF，也可拖到输入框；提取的内容随问题发送" onClick={()=>input.current?.click()}><Paperclip size={15}/>{state.loading?'读取文件…':'添加文件'}</button></>;
}
export function MarkdownFiles({state,disabled=false}:{state:MarkdownState;disabled?:boolean}){
 const [preview,setPreview]=useState<string|null>(null),selected=state.files.find(f=>f.id===preview);
 const closePreview=useCallback(()=>setPreview(null),[]);
 return <>{!!state.files.length&&<div className="md-file-list" aria-label="待发送文件">{state.files.map(file=><div className="md-file-card" key={file.id}><FileText size={19}/><button type="button" className="md-file-preview" onClick={()=>setPreview(file.id)} aria-label={'预览 '+file.name} title={'预览 '+file.name}><strong>{file.name}</strong><small>{file.content.length.toLocaleString()} 字符 · 内容随问题发送</small>{file.notice&&<small className="file-read-notice">{file.notice}</small>}</button><button type="button" className="icon-button" disabled={disabled||state.loading} aria-label={'移除文件 '+file.name} onClick={()=>state.remove(file.id)}><X size={14}/></button></div>)}</div>}{state.error&&<p className="md-file-error" role="alert">{state.error}</p>}{selected&&<Modal title={'预览文件 · '+selected.name} wide onClose={closePreview}><div className="md-file-source">{selected.notice&&<p>{selected.notice}</p>}<pre>{selected.content}</pre><p>发送后，提取的内容会保存在本条消息中；这会占用模型上下文。</p></div></Modal>}</>;
}
