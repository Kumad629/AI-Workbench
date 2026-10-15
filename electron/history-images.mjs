import {validateImages} from './images.mjs';
export function validateHistoryImages(value,content){
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>20)throw new Error('历史图片数量超过单条容量');
 const count=[...content.matchAll(/\[图片(?:：[^\]\r\n]*)?\]/g)].length,seen=new Set();
 return value.map(image=>{
  if(!image||!Number.isInteger(image.index)||image.index<0||image.index>=count||seen.has(image.index)||typeof image.src!=='string')throw new Error('历史图片位置无效');
  seen.add(image.index);
  if(image.src.startsWith('data:')){
   if(image.src.length>512000)throw new Error('历史图片预览过大');
   validateImages([{dataUrl:image.src}]);
  }else{
   let u;try{u=new URL(image.src);}catch{throw new Error('历史图片地址无效');}
   if(u.protocol!=='https:'||u.username||u.password||u.port||image.src.length>16000||!/[.][a-z]{2,}$/i.test(u.hostname)||/\.(local|internal|localhost)$/i.test(u.hostname))throw new Error('历史图片地址无效');
  }
  return {index:image.index,name:'历史图片 '+(image.index+1),src:image.src};
 });
}
export function enrichHistoryImages(local,remote){
 // Only enrich the already aligned, identical text row. Never change IDs or local uploads.
 if(!remote?.historyImages?.length||local.role!==remote.role||local.content!==remote.content)return local;
 const byIndex=new Map((local.historyImages||[]).map(image=>[image.index,image]));
 for(const image of remote.historyImages){const old=byIndex.get(image.index);if(!old?.src.startsWith('data:'))byIndex.set(image.index,image);}
 return {...local,historyImages:[...byIndex.values()].sort((a,b)=>a.index-b.index)};
}
