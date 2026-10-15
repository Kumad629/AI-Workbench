// X/Grok text chat. Reuses the public DOM reader installed by the relay.
export async function grokCommand(input){
 const key='__awbGrokChatV1',reader=window.__aiWorkbenchGrokReaderV1;
 const official=()=>location.protocol==='https:'&&['x.com','www.x.com','twitter.com','www.twitter.com'].includes(location.hostname)&&!location.port&&/^\/i\/grok(?:\/|$)/.test(location.pathname);
 const url=()=>{const u=new URL(location.href),id=u.searchParams.get('conversation');u.hash='';u.search='';if(id)u.searchParams.set('conversation',id);return u.href;};
 const hasConversation=value=>{const u=new URL(value);return !!u.searchParams.get('conversation')||/^\/i\/grok\/[^/]+/.test(u.pathname);};
 const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
 const normalize=v=>String(v||'').replace(/\s+/g,' ').trim();
 const excluded='nav,aside,[role="navigation"],[data-testid="tweet"],[data-testid="sidebarColumn"],[role="dialog"]';
 const area=document.querySelector('[data-testid="GrokDrawer"]')||document.querySelector('[data-testid="primaryColumn"]')||document.querySelector('main,[role="main"]');
 // Message rows are stable within one command; do not rescan the full X grid for every button query.
 let rowSnapshot;const all=()=>rowSnapshot??=(reader?.nodes?.()||[]);
 const role=n=>reader.role(n)==='我'?'user':reader.role(n)==='Grok'?'assistant':null;
 const body=n=>reader.cleanText(n).trim();
 const editors=()=>area?[...area.querySelectorAll('textarea,[contenteditable="true"][role="textbox"]')].filter(e=>visible(e)&&!e.closest(excluded)&&!e.disabled&&!e.readOnly&&e.getAttribute('aria-disabled')!=='true'&&!all().some(row=>row.contains(e))):[];
 const editor=()=>editors().length===1?editors()[0]:null;
 const text=e=>e?.value??e?.innerText??'';
 const scope=()=>{let last=null;for(let n=editor()?.parentElement,depth=0;n&&n!==area&&depth<14;n=n.parentElement,depth++){if(all().some(row=>n.contains(row)))break;last=n;if(n.matches('form'))break;}return last;};
 const controls=()=>scope()?[...scope().querySelectorAll('button,[role="button"]')].filter(visible):[];
 const referencedLabels=e=>['aria-labelledby','aria-describedby'].flatMap(attr=>(e.getAttribute(attr)||'').split(/\s+/).filter(Boolean).slice(0,4).map(id=>document.getElementById(id)?.textContent||''));
 const labels=e=>[...referencedLabels(e),e.getAttribute('aria-label'),e.getAttribute('title'),e.getAttribute('data-tooltip'),e.innerText,...[...e.querySelectorAll('svg title,[aria-label],[title]')].flatMap(n=>[n.tagName.toLowerCase()==='title'?n.textContent:'',n.getAttribute('aria-label'),n.getAttribute('title')])].map(normalize).filter(Boolean);
 const label=e=>labels(e)[0]||'';
 const sendLabel=value=>/^(发送|发送消息|发送问题|提交|提交消息|Send|Send message|Send prompt|Submit|Submit message|Ask Grok|Ask Grok a question|问\s*Grok\s*问题)(?:\s*[（(](?:Enter|Return|回车)[）)])?$/i.test(value);
 const stopLabel=value=>/^(停止|停止生成|停止回答|Stop|Stop generating|Stop response)$/i.test(value);
 const sendInfo=()=>{
  const controlsHere=controls(),known='[data-testid="grokSendButton"],[data-testid="grokSubmitButton"]';
  const explicit=controlsHere.filter(e=>!labels(e).some(stopLabel)&&(e.matches(known)||e.querySelector(known)||labels(e).some(sendLabel)));
  // A native submit is evidence only when explicitly declared and owned by the editor's form.
  const form=editor()?.closest('form');
  const submits=form?controlsHere.filter(e=>e.tagName==='BUTTON'&&e.getAttribute('type')==='submit'&&e.form===form&&!labels(e).some(stopLabel)):[];
  return {candidates:explicit.length?explicit:submits,method:explicit.length?'semantic':submits.length?'explicit-form-submit':'none'};
 };
 const sends=()=>sendInfo().candidates;
 const stops=()=>controls().filter(e=>labels(e).some(stopLabel));
 const controlAudit=()=>controls().slice(0,12).map((e,index)=>{
  const token=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,59}$/i.test(value)?value:undefined;
  // Only fixed structural attributes and geometry: no labels, drafts, URLs, or SVG title text.
  return {index,tag:e.tagName.toLowerCase(),type:e.getAttribute('type'),disabled:disabled(e),testId:token(e.getAttribute('data-testid')),
   labelCharacters:labels(e).map(s=>s.length).slice(0,6),sendLabel:labels(e).some(sendLabel),stopLabel:labels(e).some(stopLabel),
   svgCount:e.querySelectorAll('svg').length,icons:[...e.querySelectorAll('svg')].slice(0,2).map(svg=>({viewBox:svg.getAttribute('viewBox'),paths:[...svg.querySelectorAll('path')].slice(0,3).map(n=>{const d=n.getAttribute('d')||'';return /^[MmLlHhVvCcSsQqTtAaZz0-9.,+\s-]+$/.test(d)?d.slice(0,600):'';})}))};
 });
 const generating=()=>stops().length>0||all().some(e=>e.getAttribute('data-is-streaming')==='true'||e.getAttribute('data-generating')==='true');
 const disabled=e=>!e||e.disabled||e.getAttribute('aria-disabled')==='true';
 const probe=()=>{
  const e=editor(),buttons=sends(),pending=!!e&&!normalize(text(e))&&!buttons.length;
  let reason='';
  if(!official())reason='请打开 X 内的 Grok 聊天页面';
  else if(!reader||!area)reason='Grok 读取器未准备好，请重新连接';
  else if(editors().length!==1)reason='未找到唯一的 Grok 输入框，请关闭弹窗后复制连接诊断';
  else if(generating())reason='Grok 正在回答，请稍后再发送';
  else if(normalize(text(e)))reason='Grok 输入框有草稿，请先在原网页处理';
  else if(buttons.length>1)reason='发现多个发送按钮，请复制连接诊断';
  else if(scope()?.querySelector('input[type="file"]')?.files?.length)reason='Grok 输入区有附件，请先在原网页处理';
  return {url:url(),ready:!reason,reason,note:pending?'已连接输入区；发送时检查发送按钮。':'',diagnostics:{version:'0.10.1',sendButtonMethod:sendInfo().method,composerControls:controlAudit(),lastSendAttempt:window[key]?.diagnostics||null,platform:'grok-x',ready:!reason,reason,editor:!!e,editorCandidates:editors().length,composerFound:!!scope(),composerButtons:controls().length,sendButton:buttons.length===1,sendButtonCandidates:buttons.length,sendButtonPending:pending,stopButton:stops().length>0,rows:all().length,humanRows:all().filter(n=>role(n)==='user').length,aiRows:all().filter(n=>role(n)==='assistant').length,unknownRows:all().filter(n=>!role(n)).length,readyState:document.readyState}};
 };
 if(input.command==='probe')return probe();
 if(input.command==='release'){if(window[key])window[key].cancelled=true;return probe();}
 if(input.command==='history'){
  if(!official()||url()!==input.url)return {url:url(),messages:[],error:'Grok 对话已切换，请重新连接'};
  if(generating())return {url:url(),messages:[],error:'请等待 Grok 回答完成后同步'};
  const rows=all(),messages=rows.map(n=>({role:role(n),content:body(n)}));
  if((!rows.length&&hasConversation(url()))||messages.some(m=>!m.role||!m.content))return {url:url(),messages:[],error:'部分 Grok 历史消息无法识别，请复制连接诊断'};
  if(messages.length>1000||messages.reduce((sum,m)=>sum+m.content.length,0)>400000)return {url:url(),messages:[],error:'Grok 已加载历史超过同步容量'};
  return {url:url(),messages};
 }
 let state=window[key];
 const result=(phase,error)=>({phase,error,content:state?.content||'',url:state?.url||input.url||url()});
 const fail=error=>{if(state)state.error=error;return result('failed',error);};
 if(input.command==='begin'){
  if(state?.id===input.job.id)return state.error?fail(state.error):result(state.finished?'complete':state.cancelled?'failed':'waiting');
  if(state&&!state.finished&&!state.cancelled&&!state.error)return fail('已有未完成的 Grok 接收任务');
  if(!official()||url()!==input.job.url)return {phase:'failed',content:'',url:input.job.url,error:'Grok 对话已切换，没有发送'};
  if(input.job.images?.length)return {phase:'failed',content:'',url:input.job.url,error:'Grok 当前仅支持文字提问，请在原网页发送图片'};
  const p=probe();if(!p.ready)return {phase:'failed',content:'',url:input.job.url,error:p.reason};
  const rows=all();if(rows.some(n=>!role(n))||(!rows.length&&hasConversation(url())))return {phase:'failed',content:'',url:input.job.url,error:'无法确认 Grok 当前消息位置，请复制连接诊断'};
  const e=editor();state=window[key]={id:input.job.id,url:url(),initialUrl:url(),prompt:normalize(input.job.text),previous:rows.filter(n=>role(n)==='user').map(n=>normalize(body(n))),content:'',created:Date.now(),changed:Date.now(),clicked:false};
  try{
   e.focus();
   if(e.tagName==='TEXTAREA'){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,input.job.text);e.dispatchEvent(new Event('input',{bubbles:true}));}
   else{const selection=getSelection(),range=document.createRange();range.selectNodeContents(e);selection.removeAllRanges();selection.addRange(range);document.execCommand('insertText',false,input.job.text);}
   const waitStarted=Date.now();
   for(let i=0;i<15&&Date.now()-waitStarted<2500;i++){
    if(state.cancelled||url()!==state.initialUrl)return fail('填写时对话已切换或任务已停止，没有点击发送');
    const buttons=sends();if(buttons.length===1&&!disabled(buttons[0]))break;
    await new Promise(resolve=>setTimeout(resolve,100));
   }
   if(state.cancelled||url()!==state.initialUrl||!e.isConnected||editor()!==e||normalize(text(e))!==state.prompt)return fail('问题未完整填写或页面已变化，没有点击发送');
   const info=sendInfo(),buttons=info.candidates;state.diagnostics={clicked:false,buttonCandidates:buttons.length,method:info.method,waitMs:Date.now()-waitStarted,controls:controlAudit()};
   if(buttons.length!==1||disabled(buttons[0])||generating())return fail('未识别到可用的 Grok 发送按钮；已保留网页草稿，请复制连接诊断');
   state.clicked=true;state.diagnostics.clicked=true;buttons[0].click();state.sawGenerating=generating();return result('waiting');
  }catch{return fail('Grok 发送状态不确定，请核对原网页；不会自动重发');}
 }
 if(!state||state.id!==input.jobId)return {phase:'failed',content:'',url:input.url,error:'Grok 页面状态已丢失，请核对网页；不会自动重发'};
 if(input.command==='cancel'){state.cancelled=true;return result('failed','已停止接收');}
 if(state.error)return fail(state.error);if(state.cancelled)return result('failed','已停止接收');if(state.finished)return result('complete');
 if(!official()||new URL(url()).origin!==new URL(state.initialUrl).origin)return fail('已离开原 Grok 网页');
 if(url()!==state.url&&(state.locked||hasConversation(state.initialUrl)||state.previous.length))return fail('Grok 对话已切换，已停止接收');
 const rows=all(),humans=rows.filter(n=>role(n)==='user'),questions=humans.map(n=>normalize(body(n)));
 let human=state.human?.isConnected&&humans.includes(state.human)&&normalize(body(state.human))===state.prompt?state.human:null;
 if(!human){
  let overlap=0;
  for(let count=Math.min(state.previous.length,questions.length);count>0;count--){
   if(state.previous.slice(-count).every((q,j)=>q===questions[j])){overlap=count;break;}
  }
  if((!state.previous.length||overlap>0)&&overlap<questions.length&&questions[overlap]===state.prompt)human=humans[overlap];
 }
 if(!human){if(Date.now()-state.created>30000)return fail('未找到本次提问，请核对 Grok 网页；不会自动重发');return result('waiting');}
 state.human=human;state.url=url();state.locked=true;
 const after=rows.slice(rows.indexOf(human)+1);if(after.some(n=>role(n)==='user'))return fail('网页出现另一条提问，已停止接收');
 if(after.some(n=>!role(n))||after.length>1)return fail('Grok 回答结构不明确，请查看原网页');
 state.sawGenerating ||= generating();
 const answer=after[0];if(!answer)return result('waiting');
 const content=body(answer);if(content.length>500000)return fail('回答超过接收容量');
 if(content!==state.content){state.content=content;state.changed=Date.now();}
 const completed=answer.getAttribute('data-is-streaming')==='false'||answer.getAttribute('data-generating')==='false'||[...answer.querySelectorAll('button,[role="button"]')].some(e=>visible(e)&&/^(复制|复制文本|复制回答|Copy|Copy text|Copy response)$/i.test(label(e)))||state.sawGenerating;
 if(content&&completed&&!generating()&&Date.now()-state.changed>=2500){state.finished=true;return result('complete');}
 return result(content?'streaming':'waiting');
}
