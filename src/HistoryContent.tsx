import {useState,type ReactNode} from 'react';
import {Mark} from './components';
import {ChatImages,ImageLightbox} from './ChatImages';
import type {HistoryImage} from './types';
export function HistoryContent({content,images}:{content:string;images?:HistoryImage[]}){
 const [zoom,setZoom]=useState<number|null>(null);
 if(!images?.length)return <Mark>{content}</Mark>;
 const ordered=[...images].sort((a,b)=>a.index-b.index),gallery=ordered.map(image=>({name:image.name,dataUrl:image.src}));
 const parts:ReactNode[]=[],tokens=[...content.matchAll(/\[图片(?:：[^\]\r\n]*)?\]/g)];let from=0,group:HistoryImage[]=[];
 const flush=()=>{if(group.length){const current=group;parts.push(<ChatImages key={'group-'+parts.length} images={current.map(image=>({name:image.name,dataUrl:image.src}))} onPreview={i=>setZoom(ordered.indexOf(current[i]))}/>);group=[];}};
 for(let i=0;i<tokens.length;i++){
  const token=tokens[i],image=ordered.find(image=>image.index===i);if(!image)continue;
  const between=content.slice(from,token.index);
  if(between.trim()){flush();parts.push(<Mark key={'text-'+i}>{between}</Mark>);}
  group.push(image);from=token.index!+token[0].length;
 }
 flush();if(from<content.length)parts.push(<Mark key="tail">{content.slice(from)}</Mark>);
 return <>{parts}{zoom!==null&&<ImageLightbox images={gallery} index={Math.min(zoom,gallery.length-1)} onChange={setZoom} onClose={()=>setZoom(null)}/>}</>;
}
