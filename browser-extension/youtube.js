// DOM-only, read-only adapter. Selectors verified against YouTube's public web bundle
// 2026-10-08 (see YOUTUBE_CAPTURE_NOTES.zh-CN.md). Never reads app stores or sends prompts.
export function installYouTubeReader() {
 const version='0.11.0',key='__aiWorkbenchYouTubeReaderV1';
 const rowSelector='yt-chat-user-turn-view-model, you-chat-item-view-model, yt-chat-item-view-model';
 const panelSelector='ytd-engagement-panel-section-list-renderer';
 const visible=node=>!!node?.getClientRects().length&&!node.closest('[hidden], [aria-hidden="true"], [visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"]')&&getComputedStyle(node).visibility!=='hidden';
 const panels=()=>[...document.querySelectorAll(panelSelector)].filter(p=>visible(p)&&(
  ['engagement-panel-youchat','PAyouchat'].includes(p.getAttribute('target-id'))||
  ['engagement-panel-youchat','PAyouchat'].includes(p.getAttribute('panel-identifier'))||
  (p.querySelector('yt-chat-input-view-model')&&p.querySelector(rowSelector))));
 const panel=()=>{const list=panels();return list.length===1?list[0]:null;};
 const exclude='button, [role="button"], input, textarea, svg, script, style, [hidden], [aria-hidden="true"], yt-chat-input-view-model, yt-chat-loading-view-model, yt-suggested-prompt-view-model, .ytwYouChatChipsDataChipWrapper, .ytwYouChatChipsDataChip, .chatInputViewModelChatDisclaimer, yt-response-actions-view-model, yt-disclaimer-item-view-model';
 const walk=node=>{
  if(node.nodeType===3)return node.textContent||'';
  if(node.nodeType!==1||node.matches(exclude))return '';
  const tag=node.tagName.toLowerCase();
  if(tag==='br')return '\n';
  if(tag==='pre'){const code=node.textContent||'';const fence='`'.repeat(Math.max(3,...[...code.matchAll(/`+/g)].map(x=>x[0].length+1)));return '\n\n'+fence+'\n'+code+'\n'+fence+'\n\n';}
  const text=[...node.childNodes].map(walk).join('');
  if(tag==='a'){try{const url=new URL(node.getAttribute('href'),location.href);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)return '['+text.replace(/\]/g,'\\]')+']('+url.href.replace(/\)/g,'%29')+')';}catch{}return text;}
  if(tag==='strong'||tag==='b')return '**'+text+'**';
  if(tag==='code')return '`'+text+'`';
  if(/^h[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+text+'\n\n';
  if(tag==='li')return '\n- '+text.trim()+'\n';
  if(tag==='tr')return '\n'+[...node.children].map(walk).map(s=>s.trim()).join(' | ')+'\n';
  return ['p','div','section','ul','ol','blockquote','table'].includes(tag)?'\n'+text+'\n':text;
 };
 const cleanText=node=>{
  // Restrict assistant capture to actual answer markdown, excluding chips, feedback,
  // disclaimers and video shelves even when these share the same outer row component.
  const body=node.matches('yt-chat-user-turn-view-model')
   ?[...node.querySelectorAll('.ytChatUserTurnViewModelTextContainer')]
   :[...node.querySelectorAll('markdown-div, .ytwMarkdownDivHost')].filter(n=>!n.parentElement?.closest('markdown-div, .ytwMarkdownDivHost'));
  return body.map(walk).join('\n\n').replace(/\n{3,}/g,'\n\n').trim();
 };
 const nodes=()=>{const p=panel();return p?[...p.querySelectorAll(rowSelector)].filter(n=>visible(n)&&!n.parentElement?.closest(rowSelector)&&!!cleanText(n)):[];};
 const role=node=>node.matches('yt-chat-user-turn-view-model')?'我':'YouTube';
 const title=()=>((document.querySelector('ytd-watch-metadata h1, h1.ytd-watch-metadata, #title h1')?.textContent||document.title).replace(/\s*[-–—]\s*YouTube\s*$/i,'').trim()+' · 提问').slice(0,150);
 const scroller=first=>{
  const p=panel();if(!p)return null;
  let candidate=null;
  for(let n=first.parentElement;n&&p.contains(n);n=n.parentElement){
   if(n.clientHeight>0&&/auto|scroll/.test(getComputedStyle(n).overflowY)){candidate ||= n;if(n.scrollHeight>n.clientHeight+2)return n;}
   if(n===p)break;
  }
  // A short conversation may fit completely. Still never scroll the watch page.
  return candidate||p;
 };
 const diagnose=()=>{const p=panel(),rows=nodes();return {readerVersion:version,platform:'youtube-ask',panelCandidates:panels().length,panelFound:!!p,
  questions:rows.filter(n=>role(n)==='我').length,answers:rows.filter(n=>role(n)==='YouTube').length,
  rawRows:p?.querySelectorAll(rowSelector).length||0,markdownBlocks:p?.querySelectorAll('markdown-div, .ytwMarkdownDivHost').length||0,
  panelTags:p?[...new Set([...p.querySelectorAll('*')].map(n=>n.localName).filter(n=>n.includes('-')))].slice(0,50):[],
  iframes:document.querySelectorAll('iframe').length,readyState:document.readyState};};
 window[key]={version,panel,nodes,role,cleanText,title,scroller,diagnose};
 return {ready:!!panel(),diagnostics:diagnose(),error:panels().length>1?'发现多个提问面板，请只保留目标面板后重试':'请先打开视频右侧的「提问 / Ask」面板，并保留已有问答'};
}

export function captureYouTubePage(){
 const adapter=window.__aiWorkbenchYouTubeReaderV1;
 const diagnostics=adapter?.diagnose?.()||{platform:'youtube-ask',readerVersion:'0.11.0'};
 try{
  if(!adapter?.panel())throw new Error('请先打开 YouTube 视频右侧的提问面板后重试');
  const selected=window.getSelection(),panel=adapter.panel();let content,scope;
  if(selected?.toString().trim()){
   if(!panel.contains(selected.anchorNode)||!panel.contains(selected.focusNode))throw new Error('选中的文字不完全位于提问面板内，请取消选择或只选中问答内容');
   content=selected.toString().trim();scope='YouTube 提问面板内选中的文字（请自行核对发言者与首尾）';
  }else{
   const rows=adapter.nodes();
   if(!rows.length)throw new Error('尚未识别到提问面板的问答消息，请复制读取诊断；也可只选中面板中的问答后读取');
   content=rows.map(n=>adapter.role(n)+'：\n'+adapter.cleanText(n)).join('\n\n');
   scope='YouTube 提问面板当前已加载的 '+rows.length+' 条消息；更早未加载的内容不在本次范围内。关闭视频前请先保存。';
  }
  if(content.length>10000000)throw new Error('内容超过读取容量，请缩小选择范围');
  return {title:adapter.title(),url:location.href,product:'YouTube 提问',content,scope,diagnostics};
 }catch(error){return {phase:'error',error:error.message,diagnostics};}
}
