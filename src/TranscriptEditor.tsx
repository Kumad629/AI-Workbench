import {useState} from 'react';
import {Archive,Link2} from 'lucide-react';
import {Modal} from './components';
export function TranscriptEditor({onClose,onSave}:{onClose:()=>void;onSave:(data:unknown)=>Promise<any>}) {
  const [title,setTitle]=useState(''),[content,setContent]=useState(''),[urls,setUrls]=useState(''),[note,setNote]=useState(''),[product,setProduct]=useState('Grok');
  return <Modal title="保存外部对话" onClose={onClose} wide><form className="form" onSubmit={async e=>{e.preventDefault();const id=await onSave({title,content,product,note,urls:urls.split('\n').map(s=>s.trim()).filter(Boolean)});if(id)onClose();}}>
    <p className="muted">把 Grok 中值得保留的讨论粘贴到这里。原文、X 帖子链接和自己的想法一起保存，不需要 API Key。</p>
    <div className="form-row"><label>标题<input required maxLength={150} value={title} onChange={e=>setTitle(e.target.value)} placeholder="这次讨论带来了什么想法？"/></label><label>来源产品<select value={product} onChange={e=>setProduct(e.target.value)}>{['Grok','元宝','豆包','ChatGPT','Gemini','YouTube 提问','Kimi','其他'].map(p=><option key={p}>{p}</option>)}</select></label></div>
    <label>对话原文<textarea required rows={9} value={content} onChange={e=>setContent(e.target.value)} placeholder="粘贴完整对话或 Markdown，保留原有的提问和回答标记。"/></label>
    <label>来源链接<span className="optional">一行一个，可同时保存 X 原帖与 Grok 对话链接</span><textarea rows={2} value={urls} onChange={e=>setUrls(e.target.value)} placeholder="https://x.com/…"/></label>
    <label>我的想法 / 项目草案<textarea rows={4} value={note} onChange={e=>setNote(e.target.value)} placeholder="讨论触发的想法、项目目标、下一步……"/></label>
    <div className="info-line"><Link2 size={16}/>链接仅作为来源保存；本次不会自动抓取链接或访问你的账号。</div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary"><Archive size={16}/>保存原文</button></div>
  </form></Modal>;
}
