// Runs only after the user clicks Read, in the explicitly selected tab.
export function captureGeminiPage() {
  const selected=window.getSelection()?.toString().trim();
  const turns=[...document.querySelectorAll('user-query, model-response')].filter(node=>node.getClientRects().length>0);
  let content,scope;
  if(selected){content=selected;scope='选中的文字';}
  else if(turns.length){content=turns.map(node=>(node.tagName.toLowerCase()==='user-query'?'我：':'Gemini：')+'\n'+node.innerText.trim()).join('\n\n');scope='当前页面已加载的对话';}
  else {const main=document.querySelector('main, [role="main"]');content=(main?.innerText||'').trim();scope='页面正文（未识别到对话结构，请检查预览）';}
  if(!content)throw new Error('没有读到对话。请先打开一条 Gemini 历史对话，也可以选中要保存的文字后再读取。');
  if(content.length>10000000)throw new Error('对话超过 1000 万字符，请缩小读取范围。');
  return {title:document.title.replace(/\s*[-–—]\s*Google Gemini\s*$/i,'').slice(0,150),content,url:location.href,scope};
}
