import {Worker} from 'node:worker_threads';
import {validateChatFile} from './chat-file-extract.mjs';
let active=0;
export async function readChatFile(input){
 const validated=validateChatFile(input);
 if(active>=2)throw new Error('正在读取其他文件，请稍后再试');
 active++;let worker,timer;
 try{return await new Promise((resolve,reject)=>{
  worker=new Worker(new URL('./chat-file-worker.mjs',import.meta.url),{workerData:validated,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:160,stackSizeMb:4}});worker.unref();
  timer=setTimeout(()=>reject(new Error('文件读取超过 15 秒，已停止；请拆分文件后重试')),15000);
  worker.once('message',message=>message.ok?resolve(message.result):reject(new Error(message.error)));
  worker.once('error',()=>reject(new Error('文件读取失败或超过内存容量，请拆分文件后重试')));
  worker.once('exit',code=>{if(code!==0)reject(new Error('文件读取进程已停止，请检查文件或拆分后重试'));});
 });}finally{clearTimeout(timer);await worker?.terminate();active--;}
}
