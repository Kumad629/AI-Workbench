import {useId,useLayoutEffect,useState} from 'react';
import {Check,Command} from 'lucide-react';

export type Appearance='classic'|'minimal'|'warm';
export const appearances:{id:Appearance;name:string;description:string}[]=[
  {id:'classic',name:'经典',description:'原版蓝紫配色 · 完整会话面板'},
  {id:'minimal',name:'简约',description:'黑白灰 · 绿色标志与发送按钮'},
  {id:'warm',name:'暖米',description:'米色侧边栏 · 深咖灰点缀'},
];
export function useAppearance(){
  const [appearance,setAppearance]=useState<Appearance>(()=>{try{const saved=localStorage.getItem('awb-appearance');return appearances.some(a=>a.id===saved)?saved as Appearance:'minimal';}catch{return 'minimal';}});
  useLayoutEffect(()=>{document.documentElement.dataset.appearance=appearance;try{localStorage.setItem('awb-appearance',appearance);}catch{/* Appearance still works for this session. */}},[appearance]);
  return [appearance,setAppearance] as const;
}
export function AppearancePicker({value,onChange}:{value:Appearance;onChange:(value:Appearance)=>void}){
  const groupName=useId();
  return <section className="appearance-settings" aria-label="外观设置"><h2>外观</h2><p>选择适合你的工作台。对话、收藏和模型连接共用，切换立即生效。</p><div className="appearance-options" role="radiogroup" aria-label="工作台外观">{appearances.map(a=><label key={a.id} className={'appearance-option '+(value===a.id?'is-selected':'')}><input type="radio" name={groupName} value={a.id} checked={value===a.id} onChange={()=>onChange(a.id)}/><span className={'appearance-swatch swatch-'+a.id}><Command size={23}/></span><span className="appearance-option-copy"><strong>{a.name}</strong><small>{a.description}</small></span><Check size={16} className="appearance-check" aria-hidden="true"/></label>)}</div><small className="appearance-note">经典版保留原有布局。每种外观分别记住侧边栏和会话面板的展开状态。</small></section>;
}
