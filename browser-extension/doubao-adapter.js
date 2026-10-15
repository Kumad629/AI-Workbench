// Public DOM adapter for Doubao. No cookies, tokens, page internals or private APIs.
// Selector evidence and verification limits are recorded in DOUBAO_ADAPTER_NOTES.zh-CN.md.
export async function doubaoCommand(input){
 const key='__awbDoubaoChatV1';
 const url=()=>{const u=new URL(location.href);u.hash='';return u.href;};
 const official=()=>location.protocol==='https:'&&['www.doubao.com','doubao.com'].includes(location.hostname)&&!location.port&&/^\/chat(?:\/|$)/.test(location.pathname);
 const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
 const one=s=>[...document.querySelectorAll(s)].find(visible);
 const normalize=s=>String(s||'').replace(/\s+/g,' ').trim();
 const text=e=>e?.value??e?.innerText??'';
 const rowSelector='[data-testid="send_message"],[data-testid="receive_message"],[class*="bg-g-send-msg-bubble"],[class*="bg-g-receive-msg-bubble"]';
 const role=e=>e.matches('[data-testid="send_message"],[class*="bg-g-send-msg-bubble"]')?'user':'assistant';
 const rows=()=>{
  const all=[...document.querySelectorAll(rowSelector)].filter(visible);
  return all.filter(e=>!all.some(parent=>parent!==e&&parent.contains(e)&&role(parent)===role(e)));
 };
 const identities=window.__awbDoubaoRowIdsV1||=(new WeakMap());
 let identityCounter=window.__awbDoubaoRowCounterV1||0;
 const identity=e=>{
  const owner=e.closest('[data-message-id],[data-msg-id]');
  const id=owner?.getAttribute('data-message-id')||owner?.getAttribute('data-msg-id');
  if(id)return role(e)+':'+id;
  if(!identities.has(e)){identities.set(e,++identityCounter);window.__awbDoubaoRowCounterV1=identityCounter;}
  return role(e)+':node-'+identities.get(e);
 };
 const editorSelector='textarea[data-testid="chat_input_input"],[data-testid="chat_input_input"] textarea,[data-testid="chat_input_input"][contenteditable="true"],[data-testid="chat_input_input"] [contenteditable="true"]';
 const editors=()=>[...document.querySelectorAll(editorSelector)].filter(e=>visible(e)&&!e.disabled&&!e.readOnly&&e.getAttribute('aria-disabled')!=='true');
 const editor=()=>editors().length===1?editors()[0]:null;
 const composerInfo=()=>{
  const e=editor(),trace=[];let scope=null,explicit=false,boundary='no-editor';
  for(let node=e?.parentElement,depth=0;node&&depth<16;node=node.parentElement,depth++){
   if(node.matches('main,body,html')||node.querySelector(rowSelector)){boundary='history-or-page';break;}
   if(editors().filter(input=>node.contains(input)).length!==1){boundary='multiple-editors';break;}
   scope=node;
   trace.push({depth:depth+1,tag:node.tagName.toLowerCase(),buttons:node.querySelectorAll('button,[role="button"]').length,sendClasses:node.querySelectorAll('[class*="send-btn-"]').length});
   if(node.matches('[data-testid="chat_input"],.chat-input,.chat-editor,form,[role="form"]')){explicit=true;boundary='composer';break;}
   boundary='depth-limit';
  }
  return {scope,explicit,trace,boundary};
 };
 const sendInfo=()=>{
  const composer=composerInfo(),matches=new Map();
  const add=(node,kind)=>{
   const target=node.closest('button,[role="button"]')||node;
   if(!visible(target)||target.closest(rowSelector)||target.closest('[role="dialog"],.semi-modal-content'))return;
   if(!matches.has(target))matches.set(target,new Set());
   matches.get(target).add(kind);
  };
  for(const [selector,kind] of [['[data-testid="chat_input_send_button"]','testid'],['#flow-end-msg-send','flow-id']]){
   document.querySelectorAll(selector).forEach(node=>add(node,kind));
  }
  const controls=composer.scope?[...composer.scope.querySelectorAll('button,[role="button"],[class*="send-btn-"]')]:[];
  // A custom div can be the send control. Require an explicit send class or label,
  // not merely the position, colour, an arrow, or the first button in the area.
  if(!matches.size)for(const control of controls){
   if(control.matches('[class*="send-btn-"]')){add(control,'composer-send-class');continue;}
   const labels=[control.getAttribute('aria-label'),control.getAttribute('title'),control.innerText];
   if(labels.some(label=>/^(发送|发送消息|发送问题|Send|Send message|Send prompt)$/i.test(normalize(label))))add(control,'composer-label');
  }
  return {candidates:[...matches.keys()],kinds:[...new Set([...matches.values()].flatMap(kinds=>[...kinds]))],scope:!!composer.scope,explicit:composer.explicit,trace:composer.trace,boundary:composer.boundary,controls:controls.filter(visible).length};
 };
 const button=()=>{const candidates=sendInfo().candidates;return candidates.length===1?candidates[0]:null;};
 const stopSelector='[data-testid="chat_input_stop_button"],[data-testid="chat_input_stop_generate_button"],button[aria-label="停止生成"],button[aria-label="停止回答"],button[title="停止生成"]';
 const stopping=()=>!!one(stopSelector)||rows().some(e=>e.getAttribute('data-is-streaming')==='true'||e.getAttribute('data-generating')==='true');
 const disabled=e=>!visible(e)||e.disabled||e.hasAttribute('disabled')||e.getAttribute('aria-disabled')==='true'||/(?:^|[-_ ])disabled(?:$|[-_ ])/.test(e.className||'');
 const markdownSelector='.flow-markdown-body,.md-box-root,[data-testid="message_text_content"],[data-testid="message_content"],[class*="markdown-body"]';
 const blocks=row=>{
  const found=[...row.querySelectorAll(markdownSelector)].filter(visible);
  return found.length?found.filter(e=>!found.some(parent=>parent!==e&&parent.contains(e))):[row];
 };
 const contentOf=row=>blocks(row).map(markdown).join('\n\n').replace(/\n{3,}/g,'\n\n').trim();
 const promptOf=row=>normalize(text(row.querySelector('[data-testid="message_text_content"],[data-testid="message_content"]')||row));

 // Structural evidence only: never include text, HTML, URLs, arbitrary attributes or image data.
 const extractionAudit=all=>{
  const marks=e=>({
   userTestId:e.matches('[data-testid="send_message"]'),
   assistantTestId:e.matches('[data-testid="receive_message"]'),
   userBubble:e.matches('[class*="bg-g-send-msg-bubble"]'),
   assistantBubble:e.matches('[class*="bg-g-receive-msg-bubble"]')
  });
  const size=e=>({tag:e.tagName.toLowerCase(),visibleCharacters:normalize(text(e)).length,textCharacters:normalize(e.textContent).length});
  return {scope:'latest-loaded-window',totalRows:all.length,truncated:all.length>20,
   rows:all.slice(0,20).map((row,index)=>{
    const chosen=blocks(row),ancestors=[];
    for(let p=row.parentElement,depth=1;p&&depth<=3&&!p.matches('body,html');p=p.parentElement,depth++){
     const descendants=[...p.querySelectorAll(rowSelector)];
     ancestors.push({...size(p),depth,userCandidates:descendants.filter(e=>role(e)==='user').length,assistantCandidates:descendants.filter(e=>role(e)==='assistant').length});
     if(descendants.length>4)break;
    }
    return {index,role:role(row),...size(row),markers:marks(row),
     extractedCharacters:contentOf(row).length,promptCharacters:promptOf(row).length,
     imageCount:row.querySelectorAll('img').length,controlCount:row.querySelectorAll('button,[role="button"]').length,
     selectedBlockCount:chosen.length,selectedBlocks:chosen.slice(0,6).map(e=>({...size(e),isRow:e===row,
      explicitText:e.matches('[data-testid="message_text_content"],[data-testid="message_content"]'),
      markdown:e.matches('.flow-markdown-body,.md-box-root,[class*="markdown-body"]')})),
     ancestors};
   })};
 };
 const dialog=()=>one('[role="dialog"],.semi-modal-content');
 const probe=()=>{
  const e=editor(),all=rows(),send=sendInfo();const pending=!!e&&!send.candidates.length&&!normalize(text(e));const ownImages=input.command==='begin'&&input.job?.images?.length&&window.__awbImageUploadV1?.id===input.job.id&&window.__awbImageUploadV1.ready&&window.__awbImageUploadV1.url===url();let reason='';
  if(!official())reason='请打开豆包官方聊天网页';
  else if(dialog())reason='请先在豆包网页完成登录或关闭弹窗';
  else if(editors().length>1)reason='发现多个豆包输入框，请关闭额外编辑面板后重试';
  else if(!e)reason='未识别到豆包输入框，请复制连接诊断';
  else if(send.candidates.length>1)reason='发现多个豆包发送按钮，请关闭额外编辑面板后重试';
  else if(!button()&&!stopping()&&!pending)reason='已找到输入框，但未识别到豆包发送按钮，请复制连接诊断';
  else if(!ownImages&&([...document.querySelectorAll('input[type="file"]')].some(n=>n.files?.length)||one('[data-testid="chat_input_attachment"],[data-testid="chat_input_file"],[data-testid="chat_input_image"]')))reason='豆包输入区有待发送附件，请先处理附件';
  else if(stopping())reason='豆包正在生成，请等待网页回答结束';
  else if(normalize(text(e)))reason='豆包输入框有未发送草稿，请先处理草稿';
  return {url:url(),ready:!reason,reason,note:!reason&&pending?'已连接输入区；发送问题时会等待并检查发送按钮。':'',diagnostics:{version:'0.9.12',extraction:window.__awbDoubaoExtractionAuditV1?.url===url()?window.__awbDoubaoExtractionAuditV1.audit:null,imageUpload:window.__awbImageUploadV1?.diagnostics||null,platform:'doubao',ready:!reason,reason,readyState:document.readyState,editor:!!e,editorCandidates:editors().length,sendButton:!!button(),sendButtonVisible:visible(button()),sendButtonDisabled:button()?!!disabled(button()):null,sendButtonCandidates:send.candidates.length,sendButtonMatches:send.kinds,composerFound:send.scope,composerButtons:send.controls,composerExplicit:send.explicit,composerBoundary:send.boundary,composerAncestors:send.trace,sendButtonPending:pending,stopButton:!!one(stopSelector),rows:all.length,humanRows:all.filter(e=>role(e)==='user').length,aiRows:all.filter(e=>role(e)==='assistant').length,markdownBlocks:document.querySelectorAll(markdownSelector).length,iframes:document.querySelectorAll('iframe').length}};
 };
  let imageCollector=null;
  const imageCacheKey='__awbDoubaoHistoryImagesV1';
  if(window[imageCacheKey]?.url!==url())window[imageCacheKey]={url:url(),items:new Map(),bytes:0};
  const imageCache=window[imageCacheKey];
  function captureImage(node){
    if(!imageCollector)return;
    const index=imageCollector.index++,name='历史图片 '+(index+1);
    let src=node.currentSrc||node.getAttribute('src')||'';
    if(!src)return;
    try{src=new URL(src,location.href).href;}catch{return;}
    let saved=imageCache.items.get(src);
    if(!saved&&node.complete&&node.naturalWidth&&node.naturalHeight){
      try{
        const canvas=document.createElement('canvas'),scale=Math.min(1,2400/Math.max(node.naturalWidth,node.naturalHeight));
        canvas.width=Math.max(1,Math.round(node.naturalWidth*scale));canvas.height=Math.max(1,Math.round(node.naturalHeight*scale));
        const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(node,0,0,canvas.width,canvas.height);
        const data=canvas.toDataURL('image/jpeg',0.85);
        if(data.length<=512000&&imageCache.bytes+data.length<=8000000){saved=data;imageCache.items.set(src,data);imageCache.bytes+=data.length;}
      }catch{} // Cross-origin canvases may be unreadable; retain the public image URL.
    }
    const source=saved||src;
    if(imageCollector.items.length<20&&(source.startsWith('https://')||!!saved))
      imageCollector.items.push({index,name,src:source,remoteSrc:src.startsWith('https://')?src:undefined});
  }
  function imagePayload(messages){
    let bytes=0;
    return messages.map(message=>{
      if(!message.historyImages?.length)return message;
      const historyImages=[];
      for(const image of message.historyImages){
        let src=image.src;
        if(src.length>512000||bytes+src.length>8000000)src=image.remoteSrc;
        if(!src||src.length>512000||bytes+src.length>8000000)continue;
        if(src.startsWith('https://')&&src.length>16000)continue;
        bytes+=src.length;historyImages.push({index:image.index,name:image.name,src});
      }
      return {...message,historyImages};
    });
  }
  function markdown(node){
    if(node.nodeType===Node.TEXT_NODE)return node.textContent.replace(/([\\`*_[\]<>])/g,'\\$1');
    if(node.nodeType!==Node.ELEMENT_NODE)return '';
    const tag=node.tagName.toLowerCase();
    if(['button','script','style','svg'].includes(tag)||node.matches('[aria-hidden="true"],[hidden],[class*="debug-copy"],[class*="reading-btn"]'))return '';
    const children=()=>[...node.childNodes].map(markdown).join('');
    if(tag==='pre'){
      const c=node.querySelector('code')||node,body=c.textContent;
      const fence='`'.repeat(Math.max(3,...[...body.matchAll(/`+/g)].map(m=>m[0].length+1)));
      const lang=(c.className.match(/language-([\w-]+)/)||[])[1]||'';
      return '\n\n'+fence+lang+'\n'+body.replace(/\n$/,'')+'\n'+fence+'\n\n';
    }
    if(tag==='table'){
      const matrix=[...node.rows].map(r=>[...r.cells].map(c=>markdown(c).trim().replace(/\n+/g,'<br>').replace(/\|/g,'\\|')));
      if(!matrix.length)return '';
      const n=Math.max(...matrix.map(r=>r.length)),line=r=>'| '+Array.from({length:n},(_,i)=>r[i]||'').join(' | ')+' |';
      return '\n\n'+[line(matrix[0]),line(Array(n).fill('---')),...matrix.slice(1).map(line)].join('\n')+'\n\n';
    }
    if(tag==='img'){captureImage(node);return node.getAttribute('alt')?'[图片：'+node.getAttribute('alt')+']':'[图片]';}
    if(tag==='a'){try{const u=new URL(node.getAttribute('href'),location.href);if(['https:','http:'].includes(u.protocol))return '['+children()+']('+u.href.replace(/\(/g,'%28').replace(/\)/g,'%29')+')';}catch{}return children();}
    if(tag==='code')return '`'+node.textContent.replace(/`/g,'\\`')+'`';
    if(tag==='br')return '\n';
    if(/^h[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+children()+'\n\n';
    if(tag==='strong'||tag==='b')return '**'+children()+'**';
    if(tag==='em'||tag==='i')return '*'+children()+'*';
    if(tag==='li')return '\n- '+children().trim();
    if(['p','div','ul','ol','blockquote'].includes(tag))return '\n\n'+children()+'\n\n';
    return children();
  }
  if(input.command.startsWith('history-scan')){
    const scanKey='__awbDoubaoHistoryScanV1';
    let scan=window[scanKey];
    const restore=()=>{if(scan?.scroller?.isConnected){scan.scroller.style.scrollBehavior='auto';const max=scan.scroller.scrollHeight-scan.scroller.clientHeight;scan.scroller.scrollTop=scan.reverse?-scan.bottom:Math.max(0,max-scan.bottom);scan.scroller.style.scrollBehavior=scan.behavior;}};
    const report=()=>({url:scan?.url||url(),phase:scan?.phase||'idle',count:scan?.records.length||0,characters:scan?.characters||0,scrolls:scan?.scrolls||0,direction:scan?.direction||'up',reason:scan?.reason||'',error:scan?.error,alignment:scan?.alignment||null,scroll:scan?.scroll||null, ...(scan?.phase==='complete'?{messages:imagePayload(scan.records),scan:{reason:scan.reason,scrolls:scan.scrolls,topChecked:scan.topChecked,complete:false}}:{})});
    const stop=(phase,reason,error)=>{scan.phase=phase;scan.reason=reason;scan.error=error;if(phase!=='failed')restore();if(scan.scroller?.isConnected){scan.scroller.style.scrollBehavior=scan.behavior;scan.scroller.style.overflowAnchor=scan.overflowAnchor;}return report();};
    if(input.command==='history-scan-cancel'){if(scan&&scan.id===input.requestId)return stop('cancelled','cancelled');return {phase:'idle'};}
    if(scan?.id===input.requestId&&scan.phase!=='running')return report();
    if(!scan||scan.id!==input.requestId){
      if(input.command!=='history-scan-start')return {phase:'failed',url:url(),error:'扫描状态已丢失，请重新开始'};
      if(scan?.phase==='running'){restore();scan.scroller.style.overflowAnchor=scan.overflowAnchor;}
      const loaded=rows(),first=loaded[0];
      const usable=node=>node&&node.clientHeight>0&&node.scrollHeight>node.clientHeight+2&&
        /auto|scroll/.test(getComputedStyle(node).overflowY)&&loaded.filter(row=>node.contains(row)).length>=Math.min(2,loaded.length);
      const virtual=first?.closest('[class*="v_list_scroller"]');
      let scroller=usable(virtual)?virtual:first?.parentElement;
      // Avoid a scrollable answer/code block: the conversation region must own
      // multiple separate messages whenever multiple messages are loaded.
      while(scroller&&!usable(scroller))scroller=scroller.parentElement;
      scroller||=document.scrollingElement;
      if(!scroller)return {phase:'failed',url:url(),error:'没有找到对话滚动区域'};
      const reverse=getComputedStyle(scroller).flexDirection==='column-reverse',max=scroller.scrollHeight-scroller.clientHeight;
      scan=window[scanKey]={id:input.requestId,url:input.url,phase:'running',records:[],characters:0,scrolls:0,direction:'up',started:Date.now(),boundarySince:0,lastBoundary:'',topChecked:false,scroller,reverse,bottom:reverse?-scroller.scrollTop:max-scroller.scrollTop,behavior:scroller.style.scrollBehavior,overflowAnchor:scroller.style.overflowAnchor};
      scroller.style.scrollBehavior='auto';scroller.style.overflowAnchor='none';
    }
    if(url()!==scan.url)return stop('failed','navigation','豆包会话已切换，扫描已停止，本地记录未修改');
    if(Date.now()-scan.started>900000)return stop('complete','time-limit');
    if(!scan.scroller.isConnected)return stop('failed','scroller-lost','网页滚动区域已变化，请重新扫描');
    const measuredTop=scan.scroller.scrollTop,measuredMax=Math.max(0,scan.scroller.scrollHeight-scan.scroller.clientHeight);
    const prior=scan.scroll;
    scan.scroll={tag:scan.scroller.tagName.toLowerCase(),container:scan.scroller.matches('[class*="v_list_scroller"]')?'doubao-virtual-list':scan.scroller===document.scrollingElement?'document':'ancestor',observedTop:Math.round(measuredTop),max:Math.round(measuredMax),
      viewport:scan.scroller.clientHeight,reverse:scan.reverse,
      movedReads:(prior?.movedReads||0)+(prior&&Math.abs(prior.observedTop-measuredTop)>2?1:0),
      requestedTop:prior?.requestedTop??null,appliedTop:prior?.appliedTop??null,
      messageRows:rows().filter(row=>scan.scroller.contains(row)).length,
      noAdvanceMs:scan.progressAt==null?0:Date.now()-scan.progressAt,
      recoveries:prior?.recoveries||0,largeRebounds:prior?.largeRebounds||0,lastReturn:prior?.lastReturn||null,
      wheelSignals:prior?.wheelSignals||0,wheelPrevented:prior?.wheelPrevented||0,trace:prior?.trace||[]};
    const capture=await doubaoCommand({command:'history',url:scan.url,scanning:true});
    if(capture.error){
      if(/超过|容量/.test(capture.error))return scan.records.length?stop('complete','capacity'):stop('failed','capacity',capture.error);
      if(stopping()||dialog())return stop('failed','page-not-ready',capture.error);
      scan.readFailureSince||=Date.now();
      if(Date.now()-scan.readFailureSince>12000)return stop('failed','read-failed',capture.error);
      return report();
    }
    scan.readFailureSince=0;
    const batch=capture.messages,records=scan.records;
    if(!batch.length&&records.length){scan.emptySince||=Date.now();if(Date.now()-scan.emptySince>12000)return stop('failed','empty-page','滚动后消息持续为空，请重新加载网页后重试');return report();}scan.emptySince=0;
    const equal=(a,b)=>a.role===b.role&&a.content===b.content;
    const imageOnly=m=>m.role==='user'&&/^(?:\s*\[图片(?:：[^\]\r\n]*)?\]\s*)+$/.test(m.content);
    const counts=messages=>{
      const result=new Map();for(const m of messages)if(m.role==='user')result.set(m.content,(result.get(m.content)||0)+1);return result;
    };
    const recordQuestions=counts(records),batchQuestions=counts(batch);
    const uniqueQuestionMatches=batch.flatMap((m,batchIndex)=>
      m.role==='user'&&!imageOnly(m)&&batchQuestions.get(m.content)===1&&recordQuestions.get(m.content)===1
        ?[{batchIndex,recordIndex:records.findIndex(old=>equal(old,m))}]:[]);
    // A short edge match cannot override a known unique question elsewhere in
    // either window. Otherwise rotated windows can duplicate entire turns.
    const consistent=offset=>uniqueQuestionMatches.every(m=>m.recordIndex-m.batchIndex===offset);
    // Window matching is positional. Never deduplicate repeated prompts or use
    // image placeholders as evidence of the identity of an actual image.
    const alignments=byQuestions=>{
      const candidates=[];
      for(let offset=-(batch.length-1);offset<records.length;offset++){
        if(!consistent(offset))continue;
        const start=Math.max(0,offset),end=Math.min(records.length,offset+batch.length);
        if(end-start<Math.min(2,records.length,batch.length))continue;
        let ok=true,anchors=0,differences=0;
        for(let i=start;i<end;i++){
          const old=records[i],fresh=batch[i-offset];
          if(old.role!==fresh.role||(!equal(old,fresh)&&(!byQuestions||old.role==='user'))){ok=false;break;}
          if(!equal(old,fresh))differences++;
          if(old.role==='user'&&!imageOnly(old)&&recordQuestions.get(old.content)===1&&batchQuestions.get(old.content)===1&&
            i+1<end&&records[i+1].role==='assistant'&&batch[i+1-offset].role==='assistant')anchors++;
        }
        if(ok&&(!byQuestions||anchors>=2))candidates.push({offset,overlap:end-start,anchors,differences});
      }
      const max=Math.max(0,...candidates.map(c=>c.overlap));return candidates.filter(c=>c.overlap===max);
    };
    // Some virtual lists leave the last reply mounted while removing middle
    // turns. A sparse read may confirm existing rows, but must never delete those
    // omitted turns or insert unseen messages inside them.
    const sparseAlignment=()=>{
      const follow=(start,from)=>{
        const positions=[];
        for(let j=start;j<batch.length;j++){
          const i=records.findIndex((m,index)=>index>=from&&equal(m,batch[j]));
          if(i<0)return null;positions.push(i);from=i+1;
        }
        return positions;
      };
      const anchors=positions=>{
        let run=0,best=0;
        for(let j=0;j<positions.length;j++){
          if(j&&positions[j]!==positions[j-1]+1)run=0;
          const m=batch[j];
          if(m.role==='user'&&!imageOnly(m)&&recordQuestions.get(m.content)===1&&batchQuestions.get(m.content)===1&&
            positions[j+1]===positions[j]+1&&batch[j+1]?.role==='assistant')run++;
          best=Math.max(best,run);
        }
        return best;
      };
      const describe=(positions,prefix,anchorCount)=>({prefix,positions,anchors:anchorCount,
        retainedHiddenMessages:positions.at(-1)-positions[0]+1-positions.length});
      const known=follow(0,0);
      if(known&&anchors(known)>=2)return describe(known,0,anchors(known));
      const candidates=[];
      for(let prefix=1;prefix<batch.length;prefix++){
        if(!equal(records[0],batch[prefix]))continue;
        const added=batch.slice(0,prefix);
        // Novel rows may only precede the first captured row. A known text row
        // there indicates reordering rather than newly loaded older history.
        // A virtual window may start halfway through an older turn. Its leading
        // answer remains in its original position; never invent its missing question.
        // The new prefix can be only an answer: its question may not be mounted
        // yet. Its position is established by the following unique full turns,
        // not by requiring a new question in the prefix itself. Image placeholders
        // alone still cannot establish that any new message has appeared.
        if(!added.some(m=>!imageOnly(m))||
          added.some(m=>!imageOnly(m)&&records.some(old=>equal(old,m))))continue;
        let length=0,anchorCount=0;
        while(length<records.length&&prefix+length<batch.length&&equal(records[length],batch[prefix+length]))length++;
        for(let i=0;i+1<length;i++){
          const m=records[i];
          if(m.role==='user'&&!imageOnly(m)&&recordQuestions.get(m.content)===1&&batchQuestions.get(m.content)===1&&records[i+1].role==='assistant')anchorCount++;
        }
        if(anchorCount<2)continue;
        const suffix=follow(prefix+length,length);if(!suffix)continue;
        const positions=[...Array.from({length},(_,i)=>i),...suffix];
        candidates.push(describe(positions,prefix,anchorCount));
      }
      return candidates.length===1?candidates[0]:null;
    };
    let merged;
    if(!records.length)merged=batch;
    else{
      const exact=alignments(false);let chosen=exact.length===1?exact[0]:null;
      if(!chosen){
        // Lazy loading can temporarily replace/unmount a window. Freeze scrolling
        // and reread it before considering a stable, uniquely ordered question match.
        const now=Date.now(),signature=JSON.stringify(batch.map(({role,content})=>({role,content})));
        scan.alignmentSince??=now;
        if(scan.pendingWindow!==signature){scan.pendingWindow=signature;scan.stableSince=now;scan.stableReads=0;}
        scan.stableReads++;
        const questions=alignments(true),sparse=sparseAlignment();
        const stableWindow=signature===scan.lastAcceptedWindow||(scan.stableReads>=2&&now-scan.stableSince>=2000);
        scan.alignment={method:'waiting',recordMessages:records.length,batchMessages:batch.length,
          exactCandidates:exact.length,questionCandidates:questions.length,sparseCandidate:!!sparse,
          uniqueQuestionMatches:uniqueQuestionMatches.slice(0,50),uniqueQuestionMatchesTruncated:uniqueQuestionMatches.length>50,
          matchingQuestions:[...batchQuestions.keys()].filter(q=>recordQuestions.has(q)).length,
          stableReads:scan.stableReads,waitMs:now-scan.alignmentSince,
          batchOutline:batch.slice(0,50).map((m,index)=>({index,role:m.role,characters:m.content.length,imageOnly:imageOnly(m),
            matchingRecordIndexes:records.flatMap((old,i)=>equal(old,m)?[i]:[]).slice(0,50)})),
          recordOutline:records.slice(0,50).map((m,index)=>({index,role:m.role,characters:m.content.length,imageOnly:imageOnly(m)})),
          matchingTextQuestions:[...batchQuestions.keys()].filter(q=>recordQuestions.has(q)&&!imageOnly({role:'user',content:q})).length,
          recordOutlineTruncated:records.length>50,outlineTruncated:batch.length>50};
        if(questions.length===1&&stableWindow){
          chosen=questions[0];
          scan.alignment={...scan.alignment,method:'questions',anchors:chosen.anchors,retainedDifferences:chosen.differences};
        }else if(sparse&&stableWindow){
          chosen={sparse};
          scan.alignment={...scan.alignment,method:'sparse-window',anchors:sparse.anchors,
            prepended:sparse.prefix,retainedHiddenMessages:sparse.retainedHiddenMessages,
            matchedRecordIndexes:sparse.positions.slice(0,50),matchedRecordIndexesTruncated:sparse.positions.length>50};
        }else{
          scan.boundarySince=0;scan.lastBoundary='';
          if(now-scan.alignmentSince>=12000)return stop('failed','ambiguous','等待重读后，滚动前后的消息仍无法可靠衔接，已停止；本地记录保持不变，请复制连接诊断');
          return report();
        }
      }else if(scan.alignmentSince!=null){
        scan.alignment={method:'exact-after-retry',recordMessages:records.length,batchMessages:batch.length,waitMs:Date.now()-scan.alignmentSince};
      }
      delete scan.alignmentSince;delete scan.pendingWindow;delete scan.stableSince;delete scan.stableReads;
      if(chosen.sparse){
        const updates=new Map(chosen.sparse.positions.map((position,j)=>[position,batch[j+chosen.sparse.prefix]]));
        merged=[...batch.slice(0,chosen.sparse.prefix),...records.map((old,i)=>{
          const fresh=updates.get(i);return fresh?.historyImages?.length&&equal(old,fresh)?{...old,historyImages:fresh.historyImages}:old;
        })];
      }
      else{
      const offset=chosen.offset;merged=[];
      // Keep the already captured version of overlapping answers. Only prepend or
      // append rows outside the verified overlap; do not guess at missing rows.
      for(let i=Math.min(0,offset);i<Math.max(records.length,offset+batch.length);i++)merged.push(i>=0&&i<records.length?(equal(records[i],batch[i-offset]||{})&&batch[i-offset]?.historyImages?.length?{...records[i],historyImages:batch[i-offset].historyImages}:records[i]):batch[i-offset]);
      }
    }
    const characters=merged.reduce((n,m)=>n+m.content.length,0);
    if(merged.length>1000||characters>400000){
      if(!records.length)return stop('failed','capacity','历史超过本次容量，未保存');
      return stop('complete','capacity');
    }
    const grew=merged.length>records.length;scan.records=merged;scan.characters=characters;scan.lastAcceptedWindow=JSON.stringify(batch.map(({role,content})=>({role,content})));
    const scroller=scan.scroller,max=Math.max(0,scroller.scrollHeight-scroller.clientHeight),pos=scan.reverse?scroller.scrollTop+max:scroller.scrollTop;
    const edge=scan.direction==='up'?pos<=2:pos>=max-2;
    // Measure progress against a message and the fraction traversed inside it.
    // Scroll heights and absolute offsets can oscillate as a virtual list lays out
    // images. Those changes alone must not restart the no-progress deadline.
    const viewportTop=scroller===document.scrollingElement?0:scroller.getBoundingClientRect().top+scroller.clientTop;
    const mounted=rows().filter(row=>scroller.contains(row)).sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top);
    let cursor=null;
    for(const row of mounted){
      const rect=row.getBoundingClientRect();
      if(rect.bottom<=viewportTop||rect.top>=viewportTop+scroller.clientHeight||rect.height<=0)continue;
      const message={role:role(row),content:contentOf(row)};
      if(imageOnly(message))continue;
      const indexes=merged.flatMap((m,i)=>equal(m,message)?[i]:[]);
      if(indexes.length!==1)continue;
      const fraction=Math.max(0,Math.min(1,(viewportTop-rect.top)/rect.height));
      cursor={index:indexes[0],fraction:Number(fraction.toFixed(4))};break;
    }
    const score=cursor?cursor.index+cursor.fraction:null;
    const reset=grew||scan.progressAt==null||scan.progressDirection!==scan.direction;
    if(reset){
      scan.progressAt=Date.now();scan.bestCursor=score;scan.bestPosition=pos;
      scan.progressDirection=scan.direction;scan.recoveredWindow=false;scan.reboundReads=0;scan.pendingRecovery=false;scan.recoveredAt=null;
    }else if(score!=null&&(scan.bestCursor==null||
      (scan.direction==='up'?score<scan.bestCursor-0.002:score>scan.bestCursor+0.002))){
      scan.progressAt=Date.now();scan.bestCursor=score;
    }else if(score==null&&
      (scan.direction==='up'?pos<scan.bestPosition-2:pos>scan.bestPosition+2)){
      scan.progressAt=Date.now();scan.bestPosition=pos;
    }
    const returned=prior?.requestedTop!=null&&(scan.direction==='up'?
      measuredTop>prior.requestedTop+scroller.clientHeight*0.2:measuredTop<prior.requestedTop-scroller.clientHeight*0.2);
    const returnDistance=prior?.requestedTop==null?0:(measuredTop-prior.requestedTop)*(scan.direction==='up'?1:-1);
    const largeReturn=returned&&returnDistance>=scroller.clientHeight*2&&!grew&&!reset;
    scan.reboundReads=returned?scan.reboundReads+1:0;
    if(largeReturn){
      if(!scan.recoveredWindow)scan.pendingRecovery=true;scan.scroll.largeRebounds++;
      scan.scroll.lastReturn={elapsedMs:Date.now()-scan.started,expectedTop:prior.requestedTop,
        observedTop:Math.round(measuredTop),distance:Math.round(returnDistance)};
    }
    scan.scroll.cursor=cursor;scan.scroll.reboundReads=scan.reboundReads;
    scan.scroll.noAdvanceMs=Date.now()-scan.progressAt;
    scan.scroll.trace=[...scan.scroll.trace,{elapsedMs:Date.now()-scan.started,top:Math.round(measuredTop),
      max:Math.round(max),count:merged.length,cursor,direction:scan.direction,returned,expectedTop:prior?.requestedTop??null}].slice(-12);
    if(!edge&&!scan.pendingRecovery&&scan.scroll.noAdvanceMs>=30000&&(scan.recoveredAt==null||Date.now()-scan.recoveredAt>=12000))return stop('failed','scroll-stalled',
      '网页长时间未向更早或更晚的消息前进，已停止扫描；本地记录保持不变，请复制连接诊断');
    // Programmatic scrollTop alone does not notify wheel-based follow-bottom /
    // load-more handlers. Signal the direction as well as moving the viewport.
    // This is a synthetic event (never a claim of trusted physical input).
    const moveHistory=target=>{
      const beforeTop=scroller.scrollTop,beforeHeight=scroller.scrollHeight;
      const rect=scroller.getBoundingClientRect();
      const x=Math.max(0,Math.min(innerWidth-1,rect.left+rect.width/2));
      const y=Math.max(0,Math.min(innerHeight-1,viewportTop+scroller.clientHeight/2));
      const hit=document.elementFromPoint(x,y),recipient=hit&&scroller.contains(hit)?hit:scroller;
      const signal=new WheelEvent('wheel',{deltaMode:0,deltaY:(scan.direction==='up'?-1:1)*Math.max(1,scroller.clientHeight*0.6),
        bubbles:true,cancelable:true,composed:true});
      recipient.dispatchEvent(signal);scan.scroll.wheelSignals++;
      if(signal.defaultPrevented)scan.scroll.wheelPrevented++;
      // A page handler may already move/load the list. Do not scroll it a second
      // time or touch a different conversation if that handler changed the route.
      if(url()!==scan.url||scan.phase!=='running'||!scroller.isConnected)return false;
      if(Math.abs(scroller.scrollTop-beforeTop)<2&&scroller.scrollHeight===beforeHeight)
        scroller.scrollTo({top:target,behavior:'instant'});
      scroller.dispatchEvent(new Event('scroll',{bubbles:true}));
      scan.scroll.requestedTop=Math.round(target);scan.scroll.appliedTop=Math.round(scroller.scrollTop);
      return true;
    };
    const signature=scan.direction+':'+merged.length+':'+characters;
    if(grew||signature!==scan.lastBoundary){scan.boundarySince=0;scan.lastBoundary=signature;}
    if(edge){
      scan.boundarySince||=Date.now();
      const wait=scan.direction==='up'?12000:3000;
      if(Date.now()-scan.boundarySince>=wait){
        if(scan.direction==='down')return stop('complete','boundaries-checked');
        scan.topChecked=true;scan.direction='down';scan.boundarySince=0;scan.lastBoundary='';
      }else{
        // Re-trigger lazy loading even when the page starts at its apparent top.
        if(scan.direction==='up'){
          const top=scan.reverse?-max:0;moveHistory(top);
        }
        return report();
      }
    }
    let next=scan.direction==='up'?Math.max(0,pos-scroller.clientHeight*0.6):Math.min(max,pos+scroller.clientHeight*0.6);
    // A snapback otherwise causes every tick to request the same short step.
    // All mounted rows were captured above: seek their already-read leading edge
    // once, then let the usual overlap checks verify any newly mounted history.
    if(!scan.recoveredWindow&&(scan.pendingRecovery||(scan.reboundReads>=2&&scan.scroll.noAdvanceMs>=3000))&&mounted.length){
      const rect=(scan.direction==='up'?mounted[0]:mounted.at(-1)).getBoundingClientRect();
      const target=scan.direction==='up'?pos+rect.top-viewportTop-scroller.clientHeight*0.3:
        pos+rect.bottom-viewportTop-scroller.clientHeight*0.7;
      next=Math.max(0,Math.min(max,scan.direction==='up'?Math.min(next,target):Math.max(next,target)));
      scan.recoveredWindow=true;scan.recoveredAt=Date.now();scan.pendingRecovery=false;scan.scroll.recoveries++;
    }
    const requestedTop=scan.reverse?next-max:next;
    moveHistory(requestedTop);scan.scrolls++;
    return report();
  }

 if(input.command==='history'){
  const fail=error=>({url:url(),messages:[],error});
  if(!official()||url()!==input.url)return fail('豆包会话已切换，请重新连接');
  if(dialog())return fail('请先关闭豆包网页弹窗，再同步历史');
  if(stopping())return fail('豆包正在生成，请等待回答完成后同步');
  const domRows=rows();
  // Virtual lists can append/recycle DOM nodes while positioning them elsewhere.
  // Read the visible layout from top to bottom, not the element insertion order.
  const positions=new Map(domRows.map(row=>[row,row.getBoundingClientRect().top]));
  const all=[...domRows].sort((a,b)=>positions.get(a)-positions.get(b)),messages=[];let characters=0;
  window.__awbDoubaoExtractionAuditV1={url:url(),audit:{...extractionAudit(all),
    order:'visual-top-to-bottom',domOrderChanged:all.some((row,i)=>row!==domRows[i]),
    domIndexes:all.slice(0,20).map(row=>domRows.indexOf(row))}};
  if(!all.length&&(/^\/chat\/(?:bot\/chat\/)?[^/]+/.test(location.pathname)||document.querySelector(markdownSelector)))return fail('未识别到历史消息，请等待加载完成后复制连接诊断');
  for(const row of all){
   imageCollector={index:0,items:[]};
   const content=contentOf(row),historyImages=imageCollector.items;imageCollector=null;
   if(!content)return fail('部分豆包历史消息没有可读取正文，未合并历史');
   characters+=content.length;
   if(characters>400000||messages.length>=1000)return fail('已加载历史超过本次容量，未修改本地记录');
   messages.push({role:role(row),content,...(historyImages.length?{historyImages}:{})});
  }
  return {url:url(),messages:input.scanning?messages:imagePayload(messages)};
 }
 if(input.command==='probe')return probe();
 if(input.command==='release'){if(window[key])window[key].finished=true;return probe();}
 let state=window[key];
 const result=(phase,error)=>({phase,error,content:state?.content||'',url:state?.url||input.url||url()});
 const fail=error=>{if(state)state.failed=error;return result('failed',error);};
 if(input.command==='begin'){
  if(state?.id===input.job.id)return state.failed?fail(state.failed):result(state.finished?'complete':'waiting');
  if(state&&!state.finished&&!state.failed)return fail('已有未完成任务，请先停止接收');
  if(url()!==input.job.url)return {phase:'failed',content:'',url:input.job.url,error:'豆包页面已切换，请重新连接后发送'};
  if(input.job.images?.length&&!(window.__awbImageUploadV1?.id===input.job.id&&window.__awbImageUploadV1.ready&&window.__awbImageUploadV1.url===url()))return {phase:'failed',content:'',url:input.job.url,error:'图片尚未确认上传，没有发送；请检查网页附件'};
const status=probe();if(!status.ready)return {phase:'failed',content:'',url:input.job.url,error:status.reason};
  const baselineRows=rows();
  state=window[key]={id:input.job.id,prompt:normalize(input.job.text),baseline:baselineRows.map(identity),baselineQuestions:baselineRows.filter(e=>role(e)==='user').map(promptOf),url:url(),initialUrl:url(),created:Date.now(),content:'',changed:Date.now(),seenGenerating:false};
  try{
   const e=editor();e.focus();
   if(e.tagName==='TEXTAREA'){
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,input.job.text);
    e.dispatchEvent(new Event('input',{bubbles:true}));
    e.dispatchEvent(new Event('change',{bubbles:true}));
   }else{
    const selection=getSelection(),range=document.createRange();range.selectNodeContents(e);selection.removeAllRanges();selection.addRange(range);
    document.execCommand('insertText',false,input.job.text);
   }
   let target=null;
   for(let attempt=0;attempt<20;attempt++){
    await new Promise(resolve=>setTimeout(resolve,150));
    if(state.finished||state.failed)return fail('任务已停止；没有点击发送');
    if(url()!==state.initialUrl)return fail('输入时页面已切换，请检查网页草稿；没有点击发送');
    if(editor()!==e||normalize(text(e))!==state.prompt)return fail('输入框或草稿已变化，请检查豆包网页；没有点击发送');
    if(dialog()||stopping())return fail('豆包页面正在生成或出现弹窗；没有点击发送');
    const candidates=sendInfo().candidates;
    if(candidates.length>1)return fail('发现多个豆包发送按钮；没有点击发送');
    if(candidates.length===1&&!disabled(candidates[0])){target=candidates[0];break;}
   }
   if(!target)return fail('填写后仍未找到可用的豆包发送按钮，问题已留在网页草稿中；没有点击发送，请复制连接诊断');
   state.clicked=true;target.click();state.seenGenerating=stopping();return result('waiting');
  }catch{return fail('豆包发送状态不确定，请核对网页；不会自动重发');}
 }
 if(!state||state.id!==input.jobId)return {phase:'failed',content:'',url:input.url,error:'页面已刷新或任务已丢失，请核对豆包；不会自动重发'};
 if(input.command==='cancel'){state.finished=true;return result('failed','已停止接收');}
 if(state.failed)return fail(state.failed);
 if(!official())return fail('已离开豆包聊天页面，停止接收');
 if(state.finished)return result('complete');
 if(state.url!==url()&&(state.lockedUrl||state.baseline.length))return fail('豆包会话已切换，已保留收到的内容');
 if(dialog())return fail('豆包出现登录或验证弹窗，请在网页处理；不会自动重发');
 const all=rows(),humans=all.filter(e=>role(e)==='user'),currentQuestions=humans.map(promptOf),previous=state.baselineQuestions||[];
 let human;
 if(state.humanNode?.isConnected&&humans.includes(state.humanNode)&&promptOf(state.humanNode)===state.prompt){
  human=state.humanNode;
 }else{
  // Rendering an earlier answer or rebuilding row nodes must not break correlation.
  // Require ordered overlap with pre-send questions before accepting a new prompt.
  let overlap=0;
  for(let n=Math.min(previous.length,currentQuestions.length);n>0;n--){
   if(previous.slice(-n).every((q,i)=>q===currentQuestions[i])){overlap=n;break;}
  }
  if((!previous.length||overlap>0)&&overlap<humans.length&&currentQuestions[overlap]===state.prompt){
   if(currentQuestions.slice(overlap).filter(q=>q===state.prompt).length>1)return fail('出现多个相同的新提问，无法可靠定位，已停止接收');
   human=humans[overlap];
  }
 }
 if(!human){if(Date.now()-state.created>30000)return fail('未能按提问顺序定位本次回答，请核对豆包网页后同步历史；不会自动重发');return result('waiting');}
 const at=all.indexOf(human);
 state.humanNode=human;
 state.humanKey=identity(human);state.url=url();state.lockedUrl=true;
 const after=all.slice(at+1);
 if(after.some(e=>role(e)==='user'))return fail('网页出现了另一条提问，请只在一处发送');
 const answers=after.filter(e=>role(e)==='assistant');
 if(answers.length>1)return fail('发现多个回答，暂不能可靠接收，请在网页查看');
 const answer=answers[0];if(!answer)return result('waiting');
 const content=contentOf(answer);
 if(content.length>500000)return fail('回答超过接收容量，请在豆包网页查看');
 if(content!==state.content){state.content=content;state.changed=Date.now();}
 const generating=stopping();if(generating)state.seenGenerating=true;
 const controls=answer.querySelectorAll('[data-testid*="copy"],[data-testid*="regenerate"],button[aria-label="复制"],button[title="复制"]');
 const completed=answer.getAttribute('data-is-streaming')==='false'||answer.getAttribute('data-generating')==='false'||[...controls].some(e=>!e.closest('pre,code,[class*="code-block"],[class*="codeblock"],[class*="codeBlock"]'))||state.seenGenerating;
 if(content&&completed&&!generating&&Date.now()-state.changed>=2000){state.finished=true;return result('complete');}
 if(Date.now()-state.created>720000)return fail('等待豆包回答结束超时，已保留收到的内容，请核对网页');
 return result(content?'streaming':'waiting');
}
