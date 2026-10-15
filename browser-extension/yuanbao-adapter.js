// Runs in the extension's isolated world. Only public page DOM is used.
export async function yuanbaoCommand(input) {
  const key='__awbYuanbaoChatV1';
  const url=()=>{const u=new URL(location.href);u.hash='';return u.href;};
  const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
  const one=s=>[...document.querySelectorAll(s)].find(visible);
  const rows=()=>[...document.querySelectorAll('[data-conv-idx][data-conv-speaker]')].filter(visible);
  const identity=e=>e.dataset.convSpeaker+':'+e.dataset.convIdx;
  const normalize=s=>String(s||'').replace(/\s+/g,' ').trim();
  // Yuanbao ships both Quill and the newer IM/command editor. Match only known
  // composer regions; never fall back to an arbitrary editable field on the page.
  const editorSelector=[
    '.chat-input-editor .ql-editor','.agent-input-text-area .ql-editor',
    '.chat-input-editor textarea','.yb-im-input-editor',
    '.yb-im-input-editor [contenteditable]',
    '.chat-command-editor-specail [contenteditable]',
    '.chat-command-editor-specail textarea',
    '[data-input-main-content] [contenteditable]',
    '[data-input-main-content] textarea'
  ].join(',');
  const editors=()=>{
    const found=[...document.querySelectorAll(editorSelector)].filter(e=>visible(e)&&
      (e.tagName==='TEXTAREA'?!e.disabled&&!e.readOnly:e.isContentEditable)&&e.getAttribute('aria-disabled')!=='true');
    return found.filter(e=>!found.some(parent=>parent!==e&&parent.contains(e)));
  };
  const editor=()=>{const found=editors();return found.length===1?found[0]:null;};
  const text=e=>e?.value??e?.innerText??'';
  const button=()=>document.getElementById('yuanbao-send-btn');
  const stopping=()=>/stop-btn|SendButton_sendStop__/.test(button()?.className||'')||button()?.getAttribute('aria-label')==='停止回答'||rows().some(e=>e.dataset.convOutputting==='true');
  const disabled=e=>!visible(e)||e.disabled||e.getAttribute('aria-disabled')==='true'||/send-btn--disabled|page--disabled|SendButton_disabled__|SendButton_sendNot__/.test(e.className);
  const probe=()=>{
    const e=editor();
    const ownImages=input.command==='begin'&&input.job?.images?.length&&window.__awbImageUploadV1?.id===input.job.id&&window.__awbImageUploadV1.ready&&window.__awbImageUploadV1.url===url();
    let reason='';
    if(location.origin!=='https://yuanbao.tencent.com')reason='请打开元宝官方网页';
    else if(one('[role="dialog"],.t-dialog'))reason='请先在元宝页面完成登录或关闭弹窗';
    else if(editors().length>1)reason='发现多个元宝输入框，无法确定发送位置；请关闭额外编辑面板后重试';
    else if(!e)reason='未识别到可用的元宝输入框；若原网页可以正常输入，请复制下方连接诊断';
    else if(!visible(button()))reason='已识别输入框，但未找到可见的元宝发送按钮；请复制下方连接诊断';
    else if(!ownImages&&([...document.querySelectorAll('input[type="file"]')].some(n=>n.files?.length)||one('[class*="text-area__attachment"] img')||[...document.querySelectorAll('[class*="text-area__attachment"],[data-input-resource-area]')].some(n=>visible(n)&&normalize(n.innerText))))reason='元宝输入区有待发送附件，请先处理附件';
    else if(stopping())reason='元宝正在生成，请等待网页回答结束';
    else if(normalize(text(e)))reason='元宝输入框有未发送草稿，请先处理草稿';
    return {ready:!reason,reason,url:url(),diagnostics:{version:'0.8.1',ready:!reason,reason,editor:!!e,editorCandidates:editors().length,editableFields:[...document.querySelectorAll('[contenteditable],textarea')].filter(visible).length,imEditors:document.querySelectorAll('.yb-im-input-editor').length,commandEditors:document.querySelectorAll('.chat-command-editor-specail').length,inputRegions:document.querySelectorAll('[data-input-main-content]').length,sendButton:!!button(),sendButtonVisible:visible(button()),readyState:document.readyState,iframes:document.querySelectorAll('iframe').length,rows:rows().length,humanRows:rows().filter(n=>n.dataset.convSpeaker==='human').length,aiRows:rows().filter(n=>n.dataset.convSpeaker==='ai').length,markdownBlocks:document.querySelectorAll('.hyc-content-md').length}};
  };
  if(input.command.startsWith('history-scan')){
    const scanKey='__awbYuanbaoHistoryScanV1';
    let scan=window[scanKey];
    const restore=()=>{if(scan?.scroller?.isConnected){scan.scroller.style.scrollBehavior='auto';const max=scan.scroller.scrollHeight-scan.scroller.clientHeight;scan.scroller.scrollTop=scan.reverse?-scan.bottom:Math.max(0,max-scan.bottom);scan.scroller.style.scrollBehavior=scan.behavior;}};
    const report=()=>({url:scan?.url||url(),phase:scan?.phase||'idle',count:scan?.records.length||0,characters:scan?.characters||0,scrolls:scan?.scrolls||0,direction:scan?.direction||'up',reason:scan?.reason||'',error:scan?.error, ...(scan?.phase==='complete'?{messages:scan.records,scan:{reason:scan.reason,scrolls:scan.scrolls,topChecked:scan.topChecked,complete:false}}:{})});
    const stop=(phase,reason,error)=>{scan.phase=phase;scan.reason=reason;scan.error=error;restore();return report();};
    if(input.command==='history-scan-cancel'){if(scan&&scan.id===input.requestId)return stop('cancelled','cancelled');return {phase:'idle'};}
    if(scan?.id===input.requestId&&scan.phase!=='running')return report();
    if(!scan||scan.id!==input.requestId){
      if(input.command!=='history-scan-start')return {phase:'failed',url:url(),error:'扫描状态已丢失，请重新开始'};
      if(scan?.phase==='running')restore();
      const first=rows()[0];let scroller=first?.parentElement;
      while(scroller&&!(scroller.clientHeight>0&&scroller.scrollHeight>scroller.clientHeight+2&&/auto|scroll/.test(getComputedStyle(scroller).overflowY)))scroller=scroller.parentElement;
      scroller||=document.scrollingElement;
      if(!scroller)return {phase:'failed',url:url(),error:'没有找到对话滚动区域'};
      const reverse=getComputedStyle(scroller).flexDirection==='column-reverse',max=scroller.scrollHeight-scroller.clientHeight;
      scan=window[scanKey]={id:input.requestId,url:input.url,phase:'running',records:[],characters:0,scrolls:0,direction:'up',started:Date.now(),boundarySince:0,lastBoundary:'',topChecked:false,scroller,reverse,bottom:reverse?-scroller.scrollTop:max-scroller.scrollTop,behavior:scroller.style.scrollBehavior};
      scroller.style.scrollBehavior='auto';
    }
    if(url()!==scan.url)return stop('failed','navigation','元宝会话已切换，扫描已停止，本地记录未修改');
    if(Date.now()-scan.started>900000)return stop('complete','time-limit');
    if(!scan.scroller.isConnected)return stop('failed','scroller-lost','网页滚动区域已变化，请重新扫描');
    const capture=await yuanbaoCommand({command:'history',url:scan.url});
    if(capture.error){
      if(/超过|容量/.test(capture.error))return scan.records.length?stop('complete','capacity'):stop('failed','capacity',capture.error);
      if(stopping()||one('[role="dialog"],.t-dialog'))return stop('failed','page-not-ready',capture.error);
      scan.readFailureSince||=Date.now();
      if(Date.now()-scan.readFailureSince>12000)return stop('failed','read-failed',capture.error);
      return report();
    }
    scan.readFailureSince=0;
    const batch=capture.messages,records=scan.records;
    if(!batch.length&&records.length){scan.emptySince||=Date.now();if(Date.now()-scan.emptySince>12000)return stop('failed','empty-page','滚动后消息持续为空，请重新加载网页后重试');return report();}scan.emptySince=0;
    const equal=(a,b)=>a.role===b.role&&a.content===b.content;
    let merged;
    if(!records.length)merged=batch;
    else{
      const candidates=[];
      for(let offset=-(batch.length-1);offset<records.length;offset++){
        const start=Math.max(0,offset),end=Math.min(records.length,offset+batch.length);
        if(end-start<Math.min(2,records.length,batch.length))continue;
        let ok=true;for(let i=start;i<end;i++)if(!equal(records[i],batch[i-offset])){ok=false;break;}
        if(ok)candidates.push({offset,overlap:end-start});
      }
      const max=Math.max(0,...candidates.map(c=>c.overlap)),best=candidates.filter(c=>c.overlap===max);
      if(best.length!==1)return stop('failed','ambiguous','滚动前后的消息无法可靠衔接，已停止；本地记录保持不变，请重新加载元宝对话后再试');
      const offset=best[0].offset;merged=[];
      for(let i=Math.min(0,offset);i<Math.max(records.length,offset+batch.length);i++)merged.push(i>=0&&i<records.length?records[i]:batch[i-offset]);
    }
    const characters=merged.reduce((n,m)=>n+m.content.length,0);
    if(merged.length>1000||characters>400000){
      if(!records.length)return stop('failed','capacity','历史超过本次容量，未保存');
      return stop('complete','capacity');
    }
    const grew=merged.length>records.length;scan.records=merged;scan.characters=characters;
    const scroller=scan.scroller,max=Math.max(0,scroller.scrollHeight-scroller.clientHeight),pos=scan.reverse?scroller.scrollTop+max:scroller.scrollTop;
    const edge=scan.direction==='up'?pos<=2:pos>=max-2;
    const signature=scan.direction+':'+max+':'+merged.length+':'+characters;
    if(grew||signature!==scan.lastBoundary){scan.boundarySince=0;scan.lastBoundary=signature;}
    if(edge){
      scan.boundarySince||=Date.now();
      const wait=scan.direction==='up'?12000:3000;
      if(Date.now()-scan.boundarySince>=wait){
        if(scan.direction==='down')return stop('complete','boundaries-checked');
        scan.topChecked=true;scan.direction='down';scan.boundarySince=0;scan.lastBoundary='';
      }else{
        // Re-trigger lazy loading even when the page starts at its apparent top.
        if(max>0&&scan.direction==='up'){
          const top=scan.reverse?-max:0;scroller.scrollTop=top+1;scroller.dispatchEvent(new Event('scroll'));scroller.scrollTop=top;scroller.dispatchEvent(new Event('scroll'));
        }
        return report();
      }
    }
    const next=scan.direction==='up'?Math.max(0,pos-scroller.clientHeight*0.6):Math.min(max,pos+scroller.clientHeight*0.6);
    scroller.scrollTop=scan.reverse?next-max:next;scroller.dispatchEvent(new Event('scroll'));scan.scrolls++;
    return report();
  }
  if(input.command==='history'){
    const failHistory=error=>({url:url(),messages:[],error});
    if(location.origin!=='https://yuanbao.tencent.com'||url()!==input.url)return failHistory('元宝会话已切换，请重新连接后同步历史');
    if(stopping())return failHistory('元宝正在生成，请等回答结束后点击「同步网页历史」');
    if(one('[role="dialog"],.t-dialog'))return failHistory('请先关闭元宝网页弹窗，再同步历史');
    const messages=[];let characters=0;
    const loadedRows=rows();
    const list=loadedRows.filter(row=>!loadedRows.some(parent=>parent!==row&&parent.contains(row)&&identity(parent)===identity(row)));
    for(const row of list){
      const speaker=row.dataset.convSpeaker;
      if(!['human','ai'].includes(speaker))return failHistory('存在未识别发言者，未合并历史；请保留原网页');
      if(row.dataset.convMultiAnswer==='true')return failHistory('历史包含多答案模式，暂不能可靠合并');
      let content;
      if(speaker==='human')content=text(row.querySelector('.agent-chat__bubble__content')||row).trim();
      else{
        const blocks=[...row.querySelectorAll('.hyc-content-md')].filter(visible).filter(n=>!n.parentElement.closest('.hyc-content-md'));
        if(!blocks.length)return failHistory('部分历史回答未找到正文，请在网页加载后重试');
        content=blocks.map(markdown).join('\n\n').replace(/\n{3,}/g,'\n\n').trim();
      }
      if(!content)return failHistory('部分历史消息为空，未合并历史');
      characters+=content.length;
      if(characters>400000||messages.length>=1000)return failHistory('已加载历史超过本次容量，未改动本地记录');
      messages.push({role:speaker==='human'?'user':'assistant',content});
    }
    return {url:url(),messages};
  }
  if(input.command==='probe')return probe();
  if(input.command==='release'){if(window[key])window[key].finished=true;return probe();}
  let state=window[key];
  const result=(phase,error)=>({phase,error,content:state?.content||'',url:state?.url||url()});
  const fail=message=>{if(state)state.failed=message;return result('failed',message);};
  if(input.command==='begin') {
    if(state?.id===input.job.id)return state.failed?fail(state.failed):result('waiting');
    if(state&&!state.finished&&!state.failed)return fail('网页上已有未完成任务，请先停止接收');
    if(url()!==input.job.url)return {phase:'failed',error:'元宝页面已切换，请重新连接后发送',content:'',url:input.job.url};
    if(input.job.images?.length&&!(window.__awbImageUploadV1?.id===input.job.id&&window.__awbImageUploadV1.ready&&window.__awbImageUploadV1.url===url()))return {phase:'failed',content:'',url:input.job.url,error:'图片尚未确认上传，没有发送；请检查网页附件'};
    const status=probe();
    if(!status.ready)return {phase:'failed',error:status.reason,content:'',url:input.job.url};
    state=window[key]={id:input.job.id,prompt:normalize(input.job.text),baseline:rows().map(identity),baselineQuestions:rows().filter(e=>e.dataset.convSpeaker==='human').map(e=>normalize(text(e.querySelector('.agent-chat__bubble__content')||e))),url:url(),initialUrl:url(),created:Date.now(),content:'',changed:Date.now()};
    try {
      const e=editor();e.focus();
      if(e.tagName==='TEXTAREA'){
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,input.job.text);
        e.dispatchEvent(new Event('input',{bubbles:true}));
      } else {
        const selection=getSelection(),range=document.createRange();range.selectNodeContents(e);selection.removeAllRanges();selection.addRange(range);
        document.execCommand('insertText',false,input.job.text);
      }
      await new Promise(resolve=>setTimeout(resolve,150));
      if(url()!==state.initialUrl)return fail('输入时页面发生切换，已停止；请检查网页草稿');
      if(normalize(text(e))!==state.prompt)return fail('未能完整填写问题，请检查元宝输入框；没有点击发送');
      if(disabled(button())||stopping())return fail('元宝发送按钮未就绪，请检查登录、额度或网页草稿；没有点击发送');
      // Record before clicking. A failed/uncertain click is never automatically retried.
      state.clicked=true;
      button().click();
      return result('waiting');
    }catch{return fail('网页发送未完成，请检查元宝页面；不会自动重发');}
  }
  if(!state||state.id!==input.jobId)return {phase:'failed',error:'网页已刷新或任务状态丢失，请核对网页；不会自动重发',content:'',url:input.url};
  if(input.command==='cancel'){state.finished=true;return result('failed','已停止接收');}
  if(state.failed)return fail(state.failed);
  if(location.origin!=='https://yuanbao.tencent.com')return fail('元宝页面已离开，请核对网页');
  if(state.finished)return result('complete');
  if(state.url!==url()&&(state.lockedUrl||state.baseline.length>0))return fail('元宝对话已切换，已保留收到的内容');
  const all=rows(),humans=all.filter(e=>e.dataset.convSpeaker==='human');
  const promptOf=e=>normalize(text(e.querySelector('.agent-chat__bubble__content')||e));
  const currentQuestions=humans.map(promptOf),previous=state.baselineQuestions||[];
  let human;
  if(state.humanNode?.isConnected&&humans.includes(state.humanNode)&&promptOf(state.humanNode)===state.prompt){
    human=state.humanNode;
  }else{
    // The site's row index can change after rendering or trimming older rows.
    // Match the ordered overlap with the pre-send question window instead.
    let overlap=0;
    for(let n=Math.min(previous.length,currentQuestions.length);n>0;n--){
      if(previous.slice(-n).every((q,i)=>q===currentQuestions[i])){overlap=n;break;}
    }
    if((!previous.length||overlap>0)&&overlap<humans.length&&currentQuestions[overlap]===state.prompt)human=humans[overlap];
  }
  if(!human){
    if(Date.now()-state.created>30000)return fail('未能可靠定位本次提问，请核对网页后同步历史；不会自动重发');
    return result('waiting');
  }
  state.humanNode=human;
  state.humanKey=identity(human);
  if(!state.lockedUrl){state.url=url();state.lockedUrl=true;}
  else if(state.url!==url())return fail('元宝对话已切换，已保留收到的内容');
  const after=all.slice(all.indexOf(human)+1),nextHuman=after.findIndex(e=>e.dataset.convSpeaker==='human');
  const answers=(nextHuman<0?after:after.slice(0,nextHuman)).filter(e=>e.dataset.convSpeaker==='ai');
  if(nextHuman>=0)return fail('网页中出现了另一条提问，已停止接收；请在一处发送');
  if(answers.length>1||answers.some(e=>e.dataset.convMultiAnswer==='true'))return fail('暂不支持元宝多答案模式，请在网页切换为单个回答');
  const answer=answers[0];
  if(!answer)return result('waiting');
  if(answer.dataset.convSensitive==='true')return fail('元宝未提供可读取的回答，请查看网页提示');
  const blocks=[...answer.querySelectorAll('.hyc-content-md')].filter(visible).filter(e=>!e.parentElement.closest('.hyc-content-md'));
  if(!blocks.length){
    if(Date.now()-state.created>60000&&answer.dataset.convOutputting!=='true')return fail('找到回答位置，但无法识别正文，请查看元宝页面');
    return result('waiting');
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
  const content=blocks.map(markdown).join('\n\n').replace(/\n{3,}/g,'\n\n').trim();
  if(content.length>500000)return fail('回答超过本次接收容量，请到网页查看');
  if(content!==state.content){state.content=content;state.changed=Date.now();}
  const done=answer.dataset.convOutputting==='false'||blocks.every(e=>e.classList.contains('hyc-content-md-done'));
  if(content&&done&&answer.dataset.convOutputting!=='true'&&!stopping()&&Date.now()-state.changed>=2000){state.finished=true;return result('complete');}
  return result(content?'streaming':'waiting');
}
