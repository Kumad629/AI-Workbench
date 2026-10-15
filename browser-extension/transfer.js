// Shared with desktop validation; this file is shipped inside the extension.
export const MAX_ARCHIVE_CHARACTERS=10000000;
export const CAPTURE_CHUNK_CHARACTERS=60000;
export function splitCaptureText(text){
  if(typeof text!=='string'||!text.trim())throw new Error('对话内容不能为空');
  if(text.length>MAX_ARCHIVE_CHARACTERS)throw new Error('本次对话超过 1000 万字符，请缩小读取范围');
  const chunks=[];
  for(let start=0;start<text.length;){
    let end=Math.min(start+CAPTURE_CHUNK_CHARACTERS,text.length);
    if(end<text.length){
      const boundary=text.lastIndexOf('\n\n',end-2);
      if(boundary>start+CAPTURE_CHUNK_CHARACTERS/2)end=boundary+2;
      if(end>start&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;
    }
    chunks.push(text.slice(start,end));start=end;
  }
  return chunks;
}
export async function uploadCapture(request,capture,onProgress=()=>{}){
  const chunks=splitCaptureText(capture.content);
  const {content,...metadata}=capture;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content));
  metadata.contentHash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  const ready=await request('/status');
  if(capture.product==='YouTube 提问'&&!ready.capabilities?.includes('youtubeAskCaptureV1'))throw new Error('请退出并重新打开 v0.13.0 或更新的 AI Workbench，再保存 YouTube 提问记录');
  if(capture.product==='Grok'&&!ready.capabilities?.includes('grokXCaptureV1'))throw new Error('请退出并重新打开 v0.4.0 或更新的 AI Workbench，再保存 Grok 对话');
  if(!ready.capabilities?.includes('chunkedCaptureV1'))throw new Error('请退出并重新打开新版 AI Workbench，再保存长对话');
  const begin=await request('/capture/start',{...metadata,parts:chunks.length,characters:content.length});
  if(begin.conversationId)return begin;
  for(let index=begin.nextIndex;index<chunks.length;index++){
    onProgress(index,chunks.length);
    // Replaying a chunk after a lost response is safe: the desktop compares its content.
    let error;
    for(let attempt=0;attempt<3;attempt++){
      try{await request('/capture/chunk',{requestId:capture.requestId,index,text:chunks[index]});error=null;break;}
      catch(e){error=e;if(e.permanent)break;}
    }
    if(error)throw error;
  }
  onProgress(chunks.length,chunks.length);
  return request('/capture/commit',{requestId:capture.requestId});
}
