export type Turn = {role:'user'|'assistant'|'unknown';label:string;content:string;start:number};
const fence = /^\s{0,3}(`{3,}|~{3,})/;
function advanceFence(line:string,current:string) {
  const match=line.match(fence);
  if(!match)return current;
  if(!current)return match[1];
  return match[1][0]===current[0]&&match[1].length>=current.length&&!line.slice(match[0].length).trim()?'':current;
}
function lines(text:string) {
  let start=0;
  return text.split('\n').map(value=>{const line={value,start,end:start+value.length};start=line.end+1;return line;});
}
// Presentation only: raw archive content remains the source of truth.
export function transcriptTurns(text:string):Turn[] {
  const markers:{start:number;end:number;label:string}[]=[];
  let delimiter='';
  for(const line of lines(text)){
    const previous=delimiter;delimiter=advanceFence(line.value,delimiter);
    if(previous||delimiter)continue;
    const m=line.value.match(/^(我|你|用户|User|Human|Grok|Gemini|YouTube|ChatGPT|DeepSeek|Claude|助手|Assistant|未识别发言者)[：:]\s*$/i);
    if(m)markers.push({start:line.start,end:line.end+1,label:m[1]});
  }
  const turns:Turn[]=[];
  const add=(start:number,end:number,label:string)=>{
    const raw=text.slice(start,end),content=raw.trim();
    if(content)turns.push({role:/^(我|你|用户|user|human)$/i.test(label)?'user':!label||label==='未识别发言者'?'unknown':'assistant',
      label:label||'原文',content,start:start+raw.length-raw.trimStart().length});
  };
  if(!markers.length)add(0,text.length,'');
  else{
    add(0,markers[0].start,'');
    markers.forEach((m,i)=>add(m.end,markers[i+1]?.start??text.length,m.label));
  }
  return turns;
}
function cells(line:string):string[]|null {
  if(/^\s{4}|^\t/.test(line))return null;
  const parts:string[]=[];let part='',ticks=0;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='\\'&&i+1<line.length){part+=c+line[++i];continue;}
    if(c==='`'){let n=1;while(line[i+1]==='`'){n++;i++;}ticks=ticks===n?0:ticks||n;part+='`'.repeat(n);continue;}
    if(c==='|'&&!ticks){parts.push(part.trim());part='';}else part+=c;
  }
  parts.push(part.trim());
  if(parts[0]==='')parts.shift();
  if(parts.at(-1)==='')parts.pop();
  return parts.length>=3?parts:null;
}
type Change={start:number;end:number;replacement:string;outStart:number;outEnd:number};
export function formatArchiveMarkdown(text:string,repairTables=true) {
  const changes:Change[]=[];
  if(repairTables){
    const all=lines(text);let delimiter='';
    for(let i=0;i<all.length;i++){
      const previous=delimiter;delimiter=advanceFence(all[i].value,delimiter);
      if(previous||delimiter)continue;
      const head=cells(all[i].value);
      if(!head||head.some(c=>!c||/^:?-+:?$/.test(c)))continue;
      const next=cells(all[i+1]?.value||'');
      // Leave an already valid GFM table, including every body row, untouched.
      if(next?.length===head.length&&next.every(c=>/^:?-{3,}:?$/.test(c))){
        i++;while(i+1<all.length&&cells(all[i+1].value)?.length===head.length)i++;continue;
      }
      const rows=[head];let last=i,j=i+1;
      while(j<all.length){
        if(!all[j].value.trim()){j++;continue;}
        const row=cells(all[j].value);
        if(!row||row.length!==head.length||row.every(c=>/^:?-+:?$/.test(c)))break;
        rows.push(row);last=j++;
      }
      if(rows.length<3)continue;
      const formatted=[rows[0],head.map(()=>'---'),...rows.slice(1)].map(row=>'| '+row.join(' | ')+' |').join('\n');
      changes.push({start:all[i].start,end:all[last].end,replacement:formatted,outStart:0,outEnd:0});
      i=last;
    }
  }
  let markdown='',cursor=0;
  for(const change of changes){
    markdown+=text.slice(cursor,change.start);change.outStart=markdown.length;
    markdown+=change.replacement;change.outEnd=markdown.length;cursor=change.end;
  }
  markdown+=text.slice(cursor);
  const sourceOffset=(offset:number,end=false)=>{
    let delta=0;
    for(const c of changes){
      if(offset<c.outStart)break;
      if(offset<c.outEnd)return end?c.end:c.start;
      delta+=(c.outEnd-c.outStart)-(c.end-c.start);
    }
    return offset-delta;
  };
  return {markdown,sourceOffset};
}
