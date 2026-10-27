import {useEffect,useState} from 'react';
import {Modal} from './components';
import type {Connection} from './types';
const providers=[['gemini','Gemini'],['chatgpt','ChatGPT'],['yuanbao','元宝'],['doubao','豆包']];
type Status={online:boolean;ready:boolean;busy:boolean;bindingId?:string;conversationId?:string;url?:string;reason?:string;history?:{phase:string;message?:string}};
export function WebMembers({connections,conversationId,call,onAdded,onSetup,onClose}:{connections:Connection[];conversationId:string|null;call:(action:string,payload?:unknown)=>Promise<any>;onAdded:(id:string)=>void;onSetup:()=>void;onClose:()=>void}){
 const [statuses,setStatuses]=useState<Record<string,Status>>({}),[busy,setBusy]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let live=true,timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const result=await window.workbench!.call('webMemberStatuses');if(live)setStatuses(result);}catch{if(live)setError('暂时无法读取连接状态');}finally{if(live)timer=setTimeout(poll,1500);}};void poll();return()=>{live=false;clearTimeout(timer);};},[]);
 return <Modal title="添加网页账号成员" onClose={onClose}><div className="form"><p className="muted">无需 API Key。先在各自浏览器的专用网页会话点击扩展连接，保持原网页和连接页打开，再添加为成员。</p>{providers.map(([key,name])=>{
  const s=statuses[key],existing=connections.find(c=>c.kind==='web'&&c.webProvider===key&&(s?.conversationId?c.webConversationId===s.conversationId:c.webUrl===s?.url)),ownedElsewhere=!!existing?.groupConversationId&&existing.groupConversationId!==conversationId;
  const available=!!s?.online&&s.ready&&!s.busy&&!!s.bindingId&&!ownedElsewhere;
  const description=!s?'正在检查网页连接…':!s.online?'尚未连接网页':ownedElsewhere?'这条网页已专用于另一工作台对话，请换一条网页会话':s.busy?(s.history?.phase==='loading'?'正在同步历史，完成后可添加':'网页正在回答，完成后可添加'):!s.ready?(s.reason||'网页输入区尚未就绪，请查看连接诊断'):!s.bindingId?'网页连接标识缺失，请重新连接':!s.conversationId?'网页已连接；加入时建立本地记录，网页历史尚未同步':s.history?.phase==='failed'?'网页已连接；历史同步失败，仍可加入并继续聊天':'网页已连接，可以加入成员';
  return <div className="web-member-row" key={key}><strong>{name}</strong><small>{description}{s?.url&&<span title={s.url}>{s.url}</span>}</small><button type="button" className="secondary small-button" disabled={!available||!!busy} title={busy?'正在添加其他成员，请稍候':description} onClick={async()=>{setBusy(key);setError('');try{const id=await call('saveWebConnection',{provider:key,bindingId:s!.bindingId,conversationId:s!.conversationId});if(id)onAdded(id);else setError('未能添加，请检查连接状态');}finally{setBusy('');}}}>{busy===key?'添加中…':'加入成员'}</button></div>;
 })}{error&&<p role="alert" className="md-file-error">{error}</p>}<p className="muted">不 @ 时发送给所有选中成员；@ 时只发给指定成员。不会自动转交其他模型回答。网页沿用自己的历史，「携带历史」只控制 API 成员；一条专用网页只用于一条工作台对话。</p><button type="button" className="text-button" onClick={onSetup}>查看浏览器连接步骤</button></div></Modal>;
}
