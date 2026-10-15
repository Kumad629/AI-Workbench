// Injected into the selected site's isolated world. No account data or private API access.
export async function prepareWebImages(input){
 const key='__awbImageUploadV1',job=input.job;
 const current=()=>{const u=new URL(location.href);u.hash='';return u.href;};
 const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
 const fail=error=>{const d=window[key]?.id===job?.id?window[key]?.diagnostics:null;if(d&&d.stage!=='timeout')d.stage='failed';return {ok:false,error};};
 if(!job?.id||current()!==job.url)return fail('图片上传前会话已变化，没有发送');
 if(!['yuanbao','doubao'].includes(input.provider))return fail('不支持此图片上传页面');
 const host=input.provider==='yuanbao'?location.hostname==='yuanbao.tencent.com':['www.doubao.com','doubao.com'].includes(location.hostname);
 if(location.protocol!=='https:'||!host)return fail('请打开对应的官方聊天网页');
 const existing=window[key];
 if(existing?.id===job.id)return existing.ready?{ok:true}:fail('本次图片已经尝试上传，请检查网页草稿；不会重复上传');
 if(!Array.isArray(job.images)||job.images.length<1||job.images.length>3)return fail('图片数量无效');
 const selector=input.provider==='yuanbao'?'.chat-input-editor .ql-editor,.chat-input-editor textarea,.agent-input-text-area .ql-editor,.yb-im-input-editor,.yb-im-input-editor [contenteditable],.chat-command-editor-specail [contenteditable],.chat-command-editor-specail textarea,[data-input-main-content] [contenteditable],[data-input-main-content] textarea':'textarea[data-testid="chat_input_input"],[data-testid="chat_input_input"] textarea,[data-testid="chat_input_input"][contenteditable="true"],[data-testid="chat_input_input"] [contenteditable="true"]';
 let editors=[...document.querySelectorAll(selector)].filter(e=>visible(e)&&(e.tagName==='TEXTAREA'?!e.disabled&&!e.readOnly:e.isContentEditable));
 editors=editors.filter(e=>!editors.some(p=>p!==e&&p.contains(e)));
 if(editors.length!==1)return fail('无法确定图片要发送到哪个输入框');
 const editor=editors[0],text=()=>String(editor.value??editor.innerText??'').trim();
 if(text())return fail('网页存在未发送草稿，请先处理；没有上传图片');
 const rows='[data-conv-idx][data-conv-speaker],[data-testid="send_message"],[data-testid="receive_message"],[class*="bg-g-send-msg-bubble"],[class*="bg-g-receive-msg-bubble"]';
 let scope=null,composerExplicit=false;
 for(let p=editor.parentElement,depth=0;p&&depth<16;p=p.parentElement,depth++){
  if(p.matches('main,body,html')||p.querySelector(rows))break;
  scope=p;
  if(input.provider==='doubao'&&p.matches('[data-testid="chat_input"],.chat-input,.chat-editor,form,[role="form"]')){
   composerExplicit=true;break;
  }
 }
 if(!scope)return fail('未找到网页图片输入区');
 const attachments='[class*="text-area__attachment"],[data-input-resource-area],[data-testid="chat_input_attachment"],[data-testid="chat_input_file"],[data-testid="chat_input_image"]';
 const baseline=new Set(scope.querySelectorAll('img'));
 if([...scope.querySelectorAll(attachments)].some(e=>visible(e)&&(e.querySelector('img')||e.textContent.trim()))||[...scope.querySelectorAll('input[type="file"]')].some(e=>e.files?.length))return fail('网页已有待发送附件，请先处理');
 const diagnostics={stage:'prepare',composerExplicit,fileInputs:scope.querySelectorAll('input[type="file"]').length,imageInputs:0,strategy:'none',previewCount:0,uploading:false};
 const state=window[key]={id:job.id,url:job.url,ready:false,count:job.images.length,created:Date.now(),diagnostics};
 try{
  const transfer=new DataTransfer();
  for(const [i,image]of job.images.entries()){
   const m=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl||'');
   if(!m||image.dataUrl.length>2800000)return fail('图片格式或大小无效');
   const raw=atob(m[2]),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
   transfer.items.add(new File([bytes],image.name||('image-'+i+'.png'),{type:m[1]}));
  }
  const inputs=[...scope.querySelectorAll('input[type="file"]')].filter(e=>!e.disabled&&/image|\.png|\.jpe?g|\.webp/i.test(e.accept||''));
  diagnostics.imageInputs=inputs.length;
  if(inputs.length===1){
   if(job.images.length>1&&!inputs[0].multiple)return fail('此网页入口一次只能上传一张图片');
   diagnostics.strategy='file-input';
   inputs[0].files=transfer.files;inputs[0].dispatchEvent(new Event('change',{bubbles:true}));
  }else{
   // Ambiguous file pickers may belong to other features. Paste once into the
   // verified chat editor instead; never try a second path after partial upload.
   diagnostics.strategy='composer-paste';
   editor.focus();editor.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,composed:true,clipboardData:transfer}));
  }
  diagnostics.stage='await-preview';
  let stable=0;
  for(let i=0;i<100;i++){
   await new Promise(resolve=>setTimeout(resolve,200));
   if(current()!==job.url||!editor.isConnected||window[key]!==state)return fail('图片上传期间会话或输入框变化；没有发送');
   if(text())return fail('上传期间网页草稿发生变化；没有发送，请检查网页');
   if([...document.querySelectorAll('[role="dialog"],.t-dialog,.semi-modal-content')].some(visible))return fail('网页出现弹窗，请处理后再试；没有发送');
   const failed=[...scope.querySelectorAll('[role="alert"],[class*="upload-error"],[class*="uploadError"]')].some(e=>visible(e)&&/失败|错误|超限|过大|failed|error/i.test(e.textContent));
   if(failed)return fail('网页提示图片上传失败，请检查原网页；没有发送');
   const previews=[...scope.querySelectorAll('img')].filter(e=>!baseline.has(e)&&visible(e)&&e.complete&&e.naturalWidth>0&&e.getAttribute('src'));
   const uploading=[...scope.querySelectorAll('[aria-busy="true"],[role="progressbar"],[class*="uploading"],.t-loading,.semi-spin')].some(visible);
   diagnostics.previewCount=previews.length;diagnostics.uploading=uploading;
   if(previews.length>=job.images.length&&!uploading){stable++;if(stable>=5){state.ready=true;diagnostics.stage='ready';return {ok:true};}}else stable=0;
  }
  diagnostics.stage='timeout';
  return fail(diagnostics.strategy==='composer-paste'?'已向聊天输入框粘贴图片，但未确认上传完成；没有发送，请查看原网页并复制连接诊断':'未能确认图片上传完成；没有发送，请在原网页检查附件');
 }catch{return fail('图片上传未完成，请核对网页附件；不会自动重复上传');}
}
