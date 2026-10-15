// Injected only into the tab explicitly connected by the user; never uses private APIs.
export async function standardChatCommand(input){
 const provider=input.provider;
 if(!['chatgpt','gemini'].includes(provider))return {phase:'failed',content:'',error:'未知网页平台'};
 const g=provider==='gemini',name=g?'Gemini':'ChatGPT',key='__awbStandardChatV1_'+provider;
 const normalize=v=>String(v||'').replace(/\s+/g,' ').trim();
 const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
 const official=()=>location.protocol==='https:'&&!location.port&&(g?location.hostname==='gemini.google.com'&&/^\/app(?:\/[a-zA-Z0-9_-]{1,160})?\/?$/.test(location.pathname):location.hostname==='chatgpt.com'&&/^\/(?:c\/[a-zA-Z0-9_-]{1,160}\/?)?$/.test(location.pathname));
 const url=()=>{const u=new URL(location.href);u.search='';u.hash='';u.pathname=u.pathname.replace(/\/$/,'')||'/';return u.href;};
 const hasConversation=value=>g?new URL(value).pathname.replace(/\/$/,'')!=='/app':new URL(value).pathname!=='/';
 const excluded='nav,aside,[role="navigation"],[role="dialog"],deep-research-immersive-panel';
 const editorSelector=g?'rich-textarea [contenteditable="true"],.ql-editor[contenteditable="true"],textarea':'#prompt-textarea,textarea[name="prompt-textarea"],textarea,[contenteditable="true"][role="textbox"]';
 const areas=[...document.querySelectorAll(g?'main,[role="main"],chat-window,bard-sidenav-content':'main,[role="main"]')].filter(visible);
 // Some Gemini layouts keep the composer outside chat-window. Select a common
 // area containing an eligible editor, instead of always taking the deepest root.
 const editableAreas=areas.filter(n=>[...n.querySelectorAll(editorSelector)].some(e=>visible(e)&&!e.closest(excluded)&&!e.closest('user-query,model-response,[data-message-author-role]')));
 const roots=editableAreas.filter(n=>!editableAreas.some(other=>other!==n&&n.contains(other)));
 const area=roots.length===1?roots[0]:null;
 const selector=g?'user-query,model-response,[data-message-author-role]':'[data-message-author-role]';
 let snapshot;
 const all=()=>snapshot??=(area?[...area.querySelectorAll(selector)].filter(n=>visible(n)&&!n.closest(excluded)&&!n.parentElement?.closest(selector)):[]);
 const role=n=>n.matches('user-query')?'user':n.matches('model-response')?'assistant':['user','assistant'].includes(n.getAttribute('data-message-author-role'))?n.getAttribute('data-message-author-role'):null;
 const skip='button,[role="button"],script,style,svg,model-thoughts,.thoughts-container,.thoughts-content,[data-testid="thoughts"],.gv-export-msg-selector';
 const walk=n=>{
  if(n.nodeType===3)return n.textContent||'';
  if(n.nodeType!==1||n.matches(skip)||!visible(n))return '';
  const tag=n.tagName.toLowerCase();if(tag==='br')return '\n';if(tag==='img')return '[图片]';
  if(tag==='pre'){const code=n.querySelector('code'),lang=(code?.className.match(/language-([a-zA-Z0-9_-]+)/)||[])[1]||'',value=(code||n).textContent||'',fence='~'.repeat(Math.max(3,...[...value.matchAll(/~+/g)].map(m=>m[0].length+1)));return '\n\n'+fence+lang+'\n'+value+'\n'+fence+'\n\n';}
  const inner=[...n.childNodes].map(walk).join('');
  if(tag==='code')return String.fromCharCode(96)+inner+String.fromCharCode(96);
  if(/^h[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+inner.trim()+'\n\n';
  if(tag==='strong'||tag==='b')return '**'+inner+'**';if(tag==='em'||tag==='i')return '*'+inner+'*';
  if(tag==='a'){try{const link=new URL(n.getAttribute('href'),location.href);if(['https:','http:'].includes(link.protocol))return '['+inner.trim()+']('+link.href.replace(/\(/g,'%28').replace(/\)/g,'%29')+')';}catch{}return inner;}
  if(tag==='li')return '\n- '+inner.trim()+'\n';
  if(tag==='tr')return '\n| '+[...n.children].map(cell=>walk(cell).trim().replace(/\|/g,'\\|').replace(/\n/g,' ')).join(' | ')+' |\n';
  if(tag==='thead'){const cells=n.querySelector('tr')?.children.length||0;return inner+'| '+Array(cells).fill('---').join(' | ')+' |\n';}
  return ['p','div','section','article','blockquote','ul','ol','table'].includes(tag)?'\n'+inner+'\n':inner;
 };
 const body=n=>{
  if(g&&role(n)==='user'){const lines=[...n.querySelectorAll('.query-text-line')].filter(visible);if(lines.length)return lines.map(e=>e.textContent||'').join('\n').trim();}
  const blocks=[...n.querySelectorAll(role(n)==='assistant'?(g?'message-content,.markdown-main-panel,.markdown':'.markdown,[data-message-content]'):(g?'.query-text,[data-message-content]':'.whitespace-pre-wrap,[data-message-content]'))].filter(e=>visible(e)&&!e.closest(skip));
  const outer=blocks.filter(e=>!blocks.some(other=>e!==other&&other.contains(e)));
  return (outer.length?outer.map(walk).join('\n\n'):walk(n)).replace(/\n{3,}/g,'\n\n').trim();
 };
 const editors=()=>area?[...area.querySelectorAll(editorSelector)].filter(e=>visible(e)&&!e.closest(excluded)&&!all().some(n=>n.contains(e))&&!e.disabled&&!e.readOnly&&e.getAttribute('aria-disabled')!=='true'):[];
 const editor=()=>editors().length===1?editors()[0]:null;
 const text=e=>e?.value??e?.innerText??'';
 const scope=()=>{let last=null;for(let n=editor()?.parentElement,depth=0;n&&n!==area&&depth<16;n=n.parentElement,depth++){if(all().some(row=>n.contains(row)))break;last=n;if(n.matches('form,input-container,.input-area-container'))break;}return last;};
 const controls=()=>scope()?[...scope().querySelectorAll('button,[role="button"]')].filter(visible):[];
 const labels=e=>[e.getAttribute('aria-label'),e.getAttribute('title'),e.getAttribute('data-tooltip'),e.innerText,...['aria-labelledby','aria-describedby'].flatMap(attr=>(e.getAttribute(attr)||'').split(/\s+/).filter(Boolean).slice(0,4).map(id=>document.getElementById(id)?.textContent||''))].map(normalize).filter(Boolean);
 const sendLabel=v=>/^(发送|发送消息|发送问题|提交|提交消息|Send|Send message|Send prompt|Submit|Submit prompt|Submit message)(?:\s*[（(](?:Enter|Return|回车)[）)])?$/i.test(v);
 const stopLabel=v=>/^(停止|停止生成|停止回答|停止回复|Stop|Stop generating|Stop response|Stop responding|Stop streaming)(?:\s*[（(]Esc[）)])?$/i.test(v);
 const isStop=e=>labels(e).some(stopLabel)||e.matches('[data-testid="stop-button"],.stop-button')||(g&&[...e.querySelectorAll('mat-icon')].some(n=>/^(stop|stop_circle)$/.test(normalize(n.textContent))));
 const sends=()=>controls().filter(e=>!isStop(e)&&(labels(e).some(sendLabel)||e.matches(g?'.send-button,[data-test-id="send-button"]':'[data-testid="send-button"]')));
 const stops=()=>controls().filter(isStop);
 const disabled=e=>!e||e.disabled||e.getAttribute('aria-disabled')==='true';
 const generating=()=>stops().length>0||all().some(n=>n.matches('[data-is-streaming="true"],[data-generating="true"]')||n.querySelector('[data-is-streaming="true"],[data-generating="true"],.streaming-animation'));
 const attachments=()=>!!scope()?.querySelector('[data-testid="attachment-preview"],[data-testid="file-thumbnail"],.file-preview-container,.uploaded-file,.attachment-container,.image-preview,[data-test-id="file-chip"]')||[...(scope()?.querySelectorAll('input[type="file"]')||[])].some(e=>e.files?.length);
 const audit=()=>controls().slice(0,12).map((e,index)=>({index,tag:e.tagName.toLowerCase(),disabled:disabled(e),sendLabel:labels(e).some(sendLabel),stopLabel:isStop(e),labelCharacters:labels(e).map(s=>s.length).slice(0,6)}));
 const probe=()=>{
  const e=editor(),buttons=sends();let reason='';
  if(!official())reason='请打开'+name+'官方聊天网页';
  else if(!area||editors().length!==1)reason='未找到唯一的'+name+'输入框，请关闭弹窗后复制连接诊断';
  else if([...document.querySelectorAll('[role="dialog"]')].some(visible))reason='网页有弹窗，请先关闭再连接';
  else if(generating())reason=name+'正在回答，请稍后再发送';
  else if(normalize(text(e)))reason=name+'输入框有草稿，请先在原网页处理';
  else if(attachments())reason=name+'输入区有附件，请先在原网页处理';
  else if(buttons.length>1)reason='发现多个发送按钮，请复制连接诊断';
  return {url:url(),ready:!reason,reason,note:!buttons.length&&!reason?'已连接输入区；发送时检查发送按钮。':'',diagnostics:{version:'0.12.0',platform:provider,ready:!reason,reason,editor:!!e,editorCandidates:editors().length,editorTag:e?.tagName.toLowerCase(),composerFound:!!scope(),composerButtons:controls().length,composerControls:audit(),sendButton:buttons.length===1,sendButtonVisible:buttons.length===1&&visible(buttons[0]),sendButtonCandidates:buttons.length,sendButtonPending:!!e&&!normalize(text(e))&&!buttons.length,stopButton:stops().length>0,rows:all().length,humanRows:all().filter(n=>role(n)==='user').length,aiRows:all().filter(n=>role(n)==='assistant').length,unknownRows:all().filter(n=>!role(n)).length,lastSendAttempt:window[key]?.diagnostics||null,readyState:document.readyState}};
 };
 if(input.command==='probe')return probe();
 if(input.command==='release'){if(window[key])window[key].cancelled=true;return probe();}
 if(input.command==='history'){
  if(!official()||url()!==input.url)return {url:url(),messages:[],error:name+'对话已切换，请重新连接'};
  if(generating())return {url:url(),messages:[],error:'请等待'+name+'回答完成后同步'};
  const messages=all().map(n=>({role:role(n),content:body(n)}));
  if((!messages.length&&hasConversation(url()))||messages.some(m=>!m.role||!m.content))return {url:url(),messages:[],error:'部分'+name+'历史消息无法识别，请复制连接诊断'};
  if(messages.length>1000||messages.reduce((s,m)=>s+m.content.length,0)>400000)return {url:url(),messages:[],error:'已加载历史超过同步容量'};
  return {url:url(),messages};
 }
 let state=window[key];
 const result=(phase,error)=>({phase,error,content:state?.content||'',url:state?.url||input.url||url()});
 const fail=error=>{if(state)state.error=error;return result('failed',error);};
 const identity=n=>n.getAttribute('data-message-id')||n.id||'';
 if(input.command==='begin'){
  if(state?.id===input.job.id)return state.error?fail(state.error):result(state.finished?'complete':state.cancelled?'failed':'waiting');
  if(state&&!state.finished&&!state.cancelled&&!state.error)return fail('已有未完成的'+name+'接收任务');
  if(!official()||url()!==input.job.url)return {phase:'failed',content:'',url:input.job.url,error:name+'对话已切换，没有发送'};
  if(input.job.images?.length)return {phase:'failed',content:'',url:input.job.url,error:'当前仅支持文字提问，请在原网页发送图片'};
  const p=probe();if(!p.ready)return {phase:'failed',content:'',url:input.job.url,error:p.reason};
  const rows=all();if(rows.some(n=>!role(n))||(!rows.length&&hasConversation(url())))return {phase:'failed',content:'',url:input.job.url,error:'无法确认当前消息位置，请复制连接诊断'};
  const humans=rows.filter(n=>role(n)==='user'),e=editor();
  state=window[key]={id:input.job.id,url:url(),initialUrl:url(),prompt:normalize(input.job.text),previous:humans.map(n=>normalize(body(n))),previousNodes:humans,content:'',created:Date.now(),changed:Date.now(),clicked:false};
  try{
   e.focus();
   if(e.tagName==='TEXTAREA'){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,input.job.text);e.dispatchEvent(new Event('input',{bubbles:true}));}
   else{const selection=getSelection(),range=document.createRange();range.selectNodeContents(e);selection.removeAllRanges();selection.addRange(range);if(!document.execCommand('insertText',false,input.job.text))return fail('无法填写网页输入框，没有发送');}
   const started=Date.now();
   for(let i=0;i<25&&Date.now()-started<3000;i++){
    if(state.cancelled||url()!==state.initialUrl)return fail('填写时对话已切换或任务已停止，没有点击发送');
    const buttons=sends();if(buttons.length===1&&!disabled(buttons[0]))break;
    await new Promise(resolve=>setTimeout(resolve,100));
   }
   if(state.cancelled||url()!==state.initialUrl||editor()!==e||!e.isConnected||normalize(text(e))!==state.prompt)return fail('问题未完整填写或页面已变化，没有点击发送');
   const buttons=sends();state.diagnostics={clicked:false,buttonCandidates:buttons.length,waitMs:Date.now()-started,controls:audit()};
   if(buttons.length!==1||disabled(buttons[0])||generating())return fail('未识别到可用的'+name+'发送按钮；已保留网页草稿，请复制连接诊断');
   state.clicked=true;state.diagnostics.clicked=true;buttons[0].click();state.sawGenerating=!!generating();return result('waiting');
  }catch{return fail(name+'发送状态不确定，请核对原网页；不会自动重发');}
 }
 if(!state||state.id!==input.jobId)return {phase:'failed',content:'',url:input.url,error:name+'页面状态已丢失，请核对网页；不会自动重发'};
 if(input.command==='cancel'){state.cancelled=true;return result('failed','已停止接收');}
 if(state.error)return fail(state.error);if(state.cancelled)return result('failed','已停止接收');if(state.finished)return result('complete');
 if(!official())return fail('已离开原'+name+'网页');
 if(url()!==state.url&&(state.locked||hasConversation(state.initialUrl)||state.previous.length||!hasConversation(url())))return fail(name+'对话已切换，已停止接收');
 const rows=all(),humans=rows.filter(n=>role(n)==='user'),questions=humans.map(n=>normalize(body(n)));
 let human=state.human?.isConnected&&humans.includes(state.human)&&normalize(body(state.human))===state.prompt?state.human:null;
 if(!human&&state.humanId){const matches=humans.filter(n=>identity(n)===state.humanId&&normalize(body(n))===state.prompt);if(matches.length===1)human=matches[0];}
 if(!human&&!state.locked){
  const last=state.previousNodes.at(-1),oldIndex=humans.indexOf(last);
  if(last?.isConnected&&oldIndex>=0){if(questions[oldIndex+1]===state.prompt)human=humans[oldIndex+1];}
  else if(!state.previous.length&&questions.length===1&&questions[0]===state.prompt)human=humans[0];
  else{const candidates=[];for(let count=1;count<=Math.min(state.previous.length,questions.length-1);count++)if(state.previous.slice(-count).every((q,j)=>q===questions[j])&&questions[count]===state.prompt)candidates.push(humans[count]);if(candidates.length===1)human=candidates[0];}
 }
 if(!human){if(state.locked)return fail('本次提问位置已丢失，已停止接收');if(Date.now()-state.created>30000)return fail('未找到本次提问，请核对网页；不会自动重发');return result('waiting');}
 state.human=human;state.humanId=identity(human);state.url=url();state.locked=true;
 const after=rows.slice(rows.indexOf(human)+1);if(after.some(n=>role(n)==='user'))return fail('网页出现另一条提问，已停止接收');
 if(after.some(n=>!role(n))||after.length>1)return fail('回答结构不明确，请查看原网页');
 state.sawGenerating ||= !!generating();const answer=after[0];if(!answer)return result('waiting');
 const content=body(answer);if(content.length>500000)return fail('回答超过接收容量');
 if(content!==state.content){state.content=content;state.changed=Date.now();}
 const turn=answer.closest('article,[data-testid^="conversation-turn-"],conversation-container')||answer;
 const copyScope=[...turn.querySelectorAll(selector)].filter(n=>role(n)==='assistant'&&!n.parentElement?.closest(selector)).length===1?turn:answer;
 const copy=[...copyScope.querySelectorAll('button,[role="button"]')].some(e=>visible(e)&&(e.matches('[data-testid="copy-turn-action-button"],[data-test-id="copy-button"]')||labels(e).some(v=>/^(复制|复制文本|复制回答|复制回复|Copy|Copy text|Copy response)$/i.test(v))));
 const completed=copy||answer.matches('[data-is-streaming="false"],[data-generating="false"]')||state.sawGenerating;
 if(content&&completed&&!generating()&&Date.now()-state.changed>=2500){state.finished=true;return result('complete');}
 return result(content?'streaming':'waiting');
}
