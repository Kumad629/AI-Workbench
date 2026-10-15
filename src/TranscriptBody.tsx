import {useMemo,useState,useEffect} from 'react';
import {Mark,MessageCopy} from './components';
import {transcriptTurns} from './transcript-format';
export function TranscriptBody({content,messageId}:{content:string;messageId?:string}) {
  const [raw,setRaw]=useState(false);
  useEffect(()=>{
    const root=messageId?document.getElementById('message-'+messageId):null;
    const reveal=()=>setRaw(false);root?.addEventListener('reveal-transcript',reveal);
    return()=>root?.removeEventListener('reveal-transcript',reveal);
  },[messageId]);
  const turns=useMemo(()=>transcriptTurns(content),[content]);
  return <div className="transcript">
    <div className="transcript-toolbar"><span>{turns.some(t=>t.role==='unknown')?'部分原文未标注发言者，保留原样显示':'按原文发言者标记排版'} · 选中表格收藏时保留整张表</span><button className="text-button" onClick={()=>setRaw(!raw)}>{raw?'返回阅读排版':'查看原始文本'}</button></div>
    {raw?<pre className="transcript-raw">{content}</pre>:<div className="transcript-turns">{turns.map((turn,i)=><section id={messageId?'transcript-'+messageId+'-'+i:undefined} className={'transcript-turn transcript-'+turn.role} key={i}>
      <div className="transcript-speaker">{turn.role==='user'?'你':turn.label}</div>
      <Mark repairTables sourceOffset={turn.start}>{turn.content}</Mark><MessageCopy content={turn.content}/>
    </section>)}</div>}
  </div>;
}
