import {useCallback,useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Pencil,Pin,PinOff,Share2,Folder,Archive,ArchiveRestore,Download,ExternalLink,Trash2,Copy,Check} from 'lucide-react';
import type {Conversation} from './types';
import {Mark,Modal} from './components';
import './conversation-actions.css';

export type ConversationMenuRequest={id:string;x:number;y:number;trigger:HTMLElement};
type Props={request:ConversationMenuRequest;conversation:Conversation;folders:string[];excerptCount:number;call:(action:string,payload?:unknown)=>Promise<any>;onClose:()=>void;onDeleted:(id:string)=>void;notify:(text:string)=>void};
type Mode='menu'|'rename'|'folder'|'share'|'delete';
export function ConversationActions({request,conversation:c,folders,excerptCount,call,onClose,onDeleted,notify}:Props){
  const [mode,setMode]=useState<Mode>('menu'),[value,setValue]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [includeNotes,setIncludeNotes]=useState(false),[share,setShare]=useState<{preview:string;characters:number;truncated:boolean}|null>(null),[copied,setCopied]=useState(false);
  const menu=useRef<HTMLDivElement>(null),field=useRef<HTMLInputElement>(null);
  const close=useCallback(()=>{onClose();requestAnimationFrame(()=>{if(request.trigger.isConnected)request.trigger.focus({preventScroll:true});});},[onClose,request.trigger]);
  useLayoutEffect(()=>{
    if(mode!=='menu'||!menu.current)return;
    const el=menu.current,rect=el.getBoundingClientRect();
    el.style.left=Math.max(8,Math.min(request.x,window.innerWidth-rect.width-8))+'px';
    el.style.top=Math.max(8,Math.min(request.y,window.innerHeight-rect.height-8))+'px';
    el.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
  },[request.x,request.y,mode]);
  useEffect(()=>{
    if(mode!=='menu')return;
    const outside=(e:PointerEvent)=>{if(!menu.current?.contains(e.target as Node))onClose();};
    const scroll=(e:Event)=>{const target=e.target as Node;if(!menu.current?.contains(target)&&(target===document||target.contains?.(request.trigger)))onClose();};
    document.addEventListener('pointerdown',outside);document.addEventListener('scroll',scroll,true);window.addEventListener('resize',close);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',close);};
  },[mode,onClose,close]);
  useEffect(()=>{if(mode==='rename'||mode==='folder')field.current?.select();},[mode]);
  useEffect(()=>{
    if(mode!=='share')return;
    let live=true;setShare(null);setCopied(false);setError('');
    window.workbench?.call('conversationShare',{conversationId:c.id,includeNotes}).then(result=>{if(live)setShare(result);}).catch(e=>{if(live)setError(String(e.message));});
    return()=>{live=false;};
  },[mode,c.id,c.updatedAt,includeNotes]);
  const perform=async(action:string,payload:unknown,success?:string,dismiss=true)=>{
    setBusy(true);setError('');
    try{
      const result=await call(action,payload);
      if(result==null)return false;
      if(success)notify(success);if(dismiss)close();return true;
    }catch(e){setError(String((e as Error).message).replace(/^Error invoking remote method '[^']+': Error: /,''));return false;}finally{setBusy(false);}
  };
  const choose=(next:Mode)=>{setError('');setValue(next==='rename'?c.title:next==='folder'?c.folder:'');setMode(next);};
  const item=(label:string,icon:ReactNode,action:()=>void,danger=false)=><button type="button" role="menuitem" disabled={busy} className={danger?'menu-danger':''} onClick={action}>{icon}<span>{label}</span></button>;
  if(mode==='menu')return createPortal(<div ref={menu} role="menu" aria-label={'会话操作：'+c.title} className="conversation-menu" style={{left:request.x,top:request.y}} onContextMenu={e=>e.preventDefault()} onKeyDown={e=>{
    const buttons=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    if(e.key==='Escape'){e.preventDefault();close();}
    else if(e.key==='Tab'){e.preventDefault();close();}
    else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
  }}>
    <div className="conversation-menu-title" title={c.title}>{c.title}</div>
    {item('重命名',<Pencil size={16}/>,()=>choose('rename'))}
    {item(c.pinned?'取消置顶':'置顶',c.pinned?<PinOff size={16}/>:<Pin size={16}/>,()=>void perform('updateConversation',{id:c.id,pinned:!c.pinned},c.pinned?'已取消置顶':'已置顶'))}
    {item('移动到文件夹',<Folder size={16}/>,()=>choose('folder'))}
    {item('分享',<Share2 size={16}/>,()=>choose('share'))}
    <div role="separator"/>
    {item('导出 Markdown',<Download size={16}/>,()=>void perform('exportConversation',{conversationId:c.id,format:'md'},'已导出 Markdown'))}
    {item('导出 JSON 备份',<Download size={16}/>,()=>void perform('exportConversation',{conversationId:c.id,format:'json'},'已导出 JSON'))}
    {(c.webChat?.url||c.source?.urls?.length)&&item('打开原网页',<ExternalLink size={16}/>,()=>void perform('openConversationSource',{conversationId:c.id}))}
    <div role="separator"/>
    {item(c.archived?'恢复会话':'归档会话',c.archived?<ArchiveRestore size={16}/>:<Archive size={16}/>,()=>void perform('updateConversation',{id:c.id,archived:!c.archived},c.archived?'会话已恢复':'会话已归档'))}
    {item('删除',<Trash2 size={16}/>,()=>choose('delete'),true)}
    {error&&<p className="action-error" role="alert">{error}</p>}
  </div>,document.body);
  return <Modal title={mode==='rename'?'重命名会话':mode==='folder'?'移动到文件夹':mode==='share'?'分享会话':'删除会话'} onClose={close} wide={mode==='share'}>
    <form className="form conversation-action-form" onSubmit={async e=>{
      e.preventDefault();if(busy)return;
      if(mode==='rename'||mode==='folder')await perform('updateConversation',{id:c.id,[mode==='rename'?'title':'folder']:value},mode==='rename'?'名称已更新':'文件夹已更新');
      if(mode==='delete'&&await perform('deleteConversation',{id:c.id},'本地会话已删除'))onDeleted(c.id);
    }}>
      {mode==='rename'&&<label>会话名称<input ref={field} autoFocus required maxLength={150} value={value} onChange={e=>setValue(e.target.value)}/></label>}
      {mode==='folder'&&<><p className="muted">选择已有文件夹，或输入新名称。留空会移出当前文件夹。</p><label>文件夹<input ref={field} autoFocus list="conversation-folders" maxLength={80} value={value} onChange={e=>setValue(e.target.value)}/></label><datalist id="conversation-folders">{folders.map(f=><option key={f} value={f}/>)}</datalist></>}
      {mode==='delete'&&<><p className="action-target">确定删除「{c.title}」？</p><p className="muted">将永久删除本机的 {c.messages.length} 条消息{excerptCount>0?'，以及关联的 '+excerptCount+' 条精选和笔记':''}，无法撤销。原网站的聊天记录不受影响。</p><p className="muted">如果只是暂时收起，可取消后选择「归档会话」。</p></>}
      {mode==='share'&&<>
        <p className="muted">复制对话文字，或导出 Markdown 文件后自行分享。不会生成公开链接。</p>
        <label className="share-notes"><input type="checkbox" checked={includeNotes} disabled={busy} onChange={e=>setIncludeNotes(e.target.checked)}/>包含我的笔记和精选</label>
        <div className="share-preview" aria-label="分享内容预览">{share?<Mark repairTables>{share.preview}</Mark>:<p className="muted">正在生成预览…</p>}</div>
        {share&&<p className="muted">{share.characters.toLocaleString()} 字符{share.truncated?' · 预览仅显示开头，复制和导出包含完整内容':''}</p>}
      </>}
      {error&&<p className="action-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="secondary" disabled={busy} onClick={close}>{mode==='share'?'关闭':'取消'}</button>
        {mode==='share'?<>
          <button type="button" className="secondary" disabled={busy||!share} onClick={()=>void perform('exportConversation',{conversationId:c.id,format:'md',includeNotes},'分享文件已导出',false)}><Download size={15}/>导出分享文件</button>
          <button type="button" className="primary" aria-label={copied?'已复制':'复制 Markdown'} disabled={busy||!share} onClick={async()=>{if(await perform('copyConversation',{conversationId:c.id,includeNotes},undefined,false))setCopied(true);}}>{copied?<Check size={15}/>:<Copy size={15}/>}<span role="status">{copied?'已复制':'复制 Markdown'}</span></button>
        </>:<button type="submit" disabled={busy||(mode==='rename'&&!value.trim())} className={mode==='delete'?'primary delete-confirm':'primary'}>{busy?'处理中…':mode==='delete'?'永久删除':'保存'}</button>}
      </div>
    </form>
  </Modal>;
}
