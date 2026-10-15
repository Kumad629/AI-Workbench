import {join} from 'node:path';
export function parseVoiceWav(value){
 if(!(value instanceof ArrayBuffer)&&!ArrayBuffer.isView(value))throw new Error('录音数据格式无效');
 const b=value instanceof ArrayBuffer?Buffer.from(value):Buffer.from(value.buffer,value.byteOffset,value.byteLength);
 if(b.length<44||b.length>44+16000*2*122||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE')throw new Error('录音格式无效或超过两分钟');
 let format,data;for(let offset=12;offset+8<=b.length;){const tag=b.toString('ascii',offset,offset+4),n=b.readUInt32LE(offset+4),end=offset+8+n;if(end>b.length)throw new Error('录音文件不完整');if(tag==='fmt '){if(n<16)throw new Error('录音格式无效');format={encoding:b.readUInt16LE(offset+8),channels:b.readUInt16LE(offset+10),rate:b.readUInt32LE(offset+12),bits:b.readUInt16LE(offset+22)};}if(tag==='data')data=b.subarray(offset+8,end);offset=end+(n%2);}
 if(!format||format.encoding!==1||format.channels!==1||format.rate!==16000||format.bits!==16||!data||data.length<8000||data.length%2)throw new Error('需要至少四分之一秒的单声道录音');
 const samples=new Float32Array(data.length/2);let power=0;for(let i=0;i<samples.length;i++){samples[i]=data.readInt16LE(i*2)/32768;power+=samples[i]*samples[i];}
 if(Math.sqrt(power/samples.length)<0.0001)throw new Error('没有检测到声音，请试听录音并检查麦克风');return samples;
}
export class VoiceService{
 constructor(model,launch,{timeout=180000}={}){this.model=model;this.launch=launch;this.timeout=timeout;this.active=null;}
 async transcribe({id,wav}={}){
  if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id))throw new Error('语音任务无效');
  if(this.active)throw new Error('已有语音正在识别，请稍候');const samples=parseVoiceWav(wav);let cancelled=false;const task={id,cancel:()=>{cancelled=true;}};this.active=task;
  try{if(!await this.model.ready())throw new Error('请先下载本地语音模型');if(cancelled)throw new Error('识别已取消');
   return await new Promise((resolve,reject)=>{let child;try{child=this.launch();}catch{reject(new Error('本地识别组件启动失败，请重新安装工作台依赖'));return;}
    let ended=false;const finish=(error,result)=>{if(ended)return;ended=true;clearTimeout(timer);try{child.kill();}catch{}error?reject(new Error(error)):resolve(result);};
    const timer=setTimeout(()=>finish('本地识别超时，录音已保留，可缩短录音后重试'),this.timeout);task.cancel=()=>finish('识别已取消');
    child.on('message',message=>{if(message?.error)return finish('本地识别失败，录音已保留。'+String(message.error).slice(0,180));const text=String(message?.text||'').replace(/<\|[^|]*\|>/g,'').trim();if(!text)return finish('未识别到文字，请试听录音后重试');if(text.length>20000)return finish('识别结果过长，请缩短录音');finish(null,{text});});
    child.on('error',()=>finish('本地识别组件运行失败，请重试'));child.on('exit',()=>{if(!ended)finish('本地识别组件提前退出，录音已保留');});
    try{child.postMessage({model:join(this.model.directory,'model.int8.onnx'),tokens:join(this.model.directory,'tokens.txt'),samples});}catch{finish('无法传递录音到本地识别组件，请重试');}
   });
  }finally{if(this.active===task)this.active=null;}
 }
 cancel(id){if(this.active&&(!id||this.active.id===id))this.active.cancel();return true;}
}
export function mayUseMicrophone({trusted,armed,permission,details,request=false}){
 if(!trusted||!armed||permission!=='media'||details?.isMainFrame!==true)return false;
 return request?Array.isArray(details.mediaTypes)&&details.mediaTypes.length===1&&details.mediaTypes[0]==='audio':details.mediaType==='audio';
}
