import {fileURLToPath} from 'node:url';
import {parseHTML} from 'linkedom';
import {Readability} from '@mozilla/readability';
const tidy=s=>String(s||'').replace(/\u0000/g,'').replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
function htmlText(html){
 const {document}=parseHTML(html);
 for(const el of document.querySelectorAll('script,style,noscript,svg,canvas,nav,footer,header,form,button,input,textarea,[hidden],[aria-hidden="true"],ix\\:hidden'))el.remove();
 let article;try{article=new Readability(document.cloneNode(true),{maxElemsToParse:60000,charThreshold:120,disableJSONLD:true}).parse();}catch{}
 // Filings rely on tables. Keep the cleaned body if reader mode drops substantial content.
 const original=document.querySelector('main,article')||document.body;
 let root=original;
 if(article?.content&&article.textContent.length>=(original?.textContent.length||0)*0.7)root=parseHTML('<html><body>'+article.content+'</body></html>').document.body;
 let cells=0;
 const walk=node=>{
  if(node.nodeType===3)return node.textContent;
  if(node.nodeType!==1)return '';
  const tag=node.localName.toLowerCase();
  if(tag==='table'){
   const rows=[...node.querySelectorAll('tr')].filter(r=>r.closest('table')===node).map(r=>[...r.children].filter(c=>/^(td|th)$/.test(c.localName)).map(c=>{if(++cells>50000)throw Error('网页表格超过读取容量');return tidy(c.textContent).replace(/\|/g,'\\|').replace(/\n/g,' ');}));
   if(!rows.length)return '';
   const width=Math.max(...rows.map(r=>r.length));if(width>256)throw Error('网页表格列数过多');
   const line=row=>'| '+Array.from({length:width},(_,i)=>row[i]||'').join(' | ')+' |';
   return '\n\n'+[line(rows[0]),'| '+Array(width).fill('---').join(' | ')+' |',...rows.slice(1).map(line)].join('\n')+'\n\n';
  }
  if(tag==='br')return '\n';
  const text=[...node.childNodes].map(walk).join('');
  if(/^h[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+tidy(text)+'\n\n';
  if(tag==='li')return '\n- '+tidy(text);
  return /^(p|div|section|article|main|ul|ol|pre|blockquote|hr)$/.test(tag)?'\n'+text+'\n':text;
 };
 const content=tidy(root?walk(root):document.textContent);
 if(!content||content.length<25)throw Error('网页没有足够的可读正文，可能需要登录或由脚本加载；请复制正文或添加下载的文件');
 if(/^(access denied|just a moment|request rejected|checking your browser|your request originates from an undeclared automated tool)/i.test(content.slice(0,180)))throw Error('网站拒绝自动读取，请在浏览器打开后复制正文或下载文件');
 return {title:tidy(article?.title||document.title||'网页'),content,format:'html'};
}
async function pdfText(bytes,limit){
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(bytes),standardFontDataUrl:fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url)).replaceAll('\\','/'),cMapUrl:fileURLToPath(new URL('../node_modules/pdfjs-dist/cmaps/',import.meta.url)).replaceAll('\\','/'),cMapPacked:true,useSystemFonts:false,disableFontFace:true,useWorkerFetch:false,useWasm:false,isEvalSupported:false,stopAtErrors:true});
 let doc;
 try{
  doc=await task.promise;
  if(doc.numPages>500)throw Error('PDF 超过 500 页，请下载后拆分文件');
  const parts=[];let count=0,pagesRead=0,partial=false;
  for(let n=1;n<=doc.numPages;n++){
   const page=await doc.getPage(n),text=await page.getTextContent();let lastY=null,line='',lines=[];
   for(const item of text.items){if(!('str' in item))continue;const y=item.transform?.[5];if(lastY!==null&&Math.abs(y-lastY)>3&&line){lines.push(line);line='';}line+=(line?'  ':'')+item.str;if(item.hasEOL){lines.push(line);line='';}lastY=y;}
   if(line)lines.push(line);const value='[第 '+n+' 页]\n'+lines.join('\n');parts.push(value);count+=value.length+2;pagesRead=n;page.cleanup();
   if(count>limit){partial=true;break;}
  }
  const content=parts.join('\n\n');
  if(!parts.some(p=>p.replace(/^\[第 \d+ 页\]/,'').trim()))throw Error('PDF 未提取到文字，可能是扫描件；当前不支持 OCR');
  return {title:'PDF 文档',content,format:'pdf',pages:doc.numPages,pagesRead,partial};
 }catch(e){if(e.name==='PasswordException')throw Error('PDF 已加密，请先解密再添加');throw e;}finally{await task.destroy();}
}
export async function extractLinkDocument({bytes,type,url='',limit=40000}){
 limit=Math.min(100000,Math.max(1000,Number(limit)||40000));
 const result=type==='pdf'?await pdfText(bytes,limit):type==='text'?{title:'文字文档',content:tidy(new TextDecoder('utf-8').decode(bytes)),format:'text'}:htmlText(new TextDecoder('utf-8').decode(bytes));
 if(!result.content.trim())throw Error('文档没有可读取的文字');
 const characters=result.content.length;
 if(characters>limit){result.content=result.content.slice(0,limit);result.partial=true;}
 return {...result,url,characters,notice:result.partial?'仅提取部分内容（最多 '+limit.toLocaleString()+' 字符），请勿视为完整报告。':''};
}
