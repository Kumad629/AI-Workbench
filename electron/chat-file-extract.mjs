import {unzipSync} from 'fflate';
import {DOMParser} from '@xmldom/xmldom';
import {posix} from 'node:path';

export const textExtensions=new Set(['md','markdown','mdown','txt','csv','tsv']);
export const officeExtensions=new Set(['doc','docx','xls','xlsx','ppt','pptx','pdf']);
export function validateChatFile(input){
 const {name,bytes}=input||{};
 if(typeof name!=='string'||!name||name.length>260||/[\\/\0\r\n]/.test(name))throw new Error('文件名无效');
 const extension=name.split('.').at(-1).toLowerCase();
 if(!textExtensions.has(extension)&&!officeExtensions.has(extension))throw new Error('支持 MD、TXT、CSV、Word（doc/docx）、Excel（xls/xlsx）、PowerPoint（ppt/pptx）和 PDF');
 if(!(bytes instanceof Uint8Array)||!bytes.byteLength)throw new Error(name+' 是空文件或文件数据无效');
 const sizeLimit=textExtensions.has(extension)?1024*1024:10*1024*1024;
 if(bytes.byteLength>sizeLimit)throw new Error(name+' 超过 '+(textExtensions.has(extension)?'1':'10')+' MB，请拆分后添加');
 const limit=Number.isInteger(input.limit)&&input.limit>0?Math.min(input.limit,100000):100000;
 return {name,bytes,extension,limit};
}
const clean=text=>String(text||'').replace(/\r\n?/g,'\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
const children=n=>Array.from(n?.childNodes||[]).filter(n=>n.nodeType===1);
const local=n=>n.localName||n.nodeName.split(':').at(-1);
const descendants=(node,name)=>Array.from(node.getElementsByTagNameNS('*',name));
const cell=value=>clean(value).trim().replace(/\|/g,'\\|').replace(/\n/g,'<br>');
function table(rows){
 if(!rows.length)return '';
 if(rows.length>10000)throw new Error('表格超过 10,000 行，请拆分文件');
 const width=Math.max(...rows.map(row=>row.length));if(!width)return '';if(width>256)throw new Error('表格超过 256 列，请拆分文件');
 const render=row=>'| '+Array.from({length:width},(_,i)=>cell(row[i]||'')).join(' | ')+' |';
 return [render(rows[0]),'| '+Array(width).fill('---').join(' | ')+' |',...rows.slice(1).map(render)].join('\n');
}
function output(limit){let size=0;const pieces=[];return {add(value){if(!value)return;size+=value.length+2;if(size>limit)throw new Error('提取的文件内容超过 '+limit.toLocaleString()+' 字符，请拆分文件后添加；未截断内容。');pieces.push(value);},value:()=>pieces.join('\n\n')};}
function zipParts(bytes,extension){
 if(bytes[0]!==0x50||bytes[1]!==0x4b)throw new Error('文件不是有效的 Office 文档，可能已加密或文件后缀不符，请另存为未加密文件');
 let count=0,total=0;const seen=new Set();
 try{return unzipSync(bytes,{filter:info=>{
  if(++count>10000||seen.has(info.name)||info.name.split('/').includes('..'))throw new Error('Office 压缩包目录异常');seen.add(info.name);
  total+=info.originalSize;if(total>64*1024*1024)throw new Error('Office 文档解压后超过 64 MB，请拆分文件');
  const wanted=extension==='docx'?/^word\/(?:document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/.test(info.name):extension==='pptx'?/^ppt\/(?:presentation\.xml|_rels\/presentation\.xml\.rels|slides\/(?:slide[^/]+\.xml|_rels\/slide[^/]+\.xml\.rels)|notesSlides\/notesSlide[^/]+\.xml)$/.test(info.name):false;
  if(wanted&&info.originalSize>8*1024*1024)throw new Error('Office 文档单个正文部分超过 8 MB，请拆分文件');
  return wanted;
 }});}catch(e){if(/超过|异常/.test(e.message))throw e;throw new Error('Office 文件损坏、已加密或压缩格式无法读取');}
}
function xml(bytes){
 if(!bytes)throw new Error('Office 文件缺少必要的正文或目录');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('Office 文件含不支持的 XML 实体声明');
 return new DOMParser({onError:()=>{throw new Error('Office XML 结构损坏');}}).parseFromString(text,'application/xml');
}
function wordText(n){
 const tag=local(n);if(['del','instrText','drawing','pict','object'].includes(tag))return '';
 if(tag==='t')return n.textContent||'';if(tag==='tab')return '\t';if(tag==='br'||tag==='cr')return '\n';
 return children(n).map(wordText).join('');
}
function wordBlocks(node,emit){
 for(const child of children(node)){
  const tag=local(child);
  if(tag==='p')emit(wordText(child));
  else if(tag==='tbl')emit(table(children(child).filter(n=>local(n)==='tr').map(row=>children(row).filter(n=>local(n)==='tc').map(c=>{const parts=[];wordBlocks(c,v=>parts.push(v));return parts.join('\n');}))));
  else if(!['del','drawing','pict','object'].includes(tag))wordBlocks(child,emit);
 }
}
function readDocx(parts,limit){
 const out=output(limit),doc=xml(parts['word/document.xml']),body=descendants(doc,'body')[0];if(!body)throw new Error('Word 文件没有正文');
 wordBlocks(body,value=>out.add(value));let count=out.value().trim().length;
 const labels={header:'页眉',footer:'页脚',footnotes:'脚注',endnotes:'尾注',comments:'批注'};
 for(const path of Object.keys(parts).filter(p=>p!=='word/document.xml').sort()){
  const extra=output(limit);wordBlocks(xml(parts[path]).documentElement,value=>extra.add(value));const text=extra.value().trim();
  if(text){count+=text.length;out.add('## '+labels[path.match(/word\/([a-z]+)/)[1]]+'\n\n'+text);}
 }
 if(!count)throw new Error('文件中没有可读取的文字；图片或扫描内容暂不识别');return out.value();
}
function relationships(parts,path){
 const result=new Map();for(const rel of descendants(xml(parts[path]),'Relationship'))if(rel.getAttribute('TargetMode')!=='External')result.set(rel.getAttribute('Id'),rel.getAttribute('Target'));return result;
}
function resolvePart(base,target){if(!target)throw new Error('PPT 缺少幻灯片引用');const result=posix.normalize(target.startsWith('/')?target.slice(1):posix.join(posix.dirname(base),target));if(!result.startsWith('ppt/')||result.includes('..'))throw new Error('PPT 引用路径无效');return result;}
function slideText(node){
 const tag=local(node);if(tag==='t')return node.textContent||'';if(tag==='br')return '\n';return children(node).map(slideText).join('');
}
function readPptx(parts,limit){
 const out=output(limit),order=descendants(xml(parts['ppt/presentation.xml']),'sldId'),rels=relationships(parts,'ppt/_rels/presentation.xml.rels');let textCount=0;
 if(!order.length||order.length>500)throw new Error('PPT 没有可读幻灯片或超过 500 页');
 for(const [index,ref] of order.entries()){
  const relId=Array.from(ref.attributes).find(a=>a.localName==='id'&&a.prefix)?.value;
  const path=resolvePart('ppt/presentation.xml',rels.get(relId)),doc=xml(parts[path]),lines=[];
  const visit=node=>{for(const n of children(node)){if(local(n)==='tbl'){lines.push(table(descendants(n,'tr').map(row=>children(row).filter(c=>local(c)==='tc').map(c=>descendants(c,'p').map(slideText).join('\n')))));}else if(local(n)==='p')lines.push(slideText(n));else visit(n);}};
  visit(doc.documentElement);let text=lines.filter(v=>v.trim()).join('\n\n');textCount+=text.length;out.add('## 第 '+(index+1)+' 页'+(doc.documentElement.getAttribute('show')==='0'?'（隐藏）':'')+'\n\n'+(text||'（本页没有可提取文字）'));
  const relPath=posix.join(posix.dirname(path),'_rels',posix.basename(path)+'.rels');
  if(parts[relPath]){const notes=[...relationships(parts,relPath).values()].filter(t=>/notesSlides\//.test(t));for(const note of notes){const noteDoc=xml(parts[resolvePart(path,note)]),notesText=descendants(noteDoc,'sp').filter(sp=>!descendants(sp,'ph').some(ph=>['sldImg','sldNum','dt','ftr','hdr'].includes(ph.getAttribute('type')))).flatMap(sp=>descendants(sp,'p').map(slideText)).filter(Boolean).join('\n');if(notesText.trim()){textCount+=notesText.length;out.add('演讲者备注：\n'+notesText);}}}
 }
 if(!textCount)throw new Error('PPT 中没有可读取的文字；图片或扫描内容暂不识别');return out.value();
}
async function readSpreadsheet(bytes,limit){
 const XLSX=await import('xlsx'),workbook=XLSX.read(bytes,{type:'buffer',cellText:true,cellFormula:true,bookVBA:false,bookFiles:false});
 if(!workbook.SheetNames.length||workbook.SheetNames.length>100)throw new Error('Excel 没有可读工作表或超过 100 张');
 const out=output(limit);let textCount=0;
 for(const name of workbook.SheetNames){
  const sheet=workbook.Sheets[name],rows=new Map(),columns=new Set(),keys=Object.keys(sheet).filter(key=>/^[A-Z]+[1-9][0-9]*$/.test(key));
  if(keys.length>50000)throw new Error('Excel 有效单元格超过 50,000 个，请拆分文件');
  for(const key of keys){const c=sheet[key];if(c.v===undefined&&!c.f)continue;const {r,c:column}=XLSX.utils.decode_cell(key);let value=c.w??(c.v===undefined?'':String(c.v));if(c.f)value+=(value?' ':'')+'[公式：='+c.f+(c.v===undefined?'；未缓存结果':'；文件内缓存结果')+']';if(!String(value).trim())continue;textCount+=String(value).length;if(!rows.has(r))rows.set(r,new Map());rows.get(r).set(column,String(value));columns.add(column);}
  if(columns.size>256||rows.size>10000)throw new Error('Excel 工作表过宽或过长，请拆分文件');
  if(rows.size*(columns.size+1)*3>limit)throw new Error('表格提取内容超过 '+limit.toLocaleString()+' 字符，请拆分文件后添加');
  const cols=[...columns].sort((a,b)=>a-b),hidden=workbook.Workbook?.Sheets?.find(s=>s.name===name)?.Hidden;
  out.add('## 工作表：'+name+(hidden?'（隐藏）':'')+'\n\n'+(rows.size?table([['行',...cols.map(XLSX.utils.encode_col)],...[...rows].sort((a,b)=>a[0]-b[0]).map(([r,values])=>[String(r+1),...cols.map(c=>values.get(c)||'')])]):'（空工作表）'));
  if(sheet['!merges']?.length)out.add('合并单元格：'+sheet['!merges'].map(XLSX.utils.encode_range).join('、'));
 }
 if(!textCount)throw new Error('Excel 没有可读取的单元格内容');return out.value();
}
function ole(bytes){return Buffer.from(bytes.subarray(0,8)).equals(Buffer.from('d0cf11e0a1b11ae1','hex'));}
async function readDoc(bytes,limit){
 if(!ole(bytes))throw new Error('旧版 Word 格式无法识别，请在 Word 中另存为 DOCX');
 const {CFB}=await import('xlsx'),oleFile=CFB.read(bytes,{type:'buffer'}),wordStream=CFB.find(oleFile,'WordDocument')?.content;
 if(!wordStream||wordStream.length<12)throw new Error('旧版 Word 文件缺少正文数据');
 const flags=wordStream[10]|(wordStream[11]<<8);if(flags&0x8100)throw new Error('Word 文件已加密，请另存为未加密文件后添加');
 const {default:WordExtractor}=await import('word-extractor'),doc=await new WordExtractor().extract(Buffer.from(bytes)),out=output(limit);
 for(const [label,method,options] of [['正文','getBody'],['页眉','getHeaders',{includeFooters:false}],['页脚','getFooters'],['脚注','getFootnotes'],['尾注','getEndnotes'],['批注','getAnnotations'],['文本框','getTextboxes']]){const value=clean(doc[method]({...options,filterUnicode:false})).trim();if(value)out.add((label==='正文'?'':'## '+label+'\n\n')+value);}
 return out.value();
}
function contentBlocks(blocks){
 return (blocks||[]).map(block=>{
  if(block.kind==='paragraph')return (block.runs||[]).map(run=>run.text||'').join('');
  if(block.kind==='table')return table((block.rows||[]).map(row=>(row.cells||[]).map(c=>contentBlocks(c.blocks))));
  if(block.blocks)return contentBlocks(block.blocks);return '';
 }).filter(Boolean).join('\n\n');
}
async function readPpt(bytes,limit){
 if(!ole(bytes))throw new Error('旧版 PPT 格式无法识别，请在 PowerPoint 中另存为 PPTX');
 const {readPptContent}=await import('ppt-codec'),doc=readPptContent(bytes),out=output(limit);let count=0;
 if(!doc.slides.length||doc.slides.length>500)throw new Error('PPT 没有可读幻灯片或超过 500 页');
 doc.slides.forEach((slide,index)=>{const text=slide.shapes.map(shape=>contentBlocks(shape.blocks)).filter(Boolean).join('\n\n'),notes=typeof slide.notes==='string'?slide.notes:contentBlocks(slide.notes);count+=text.length+notes.length;out.add('## 第 '+(index+1)+' 页\n\n'+(text||'（本页没有可提取文字）'));if(notes)out.add('演讲者备注：\n'+notes);});
 if(!count)throw new Error('PPT 中没有可读取的文字；图片或扫描内容暂不识别');return out.value();
}
function decodeText(bytes,extension){
 const markdown=['md','markdown','mdown'].includes(extension);let encoding='UTF-8',content;
 try{
  if(!markdown&&bytes[0]===0xff&&bytes[1]===0xfe){encoding='UTF-16LE';content=new TextDecoder('utf-16le',{fatal:true}).decode(bytes);}
  else if(!markdown&&bytes[0]===0xfe&&bytes[1]===0xff){encoding='UTF-16BE';content=new TextDecoder('utf-16be',{fatal:true}).decode(bytes);}
  else content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 }catch{
  if(markdown)throw new Error('不是有效的 UTF-8 文本，请另存为 UTF-8 后添加');
  try{encoding='GB18030';content=new TextDecoder('gb18030',{fatal:true}).decode(bytes);}catch{throw new Error('文本编码无法识别，请另存为 UTF-8 后添加');}
 }
 if(content.includes('\0'))throw new Error('不是可读取的文本文件');return {content:content.replace(/^\uFEFF/,''),encoding};
}
export async function extractChatFile(raw){
 const {name,bytes,extension,limit}=validateChatFile(raw);let content,notice='',format='markdown';
 if(extension==='pdf'){const {extractLinkDocument}=await import('./link-extract.mjs');const result=await extractLinkDocument({bytes,type:'pdf',limit});if(result.partial)throw Error('PDF 内容超过 '+limit+' 字符，请拆分后添加；未截断。');return {name,content:result.content,format:'text',notice:'PDF 文字按页提取，不含图片或 OCR；表格列对应关系请核对预览。'};}
 try{
  if(textExtensions.has(extension)){const decoded=decodeText(bytes,extension);content=decoded.content;if(!content.trim())throw new Error('是空文件');format=['md','markdown','mdown'].includes(extension)?'markdown':extension==='csv'||extension==='tsv'?'csv':'text';if(decoded.encoding!=='UTF-8')notice='以 '+decoded.encoding+' 读取，请核对预览文字。';}
  else{
   notice='仅提取文字与表格，不含图片、图表和原始版式；请核对预览。';
   if(extension==='docx'||extension==='pptx'||extension==='xlsx'){
    const parts=zipParts(bytes,extension);content=extension==='docx'?readDocx(parts,limit):extension==='pptx'?readPptx(parts,limit):await readSpreadsheet(bytes,limit);
   }else if(extension==='doc')content=await readDoc(bytes,limit);
   else if(extension==='ppt')content=await readPpt(bytes,limit);
   else{if(!ole(bytes))throw new Error('旧版 Excel 格式无法识别，请在 Excel 中另存为 XLSX');content=await readSpreadsheet(bytes,limit);}
  }
  content=clean(content);if(!content.trim())throw new Error('文件中没有可读取的文字或文件为空');
  if(content.length>limit)throw new Error('提取的文件内容超过 '+limit.toLocaleString()+' 字符，请拆分文件后添加；未截断内容。');
  return {name,content,format,notice};
 }catch(e){const message=String(e.message||e);if(/超过|空|UTF-|文本|编码|Office|文件|Word|Excel|PPT|幻灯片/.test(message))throw new Error(name+'：'+message);throw new Error(name+'：文件读取失败，可能已加密、损坏或格式不支持，请另存为未加密的新格式后重试');}
}
