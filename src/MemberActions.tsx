import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Trash2} from 'lucide-react';
import type {Connection} from './types';
import './conversation-actions.css';
export type MemberMenuRequest={connection:Connection;x:number;y:number;trigger:HTMLElement};
export function MemberActions({request,onClose,onDelete}:{request:MemberMenuRequest;onClose:()=>void;onDelete:(id:string)=>Promise<void>}){
 const menu=useRef<HTMLDivElement>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const close=()=>{onClose();if(request.trigger.isConnected)request.trigger.focus({preventScroll:true});};
 useLayoutEffect(()=>{const el=menu.current;if(!el)return;const r=el.getBoundingClientRect();el.style.left=Math.max(8,Math.min(request.x,innerWidth-r.width-8))+'px';el.style.top=Math.max(8,Math.min(request.y,innerHeight-r.height-8))+'px';el.querySelector('button')?.focus({preventScroll:true});},[request,error]);
 useEffect(()=>{
  const outside=(e:PointerEvent)=>{if(!menu.current?.contains(e.target as Node))onClose();};
  const scroll=(e:Event)=>{if(!menu.current?.contains(e.target as Node))onClose();};
  document.addEventListener('pointerdown',outside,true);window.addEventListener('resize',onClose);window.addEventListener('scroll',scroll,true);
  return()=>{document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',onClose);window.removeEventListener('scroll',scroll,true);};
 },[onClose]);
 return createPortal(<div ref={menu} className="conversation-menu member-context-menu" role="menu" aria-label={'网页成员操作：'+request.connection.name} style={{left:request.x,top:request.y}} onContextMenu={e=>e.preventDefault()} onKeyDown={e=>{if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();close();}else if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();menu.current?.querySelector('button')?.focus();}}}>
  <div className="conversation-menu-title">{request.connection.name}</div>
  <p className="member-menu-source">{request.connection.webUrl}</p>
  <button type="button" role="menuitem" className="menu-danger" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await onDelete(request.connection.id);onClose();}catch(e){setError(String((e as Error).message).replace(/^Error invoking remote method '[^']+': Error: /,''));}finally{setBusy(false);}}}><Trash2 size={16}/>{busy?'正在删除…':'删除网页成员'}</button>
  <p className="member-menu-hint">从成员列表移除，保留已有对话和收藏。</p>
  {error&&<p className="action-error" role="alert">{error}</p>}
 </div>,document.body);
}
