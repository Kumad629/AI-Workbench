import {mkdir,stat,open,unlink,rename} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const repository='csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17';
export const MODEL={name:'SenseVoice int8',bytes:239700000,revision:'2365baeacb507f821a0c8120fcee3d484dba7a07',files:[{name:'model.int8.onnx',bytes:239233841,max:239233841,sha256:'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51'},{name:'tokens.txt',max:2000000,sha256:'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc'}]};
export class VoiceModel{
 constructor(directory,{fetcher=fetch,definition=MODEL}={}){this.directory=resolve(directory);this.fetcher=fetcher;this.definition=definition;this.state={phase:'idle',progress:0,error:''};this.task=null;this.controller=null;this.verified=new Map();}
 async valid(file){const path=join(this.directory,file.name);try{const s=await stat(path);if(!s.isFile()||!s.size||s.size>file.max||(file.bytes&&s.size!==file.bytes))return false;const key=s.size+':'+s.mtimeMs;if(this.verified.get(file.name)===key)return true;const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);if(hash.digest('hex')!==file.sha256)return false;this.verified.set(file.name,key);return true;}catch{return false;}}
 async ready(){for(const f of this.definition.files)if(!await this.valid(f))return false;return true;}
 async status(){return {...this.state,ready:!this.task&&await this.ready(),bytes:this.definition.bytes};}
 async start(){if(this.task)return this.status();this.controller=new AbortController();this.state={phase:'downloading',progress:0,error:''};const controller=this.controller;this.task=this.install(controller.signal).catch(e=>{this.state={phase:'idle',progress:0,error:controller.signal.aborted?'下载已取消':e.message||'模型下载失败，请重试'};}).finally(()=>{this.task=null;this.controller=null;});return this.status();}
 cancel(){this.controller?.abort();return this.status();}
 async install(signal){
  await mkdir(this.directory,{recursive:true});let complete=0;
  for(const file of this.definition.files){signal.throwIfAborted();if(await this.valid(file)){complete+=(await stat(join(this.directory,file.name))).size;continue;}
   const partial=join(this.directory,file.name+'.download');let lastError;
   try{for(const host of ['huggingface.co','hf-mirror.com']){
    signal.throwIfAborted();let handle;const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});let timeout=setTimeout(abort,15000);
    try{
     this.state.source=host;
     const url='https://'+host+'/'+repository+'/resolve/'+this.definition.revision+'/'+file.name;
     const r=await this.fetcher(url,{signal:controller.signal});if(!r.ok||!r.body)throw new Error('HTTP '+r.status);
     handle=await open(partial,'w');const hash=createHash('sha256');let count=0;
     for await(const chunk of r.body){clearTimeout(timeout);timeout=setTimeout(abort,30000);signal.throwIfAborted();count+=chunk.length;if(count>file.max)throw new Error('下载文件大小异常');hash.update(chunk);await handle.writeFile(chunk);this.state.progress=Math.min(.999,(complete+count)/this.definition.bytes);}
     await handle.close();handle=null;this.state.phase='verifying';if((file.bytes&&count!==file.bytes)||hash.digest('hex')!==file.sha256)throw new Error('下载文件校验失败');signal.throwIfAborted();await unlink(join(this.directory,file.name)).catch(e=>{if(e.code!=='ENOENT')throw e;});await rename(partial,join(this.directory,file.name));complete+=count;lastError=null;break;
    }catch(e){lastError=e;this.state.phase='downloading';}finally{clearTimeout(timeout);signal.removeEventListener('abort',abort);if(handle)await handle.close().catch(()=>{});}
   }if(lastError){signal.throwIfAborted();throw new Error('模型下载未完成，请检查网络后重试；已下载并校验的文件会保留。'+(lastError.message?.includes('校验')?'文件校验未通过。':''));}}
   finally{await unlink(partial).catch(()=>{});}
  }
  signal.throwIfAborted();if(!await this.ready())throw new Error('模型文件校验失败，请重新下载');this.state={phase:'ready',progress:1,error:''};
 }
 async remove(){if(this.task)throw new Error('请先取消下载，等待清理结束后再删除');for(const f of this.definition.files)await unlink(join(this.directory,f.name)).catch(e=>{if(e.code!=='ENOENT')throw e;});this.verified.clear();this.state={phase:'idle',progress:0,error:''};return this.status();}
}
