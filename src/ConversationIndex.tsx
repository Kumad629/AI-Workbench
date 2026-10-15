import {useEffect,useLayoutEffect,useMemo,useRef,useState,type RefObject} from 'react';
import type {Message} from './types';
import {transcriptTurns} from './transcript-format';
import './conversation-index.css';

type Entry={id:string;messageId:string;title:string;preview:string;page?:number};
const excerpt=(text:string,limit=180)=>text.slice(0,1500).replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[`#*_>|]/g,'').replace(/\s+/g,' ').trim().slice(0,limit);
function entriesFor(messages:Message[]):Entry[]{
  const entries:Entry[]=[];
  const transcripts=messages.filter(m=>m.isTranscript);
  const archiveParents=new Set(transcripts.map(m=>m.replyTo));
  for(let i=0;i<messages.length;i++){
    const message=messages[i];
    if(message.isTranscript){
      const turns=transcriptTurns(message.content),page=Math.floor(transcripts.indexOf(message)/2);
      let count=0;
      turns.forEach((turn,j)=>{
        if(turn.role!=='user')return;
        const answers=[];
        for(let k=j+1;k<turns.length&&turns[k].role!=='user';k++)answers.push(excerpt(turns[k].content,140));
        entries.push({id:'transcript-'+message.id+'-'+j,messageId:message.id,title:excerpt(turn.content)||'空白提问',preview:answers.join(' · ').slice(0,240),page});count++;
      });
      // Unlabelled captures stay unlabelled; do not invent question/answer roles.
      if(!count)entries.push({id:'message-'+message.id,messageId:message.id,title:'原文片段 · '+(transcripts.indexOf(message)+1),preview:excerpt(message.content),page});
    }else if(message.role==='user'&&!archiveParents.has(message.id)){
      const answers=messages.filter(m=>m.role==='assistant'&&m.replyTo===message.id);
      const following=messages[i+1];
      const reply=answers.length?answers:following?.role==='assistant'?[following]:[];
      entries.push({id:'message-'+message.id,messageId:message.id,title:excerpt(message.content)||'空白提问',preview:reply.map(m=>(reply.length>1?(m.connectionName||'AI')+'：':'')+excerpt(m.content,140)).join(' · ').slice(0,240)});
    }
  }
  return entries;
}
export function ConversationIndex({messages,scrollRef,page=0,onPage}:{messages:Message[];scrollRef:RefObject<HTMLDivElement|null>;page?:number;onPage?:(page:number)=>void}){
  const entries=useMemo(()=>entriesFor(messages),[messages]);
  const [active,setActive]=useState(''),[preview,setPreview]=useState<{id:string;y:number}|null>(null);
  const nav=useRef<HTMLElement>(null),rail=useRef<HTMLDivElement>(null),pending=useRef<Entry|null>(null);
  const [request,setRequest]=useState(0);
  const jump=(entry:Entry)=>{
    pending.current=entry;setActive(entry.id);setPreview(null);
    if(entry.page!==undefined&&entry.page!==page)onPage?.(entry.page);
    setRequest(n=>n+1);
  };
  useLayoutEffect(()=>{
    const entry=pending.current,container=scrollRef.current;
    if(!entry||!container||entry.page!==undefined&&entry.page!==page)return;
    // A saved archive may currently be showing its raw Markdown.
    document.getElementById('message-'+entry.messageId)?.dispatchEvent(new Event('reveal-transcript'));
    const frame=requestAnimationFrame(()=>{
      const target=document.getElementById(entry.id);
      if(target&&container.contains(target)){
        const sticky=container.querySelector<HTMLElement>('.archive-pagination')?.offsetHeight||0;
        container.scrollTo({top:container.scrollTop+target.getBoundingClientRect().top-container.getBoundingClientRect().top-sticky-16,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
        pending.current=null;
      }
    });
    return()=>cancelAnimationFrame(frame);
  },[request,page,scrollRef]);
  useEffect(()=>{
    const container=scrollRef.current;if(!container)return;
    let frame=0;
    const update=()=>{
      frame=0;
      const anchors=entries.flatMap(entry=>{
        const node=document.getElementById(entry.id);
        return node&&container.contains(node)?[{entry,node}]:[];
      });
      if(!anchors.length)return;
      const top=container.getBoundingClientRect().top+(container.querySelector<HTMLElement>('.archive-pagination')?.offsetHeight||0)+36;
      let current=anchors[0].entry.id;
      for(const {entry,node} of anchors){if(node.getBoundingClientRect().top<=top)current=entry.id;else break;}
      if(container.scrollHeight>container.clientHeight+2&&container.scrollHeight-container.scrollTop-container.clientHeight<3)current=anchors.at(-1)!.entry.id;
      setActive(current);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    container.addEventListener('scroll',schedule,{passive:true});
    const resize=new ResizeObserver(schedule);resize.observe(container);if(container.firstElementChild)resize.observe(container.firstElementChild);
    const mutation=new MutationObserver(schedule);mutation.observe(container,{childList:true,subtree:true});
    schedule();
    return()=>{cancelAnimationFrame(frame);container.removeEventListener('scroll',schedule);resize.disconnect();mutation.disconnect();};
  },[entries,page,scrollRef]);
  useEffect(()=>{
    const container=rail.current,button=container?.querySelector<HTMLElement>('[aria-current="location"]');
    if(!container||!button)return;
    // Scroll only the index, never the conversation or outer application.
    if(button.offsetTop<container.scrollTop)container.scrollTop=button.offsetTop;
    else if(button.offsetTop+button.offsetHeight>container.scrollTop+container.clientHeight)container.scrollTop=button.offsetTop+button.offsetHeight-container.clientHeight;
  },[active]);
  const show=(id:string,button:HTMLButtonElement)=>{
    const bounds=nav.current!.getBoundingClientRect(),rect=button.getBoundingClientRect();
    setPreview({id,y:Math.max(64,Math.min(bounds.height-64,rect.top+rect.height/2-bounds.top))});
  };
  if(!entries.length)return null;
  const selected=entries.find(entry=>entry.id===preview?.id),selectedIndex=entries.findIndex(entry=>entry.id===preview?.id);
  return <nav className="conversation-index" ref={nav} aria-label="对话索引" onMouseLeave={()=>setPreview(null)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setPreview(null);}} onKeyDown={e=>{
    if(e.key==='Escape'){setPreview(null);e.stopPropagation();return;}
    const keys=['ArrowDown','ArrowUp','Home','End'];if(!keys.includes(e.key))return;
    e.preventDefault();const buttons=Array.from(rail.current!.querySelectorAll('button'));const i=buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,i+(e.key==='ArrowDown'?1:-1)));
    buttons[next]?.focus();
  }}>
    <div className="conversation-index-rail" ref={rail} onScroll={()=>{
      if(!preview)return;
      const button=rail.current?.querySelectorAll('button')[entries.findIndex(entry=>entry.id===preview.id)];
      if(!button)return;
      const bounds=rail.current!.getBoundingClientRect(),rect=button.getBoundingClientRect();
      if(rect.bottom<bounds.top||rect.top>bounds.bottom)setPreview(null);
      else show(preview.id,button);
    }}>
      {entries.map((entry,i)=><button type="button" key={entry.id} className={'conversation-index-tick '+(i%5===0?'major':'')} aria-label={'第 '+(i+1)+' 条：'+entry.title} aria-current={active===entry.id?'location':undefined} aria-describedby={preview?.id===entry.id?'conversation-index-preview':undefined} tabIndex={active===entry.id||!active&&i===0?0:-1} onMouseEnter={e=>show(entry.id,e.currentTarget)} onFocus={e=>show(entry.id,e.currentTarget)} onClick={()=>jump(entry)}><span/></button>)}
    </div>
    {selected&&preview&&<div id="conversation-index-preview" className="conversation-index-preview" role="tooltip" style={{top:preview.y}}>
      <small>{selectedIndex+1} / {entries.length} · 点击定位</small><strong>{selected.title}</strong><p>{selected.preview||'暂无回答'}</p>
    </div>}
  </nav>;
}
