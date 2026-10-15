import {useEffect,useRef,useState,type ClipboardEvent,type PointerEvent} from 'react';
import {createPortal} from 'react-dom';
import {ImagePlus,X,ChevronLeft,ChevronRight} from 'lucide-react';
import type {ChatImage} from './types';
export async function readChatImages(files:File[]):Promise<ChatImage[]>{
 if(files.length>3)throw new Error('每次最多添加 3 张图片');
 return Promise.all(files.map(async file=>{
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('仅支持 PNG、JPEG、WebP 图片');
  if(file.size>2*1024*1024)throw new Error('每张图片最多 2 MB，请先缩小图片');
  const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(file);});
  return {name:file.name||'粘贴的图片.png',dataUrl};
 }));
}
export function useChatImages(){
 const [images,setImages]=useState<ChatImage[]>([]),[imageError,setImageError]=useState(''),[loading,setLoading]=useState(false);
 const generation=useRef(0),busy=useRef(false);
 const reset=()=>{generation.current++;busy.current=false;setImages([]);setImageError('');setLoading(false);};
 const add=async(files:File[])=>{
  if(!files.length||busy.current)return;const ticket=generation.current;busy.current=true;setLoading(true);setImageError('');
  try{if(images.length+files.length>3)throw new Error('每次最多添加 3 张图片');const added=await readChatImages(files);if(ticket===generation.current)setImages(old=>[...old,...added]);}
  catch(e){if(ticket===generation.current)setImageError((e as Error).message);}
  finally{if(ticket===generation.current){busy.current=false;setLoading(false);}}
 };
 const paste=(e:ClipboardEvent<HTMLTextAreaElement>)=>{
  const files=[...e.clipboardData.files].filter(f=>f.type.startsWith('image/'));
  if(files.length){e.preventDefault();void add(files);return true;}return false;
 };
 return {images,imageError,loading,reset,add,paste,remove:(i:number)=>setImages(old=>old.filter((_,n)=>n!==i))};
}
export function ImageLightbox({images,index,onChange,onClose}:{images:ChatImage[];index:number;onChange:(index:number)=>void;onClose:()=>void}){
 const dialog=useRef<HTMLDivElement>(null),closeButton=useRef<HTMLButtonElement>(null);
 const drag=useRef<{x:number;y:number;id:number}|null>(null),[failedSrc,setFailedSrc]=useState('');
 const image=images[index],multiple=images.length>1;
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';closeButton.current?.focus();
  return ()=>{document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus();};
 },[]);
 const move=(step:number)=>onChange(Math.max(0,Math.min(images.length-1,index+step)));
 const pointerDown=(e:PointerEvent<HTMLDivElement>)=>{
  if(!multiple||e.button!==0)return;drag.current={x:e.clientX,y:e.clientY,id:e.pointerId};e.currentTarget.setPointerCapture(e.pointerId);
 };
 const pointerUp=(e:PointerEvent<HTMLDivElement>)=>{
  const start=drag.current;drag.current=null;if(!start||start.id!==e.pointerId)return;
  const dx=e.clientX-start.x,dy=e.clientY-start.y;
  if(Math.abs(dx)>=50&&Math.abs(dx)>Math.abs(dy)*1.3)move(dx<0?1:-1);
 };
 if(!image)return null;
 return createPortal(<div ref={dialog} className="image-lightbox" role="dialog" aria-modal="true" aria-label="图片预览" onClick={e=>{if(e.target===e.currentTarget)onClose();}} onKeyDown={e=>{
  if(['Escape','ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
   e.preventDefault();e.stopPropagation();
   if(e.key==='Escape')onClose();else if(e.key==='ArrowLeft')move(-1);else if(e.key==='ArrowRight')move(1);else onChange(e.key==='Home'?0:images.length-1);
  }
  if(e.key==='Tab'){
   const buttons=[...dialog.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
   const first=buttons[0],last=buttons.at(-1);
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  }
 }}>
  <button ref={closeButton} type="button" className="image-close" aria-label="关闭图片预览" onClick={onClose}><X/></button>
  {multiple&&<button type="button" className="image-nav image-prev" aria-label="上一张图片" aria-disabled={index===0} onClick={()=>move(-1)}><ChevronLeft/></button>}
  <div className={'image-stage'+(multiple?' can-swipe':'')} onPointerDown={pointerDown} onPointerUp={pointerUp} onPointerCancel={()=>{drag.current=null;}}>
   {failedSrc===image.dataUrl?<p className="image-load-error">图片暂时无法加载，请在原网页打开后重新同步。</p>:<img src={image.dataUrl} referrerPolicy="no-referrer" alt={image.name} draggable={false} onError={()=>setFailedSrc(image.dataUrl)}/>}
  </div>
  {multiple&&<button type="button" className="image-nav image-next" aria-label="下一张图片" aria-disabled={index===images.length-1} onClick={()=>move(1)}><ChevronRight/></button>}
  <div className="image-viewer-footer"><span role="status" aria-live="polite">{index+1} / {images.length}</span>{multiple&&<small>← → 切换 · 可左右拖动 · Esc 关闭</small>}</div>
 </div>,document.body);
}
export function ChatImages({images,onRemove,onPreview}:{images:ChatImage[];onRemove?:(index:number)=>void;onPreview?:(index:number)=>void}){
 const [zoom,setZoom]=useState<number|null>(null),[failed,setFailed]=useState<Set<string>>(()=>new Set());
 return <><div className="chat-images">{images.map((image,i)=><div className="chat-image" key={i}><button type="button" className="image-preview" title="放大图片" onClick={()=>onPreview?onPreview(i):setZoom(i)}>
 {failed.has(image.dataUrl)?<span className="image-thumbnail-error">图片暂时无法加载，请在原网页打开后重新同步。</span>:<img src={image.dataUrl} alt={image.name} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(old=>new Set([...old,image.dataUrl]))}/>}</button>{onRemove&&<button type="button" className="image-remove" aria-label={'移除图片 '+(i+1)} onClick={()=>onRemove(i)}><X size={14}/></button>}</div>)}</div>
 {zoom!==null&&images.length>0&&<ImageLightbox images={images} index={Math.min(zoom,images.length-1)} onChange={setZoom} onClose={()=>setZoom(null)}/>}</>;
}
export function ImagePicker({onFiles,disabled}:{onFiles:(files:File[])=>void;disabled?:boolean}){
 const ref=useRef<HTMLInputElement>(null);
 return <><input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden aria-label="选择聊天图片" onChange={e=>{onFiles([...e.target.files||[]]);e.target.value='';}}/><button type="button" className="text-button" title="添加图片，也可以直接粘贴截图" disabled={disabled} onClick={()=>ref.current?.click()}><ImagePlus size={16}/>添加图片</button></>;
}
