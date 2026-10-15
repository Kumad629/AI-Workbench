export const MAX_RECORDING_SECONDS=120;
export async function recordingToWav(blob:Blob):Promise<ArrayBuffer>{
 const context=new AudioContext();
 try{
  const audio=await context.decodeAudioData(await blob.arrayBuffer());
  if(!audio.length||audio.duration>MAX_RECORDING_SECONDS+2)throw new Error('录音为空或超过两分钟，请重新录制');
  const offline=new OfflineAudioContext(1,Math.ceil(audio.duration*16000),16000);
  const source=offline.createBufferSource();source.buffer=audio;source.connect(offline.destination);source.start();
  const mono=(await offline.startRendering()).getChannelData(0);
  const wav=new ArrayBuffer(44+mono.length*2),view=new DataView(wav);
  const chars=(offset:number,text:string)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
  chars(0,'RIFF');view.setUint32(4,wav.byteLength-8,true);chars(8,'WAVE');chars(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);chars(36,'data');view.setUint32(40,mono.length*2,true);
  for(let i=0;i<mono.length;i++){const v=Math.max(-1,Math.min(1,mono[i]));view.setInt16(44+i*2,v<0?v*32768:v*32767,true);}
  return wav;
 }finally{await context.close();}
}
export function microphoneError(error:unknown){
 const e=error as DOMException;
 if(e.name==='NotAllowedError'||e.name==='SecurityError')return '未获得麦克风权限。请检查 Windows 的麦克风访问权限，然后重试。';
 if(e.name==='NotFoundError')return '没有找到麦克风，请连接或启用麦克风后重试。';
 if(e.name==='NotReadableError')return '无法使用麦克风，可能被其他程序占用，请关闭占用程序后重试。';
 return e.message||'录音失败，请检查麦克风后重试';
}
