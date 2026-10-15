// Injected into the selected tab's isolated world; X/Grok installs its DOM adapter first.
// Keeping the job here lets a closed/reopened toolbar popup reconnect to it.
export function collectPageHistory(options = {}) {
  try {
  const url = location.href;
  const address=new URL(url);
  const isGrok=(['x.com','www.x.com','twitter.com','www.twitter.com'].includes(address.hostname)&&/^\/i\/grok(?:\/|$)/.test(address.pathname))||(options.fixture&&options.platform==='grok');
  const isYouTube=(address.protocol==='https:'&&['www.youtube.com','youtube.com'].includes(address.hostname)&&address.pathname==='/watch'&&/^[a-zA-Z0-9_-]{11}$/.test(address.searchParams.get('v')||''))||(options.fixture&&options.platform==='youtube');
  const product=isYouTube?'YouTube 提问':isGrok?'Grok':'Gemini';
  const key=isYouTube?'__aiWorkbenchYouTubeHistoryV1':isGrok?'__aiWorkbenchGrokHistoryV1':'__aiWorkbenchGeminiHistoryV2';
  let job = window[key];
  const report = () => {
    if (!job || job.url !== location.href) return {phase:'idle'};
    return {phase:job.phase,count:job.records.length,characters:job.characters||0,repairs:job.repairs||0,scrolls:job.scrolls,
      progress:job.progress,result:job.result,error:job.error,code:job.code,diagnostics:job.diagnostics};
  };
  if (options.command === 'cancel') {
    if (job) job.cancelled = true;
    return report();
  }
  if (options.command !== 'start') return report();
  if (job?.phase === 'running' && job.url === url) return report();
  if (!(address.origin==='https://gemini.google.com' && /^\/(app|share)(\/|$)/.test(address.pathname)) && !(isGrok&&address.protocol==='https:') && !isYouTube && !options.fixture)
    throw new Error('请在 Gemini、X 内 Grok 或 YouTube 提问页面读取历史');
  const adapter=isYouTube?window.__aiWorkbenchYouTubeReaderV1:isGrok?window.__aiWorkbenchGrokReaderV1:null;
  if((isGrok||isYouTube)&&!adapter)throw new Error(product+' 读取器未准备好，请重新点击读取');
  const messageSelector='user-query, model-response, [data-message-author-role="user"], [data-message-author-role="assistant"]';
  const nodes = adapter?adapter.nodes:() => [...document.querySelectorAll(messageSelector)]
    .filter(node=>node.getClientRects().length&&!node.parentElement?.closest(messageSelector)&&!node.closest('deep-research-immersive-panel'));
  const cleanText=adapter?adapter.cleanText:node=>{
    const role=node.tagName.toLowerCase()==='user-query'||node.getAttribute('data-message-author-role')==='user'?'我':'Gemini';
    if(role==='我'){
      const lines=[...node.querySelectorAll('.query-text-line')];
      if(lines.length)return lines.map(line=>line.textContent||'').join('\n').trim();
    }
    const candidates=[...node.querySelectorAll('message-content, .markdown-main-panel, .markdown')];
    const body=candidates.find(el=>!el.closest('model-thoughts, .thoughts-container, .thoughts-content'))||node;
    const walk=el=>{
      if(el.nodeType===3)return el.textContent||'';
      if(el.nodeType!==1)return '';
      if(el.matches('button, [role="button"], model-thoughts, .thoughts-container, .thoughts-content, script, style, svg, .gv-export-msg-selector'))return '';
      const tag=el.tagName.toLowerCase();
      if(tag==='br')return '\n';
      if(tag==='pre')return '\n\n'+el.textContent+'\n\n';
      if(tag==='tr')return '\n'+[...el.children].map(cell=>walk(cell).trim()).join(' | ')+'\n';
      const text=[...el.childNodes].map(walk).join('');
      return ['p','div','li','section','h1','h2','h3','h4','blockquote'].includes(tag)?'\n'+text+'\n':text;
    };
    return walk(body).replace(/\n{3,}/g,'\n\n').trim();
  };
  const first = nodes()[0];
  if (!first) {const error=new Error('未识别到 '+product+' 的逐条消息结构，尚未开始历史扫描。');error.code='messages-not-found';throw error;}
  // The nearest scrolling ancestor of a message excludes the history sidebar.
  let scroller = isYouTube?adapter.scroller(first):first.parentElement;
  while (!isYouTube && scroller && !(scroller.clientHeight > 0 &&
    scroller.scrollHeight > scroller.clientHeight + 2 &&
    /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
  if(!isYouTube)scroller ||= document.scrollingElement;
  if (!scroller) throw new Error('没有找到对话滚动区域');
  const originalBottom = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
  const originalBehavior = scroller.style.scrollBehavior;
  scroller.style.scrollBehavior = 'auto';
  const settle = options.fixture ? (options.settleMs ?? 30) : 350;
  const boundaryWait = options.fixture ? (options.boundaryWaitMs ?? 200) : 12000;
  const duration = options.fixture ? (options.maxDurationMs ?? 15000) : (isYouTube?180000:900000);
  const started = Date.now();
  job = {url,phase:'running',records:[],scrolls:0,progress:'正在读取当前消息…',cancelled:false,warnings:new Set()};
  window[key] = job;
  const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
  const knownIds=new Map(),reusedIds=new Set();
  const normalize=text=>text.replace(/\s+/g,' ').trim();
  const hash=text=>{let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return (h>>>0).toString(36);};
  const read = () => nodes().map(node=>{
    const role=adapter?adapter.role(node):node.tagName.toLowerCase()==='user-query'||node.getAttribute('data-message-author-role')==='user'?'我':'Gemini';
    const container=node.closest('[data-message-id], [data-turn-id], .conversation-container[id]');
    const id=node.getAttribute('data-message-id')||node.getAttribute('data-turn-id')||(isYouTube?node.getAttribute('data-target-id'):null)||node.id||container?.getAttribute('data-message-id')||container?.getAttribute('data-turn-id')||container?.id||null;
    const text=cleanText(node),normalized=normalize(text),signature=role+':'+hash(normalized);
    const key=id?role+':'+id:null;
    if(key){
      const old=knownIds.get(key);
      if(old&&old!==normalized)reusedIds.add(key);
      knownIds.set(key,normalized);
    }
    return {role,text,normalized,signature,id:key};
  }).filter(item=>item.text);
  // IDs are only hints. Equal IDs with different content must never erase a turn.
  const equal=(a,b)=>a.role===b.role&&a.normalized===b.normalized;
  const merge=batch=>{
    if(!batch.length)return false;
    const records=job.records;
    if(!records.length){job.records=batch;job.characters=batch.reduce((sum,item)=>sum+item.text.length+12,0);return true;}
    const lookup=new Map();
    for(let i=0;i<records.length;i++){
      const key=records[i].signature;
      if(!lookup.has(key))lookup.set(key,[]);
      lookup.get(key).push(i);
    }
    const offsets=new Set();
    for(let j=0;j<batch.length;j++)for(const i of lookup.get(batch[j].signature)||[])offsets.add(i-j);
    let best=null,tied=false;
    for(const offset of offsets){
      const begin=Math.max(0,offset),end=Math.min(records.length,offset+batch.length);
      let valid=true,idMatches=0;
      for(let i=begin;i<end;i++){
        const a=records[i],b=batch[i-offset];
        if(!equal(a,b)){valid=false;break;}
        if(a.id&&a.id===b.id&&!reusedIds.has(a.id))idMatches++;
      }
      if(!valid)continue;
      const score=(end-begin)*1000+idMatches;
      if(!best||score>best.score){best={offset,score};tied=false;}
      else if(score===best.score)tied=true;
    }
    if(!best||tied)return false;
    const begin=Math.min(0,best.offset),end=Math.max(records.length,best.offset+batch.length),combined=[];
    for(let i=begin;i<end;i++)combined.push(batch[i-best.offset]||records[i]);
    const characters=combined.reduce((sum,item)=>sum+item.text.length+12,0);
    if(characters>10000000){job.limit=true;return true;}
    job.records=combined;job.characters=characters;
    return true;
  };
  const busy = () => scroller.getAttribute('aria-busy')==='true' || [...scroller.querySelectorAll('[aria-busy="true"], [role="progressbar"], mat-progress-spinner')]
    .some(node=>node.getClientRects().length);
  const check = () => {
    if(location.href!==url || !scroller.isConnected || (isYouTube&&(!adapter.panel()||!adapter.panel().contains(scroller))))throw new Error('对话页面已切换，请在目标对话中重新读取');
    if(job.cancelled)return 'cancelled';
    if(job.limit)return 'limit';
    if(Date.now()-started>=duration)return 'timeout';
    return null;
  };
  const sweep = async direction => {
    let quietSince=0,lastFingerprint='',lastHeight=0,stuckSince=0,stallRetries=0,lastGoodTop=scroller.scrollTop,retries=0,stepScale=1,pendingGapTop=null;
    while(true){
      const stopped=check();if(stopped)return stopped;
      const batch=read();
      if(!merge(batch)){
        pendingGapTop ??= scroller.scrollTop;
        if(++retries>4){job.warnings.add('存在未能补齐的消息缺口，已停止拼接，请核对原网页');return 'gap';}
        job.repairs=(job.repairs||0)+1;job.progress='发现消息衔接变化，正在退回补读 · 第 '+retries+' 次';
        const attempted=scroller.scrollTop;
        scroller.scrollTop=lastGoodTop;
        await delay(options.fixture?80:800);
        stepScale=Math.max(0.0625,stepScale/2);
        scroller.scrollTop=lastGoodTop+(attempted-lastGoodTop)*stepScale;
        await new Promise(resolve=>{const timer=setTimeout(resolve,2000);requestAnimationFrame(()=>{clearTimeout(timer);resolve();});});
        await delay(options.fixture?80:1200);
        continue;
      }
      if(pendingGapTop===null||(direction==='up'?scroller.scrollTop<=pendingGapTop:scroller.scrollTop>=pendingGapTop)){retries=0;pendingGapTop=null;}
      lastGoodTop=scroller.scrollTop;
      const fingerprint=batch.map(item=>item.signature).join('|');

      const atBoundary=direction==='up'?scroller.scrollTop<=2:
        scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-2;
      job.progress=(direction==='up'?'正在向上加载历史':'正在向下核对消息')+' · 已收集 '+job.records.length+' 条消息 / '+Math.round((job.characters||0)/1000)+' 千字符';
      if(atBoundary && fingerprint===lastFingerprint && scroller.scrollHeight===lastHeight && !busy()){
        quietSince ||= Date.now();
        if(Date.now()-quietSince>=boundaryWait)return 'boundary';
      }else quietSince=0;
      lastFingerprint=fingerprint;lastHeight=scroller.scrollHeight;
      const before=scroller.scrollTop,beforeHeight=scroller.scrollHeight;
      const step=Math.max(40,Math.floor(scroller.clientHeight*0.6*stepScale));
      scroller.scrollTop=direction==='up'?Math.max(0,before-step):Math.min(scroller.scrollHeight,before+step);
      job.scrolls++;
      // Wait for rendering before scrolling again, including throttled pages.
      const painted=await new Promise(resolve=>{
        const timer=setTimeout(()=>resolve(false),2000);
        requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve(true);}));
      });
      if(!painted)return 'background';
      const quietDeadline=Date.now()+(options.fixture?2000:12000);
      let lastSeen=read().map(item=>item.signature).join('|'),stableSince=Date.now();
      while(Date.now()<quietDeadline){
        await delay(options.fixture?settle:120);
        const signature=read().map(item=>item.signature).join('|');
        if(signature!==lastSeen){lastSeen=signature;stableSince=Date.now();}
        if(!busy()&&Date.now()-stableSince>=settle)break;
        if(check())break;
      }
      // Gemini can prepend history and compensate scrollTop back to its prior value.
      // A stable coordinate alone does not mean loading stopped.
      const contentChanged=read().map(item=>item.signature).join('|')!==fingerprint;
      const heightChanged=scroller.scrollHeight!==beforeHeight;
      const nowAtBoundary=direction==='up'?scroller.scrollTop<=2:
        scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-2;
      if(contentChanged||heightChanged){stuckSince=0;stallRetries=0;}
      else if(!nowAtBoundary && !busy() && Math.abs(scroller.scrollTop-before)<1){
        stuckSince ||= Date.now();
        if(Date.now()-stuckSince>=boundaryWait){
          if(stallRetries>=2)return 'stalled';
          stallRetries++;job.scrollRetries=(job.scrollRetries||0)+1;
          job.progress='页面暂时没有前进，正在重新触发滚动 · 第 '+stallRetries+' 次';
          // A small opposite movement allows scroll/visibility listeners to fire again.
          scroller.scrollTop=before+(direction==='up'?40:-40);
          await delay(options.fixture?80:800);
          stuckSince=0;
        }
      }else stuckSince=0;
    }
  };
  void (async()=>{
    try {
      merge(read(),'up');
      const up=await sweep('up');
      const down=up==='boundary'?await sweep('down'):null;
      const reachedBoth=up==='boundary' && down==='boundary';
      const reasons={boundary:'已检查当前页面边界',cancelled:'读取已停止',timeout:'读取超时',limit:'已达到 1000 万字符容量上限',
        background:'页面未刷新，请保持 '+product+' 标签页可见后重新读取',gap:'消息衔接未能确认，已停止拼接',
        stalled:'滚动重试后仍无进展，页面位置和消息内容均未变化'};
      const stopReason=reachedBoth?'boundary':down||up;
      if(!reachedBoth){
        const reason=down||up;
        job.warnings.add(reasons[reason]||'历史读取中断');
      }
      const content=job.records.map(item=>item.role+'：\n'+item.text).join('\n\n');
      if(!content)throw new Error('没有读到消息，请重试或选中文字保存');
      if(content.length>10000000)throw new Error('对话超过 1000 万字符容量');
      const unknown=job.records.filter(item=>item.role==='未识别发言者').length;
      if(unknown)job.warnings.add('部分发言者无法确认，已标记，请核对原网页');
      const warning=[...job.warnings].join('；');
      const questions=job.records.filter(item=>item.role==='我').length;
      const diagnostics={readerVersion:adapter?(adapter.version||'0.4.1'):'0.4.1',platform:isYouTube?'youtube-ask':isGrok?'grok-x':'gemini',count:job.records.length,questions,answers:job.records.length-questions-unknown,unknown,
        characters:content.length,characterLimit:10000000,stopReason,up,down,
        elapsedSeconds:Math.round((Date.now()-started)/1000),scrolls:job.scrolls,
        gapRetries:job.repairs||0,scrollRetries:job.scrollRetries||0,
        scrollTop:Math.round(scroller.scrollTop),scrollHeight:scroller.scrollHeight,clientHeight:scroller.clientHeight};
      const scope='本次读取共 '+job.records.length+' 条消息（提问 '+questions+' 条，回答 '+(job.records.length-questions-unknown)+' 条'+(unknown?'，待核对 '+unknown+' 条':'')+'），'+
        content.length.toLocaleString('zh-CN')+' / 10,000,000 字符；不叠加上次读取。'+
        (reachedBoth?'已滚动检查页面顶部和底部，仍请核对首尾消息。':'未完成历史读取，当前为部分记录。')+
        (warning?' 注意：'+warning+'。':'')+
        ' 页面未提供历史总数，无法自动保证完整。';
      job.result={captureId:Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join(''),title:(isYouTube?adapter.title():isGrok?(job.records.find(item=>item.role==='我')?.text.slice(0,80)||adapter.title()):document.title.replace(/\s*[-–—]\s*Google Gemini\s*$/i,'')).slice(0,150),
        content,url,product,scope,count:job.records.length,characters:content.length,repairs:job.repairs||0,reachedBoth,needsReview:true,diagnostics};
      job.phase='done';job.progress=scope;
    }catch(error){job.phase='error';job.error=error.message;}
    finally{
      if(location.href===url && scroller.isConnected)scroller.scrollTop=Math.max(0,scroller.scrollHeight-scroller.clientHeight-originalBottom);
      scroller.style.scrollBehavior=originalBehavior;
    }
  })();
  return report();
  }catch(error){
    // Return an object even when initialization fails, before an async job exists.
    const isGrok=/^(www\.)?(x\.com|twitter\.com)$/.test(location.hostname);
    const isYouTube=['www.youtube.com','youtube.com'].includes(location.hostname)||(options.fixture&&options.platform==='youtube');
    let diagnostics={readerVersion:'0.4.1',platform:isYouTube?'youtube-ask':isGrok?'grok-x':'gemini',stage:'start'};
    if(isYouTube){try{diagnostics={...diagnostics,...window.__aiWorkbenchYouTubeReaderV1?.diagnose?.()};}catch{}}
    if(isGrok){try{diagnostics={...diagnostics,...window.__aiWorkbenchGrokReaderV1?.diagnose?.()};}catch{}}
    const result={phase:'error',code:error.code||'reader-start-failed',
      error:error.message||'读取器启动失败',diagnostics};
    const key=isYouTube?'__aiWorkbenchYouTubeHistoryV1':isGrok?'__aiWorkbenchGrokHistoryV1':'__aiWorkbenchGeminiHistoryV2';
    window[key]={...result,url:location.href,records:[],scrolls:0};
    return result;
  }
}

// Compatibility for existing Gemini regression fixtures.
export {collectPageHistory as collectGeminiHistory};
