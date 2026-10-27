import {lookup as dnsLookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import ipaddr from 'ipaddr.js';
import {Worker} from 'node:worker_threads';
export function publicAddress(value){try{let ip=ipaddr.parse(value);if(ip.kind()==='ipv6'&&ip.isIPv4MappedAddress())ip=ip.toIPv4Address();return ip.range()==='unicast';}catch{return false;}}
export async function validateLink(raw,lookup=dnsLookup){
 let url;try{url=new URL(raw);}catch{throw Error('链接格式无效');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.href.length>4096||url.port&&!['80','443'].includes(url.port))throw Error('仅支持不含账号密码的公开 HTTP / HTTPS 链接及标准端口');
 const host=url.hostname.replace(/^\[|\]$/g,'');
 if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local'))throw Error('不能读取本机或内网链接');
 const addresses=isIP(host)?[{address:host}]:await lookup(host,{all:true});
 if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('不能读取本机、内网或特殊网络地址');
 url.hash='';return url.href;
}
export function parseLinkDocument(input,signal){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(Error('已取消读取链接'));
  const worker=new Worker(new URL('./link-extract-worker.mjs',import.meta.url),{workerData:input,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:256,stackSizeMb:4}});
  let settled=false;
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate();error?reject(error):resolve(result);};
  const abort=()=>finish(Error('已取消读取链接'));
  const timer=setTimeout(()=>finish(Error('正文解析超时，请下载文件后拆分读取')),20000);
  signal?.addEventListener('abort',abort,{once:true});
  worker.once('message',m=>finish(m.ok?null:Error(m.error),m.result));
  worker.once('error',()=>finish(Error('正文解析失败或超过内存容量')));
  worker.once('exit',()=>{if(!settled)finish(Error('正文解析意外停止'));});
 });
}
function abortable(promise,signal){return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason||Error('已取消读取'));if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});}
export function createLinkReader({fetch:fetcher,lookup=dnsLookup,parse=parseLinkDocument}){
 let active=0;
 return async({urls,limit=85000},signal)=>{
  if(!Array.isArray(urls)||!urls.length||urls.length>3||urls.some(u=>typeof u!=='string'))throw Error('每次支持读取 1 至 3 个链接');
  if(active>=2)throw Error('正在读取其他链接，请稍后再试');
  active++;
  const budget=Math.min(85000,Math.max(1000,Number(limit)||85000)),perSource=Math.floor(budget/urls.length),results=[];
  try{for(const raw of [...new Set(urls)]){
   const timeout=AbortSignal.timeout(45000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
   try{
    const requestedUrl=await abortable(validateLink(raw,lookup),combined);let url=requestedUrl,response;
    for(let i=0;i<6;i++){
     combined.throwIfAborted();
     response=await fetcher(url,{signal:combined,redirect:'manual',credentials:'omit',headers:{Accept:'text/html,application/pdf,text/plain;q=0.9','User-Agent':'AIWorkbench/0.17.0 (public-document-reader)'}});
     if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('网站重定向缺少目标');if(i===5)throw Error('网站重定向过多');url=await abortable(validateLink(new URL(location,url).href,lookup),combined);continue;}
     break;
    }
    if(!response.ok){await response.body?.cancel();throw Error('HTTP '+response.status+(response.status===403||response.status===429?' · 网站限制自动读取，请下载文件或复制正文':''));}
    const type=response.headers.get('content-type')?.toLowerCase()||'';
    if(type&&!/text\/html|application\/xhtml\+xml|application\/pdf|text\/plain|application\/octet-stream/.test(type)){await response.body?.cancel();throw Error('链接返回的内容不是网页、文字或 PDF');}
    const max=20*1024*1024,length=Number(response.headers.get('content-length'));
    if(length>max){await response.body?.cancel();throw Error('链接文件超过 20 MiB，请下载后拆分');}
    if(!response.body)throw Error('链接没有返回正文');
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw Error('链接内容超过 20 MiB，请下载后拆分');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
    const pdf=new TextDecoder().decode(bytes.subarray(0,5))==='%PDF-';
    if(!pdf&&/application\/pdf/.test(type))throw Error('链接声称是 PDF，但没有返回有效 PDF 文件');
    const result=await parse({bytes,type:pdf?'pdf':/text\/plain/.test(type)?'text':'html',url,limit:perSource},combined);
    results.push({...result,requestedUrl,readAt:new Date().toISOString(),ok:true});
   }catch(e){if(signal?.aborted)throw Error('已取消读取链接');results.push({requestedUrl:raw,url:raw,ok:false,error:timeout.aborted?'读取超过 45 秒，请检查网络后重试':e.code==='ENOTFOUND'?'域名无法解析，请检查网址':e.message});}
  }return results;}finally{active--;}
 };
}
