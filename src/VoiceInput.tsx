import {useEffect,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {Mic,Square,X,LoaderCircle,Download,Trash2} from 'lucide-react';
import {MAX_RECORDING_SECONDS,recordingToWav,microphoneError} from './voice-audio';
import './voice-input.css';
import {VoiceActivity} from './voice-activity';
type ModelStatus={ready:boolean;phase:string;progress:number;error?:string;bytes?:number};
type Phase='idle'|'starting'|'recording'|'review'|'recognizing'|'result';
export function VoiceInput({editorRef,onText,disabled=false}:{editorRef:RefObject<HTMLTextAreaElement|null>;onText:(text:string)=>void;disabled?:boolean}){
 const [open,setOpen]=useState(false),[phase,setPhase]=useState<Phase>('idle'),[seconds,setSeconds]=useState(0),[level,setLevel]=useState(0),[error,setError]=useState(''),[audioUrl,setAudioUrl]=useState(''),[text,setText]=useState(''),[model,setModel]=useState<ModelStatus|null>(null);
 const session=useRef(0),alive=useRef(true),recording=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),context=useRef<AudioContext|null>(null),timer=useRef<ReturnType<typeof setInterval>|null>(null),preview=useRef(''),blob=useRef<Blob|null>(null),job=useRef(''),dialog=useRef<HTMLDivElement|null>(null),button=useRef<HTMLButtonElement|null>(null),phaseRef=useRef<Phase>('idle');
 const [automatic,setAutomatic]=useState(()=>localStorage.getItem('voice-auto-finish')!=='false');
 const automaticRef=useRef(automatic),modelRef=useRef(model),recognizeRef=useRef<()=>Promise<void>>(async()=>{});
 automaticRef.current=automatic;modelRef.current=model;
 const selection=useRef({value:'',start:0,end:0});
 phaseRef.current=phase;
 const call=(action:string,payload?:unknown)=>{if(!window.workbench)throw new Error('请在桌面工作台使用语音输入');return window.workbench.call(action,payload);};
 const releaseMic=()=>{if(timer.current)clearInterval(timer.current);timer.current=null;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;if(context.current)void context.current.close().catch(()=>{});context.current=null;};
 const revoke=()=>{if(preview.current)URL.revokeObjectURL(preview.current);preview.current='';blob.current=null;};
 const cancelWork=()=>{dialog.current?.querySelector('audio')?.pause();session.current++;const r=recording.current;recording.current=null;if(r){r.onstop=null;r.ondataavailable=null;r.onerror=null;if(r.state!=='inactive')r.stop();}releaseMic();revoke();if(job.current){void call('voiceCancel',{id:job.current}).catch(()=>{});job.current='';}};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;cancelWork();};},[]);
 useEffect(()=>{if(!open)return;let active=true;const poll=async()=>{try{const s=await call('voiceModelStatus');if(active)setModel(s);}catch(e){if(active)setError(String((e as Error).message));}};void poll();const t=setInterval(poll,600);return()=>{active=false;clearInterval(t);};},[open]);
 const close=()=>{cancelWork();setOpen(false);setPhase('idle');setError('');setAudioUrl('');setText('');editorRef.current?.focus({preventScroll:true});};
 useEffect(()=>{if(!open)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}else if(e.key==='Tab'){const items=[...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),textarea,audio')];const i=items.indexOf(document.activeElement as HTMLElement);if(e.shiftKey&&i<=0){e.preventDefault();items.at(-1)?.focus();}else if(!e.shiftKey&&(i===items.length-1||i<0)){e.preventDefault();items[0]?.focus();}}};document.addEventListener('keydown',key,true);return()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',key,true);};},[open]);
 const autoRecognize=useRef(false);
 const finish=(allowAuto=true)=>{const r=recording.current;if(r?.state==='recording'){autoRecognize.current=allowAuto&&automaticRef.current;r.stop();releaseMic();}};
 const start=async()=>{
  if(phaseRef.current==='starting'||phaseRef.current==='recording'||phaseRef.current==='recognizing')return;
  autoRecognize.current=false;revoke();setAudioUrl('');setText('');setError('');setSeconds(0);setLevel(0);setPhase('starting');phaseRef.current='starting';const token=++session.current;
  try{
   await call('voiceArm');
   const input=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
   if(!alive.current||token!==session.current){input.getTracks().forEach(t=>t.stop());return;}
   stream.current=input;const ac=new AudioContext();context.current=ac;await ac.resume();
   if(token!==session.current){input.getTracks().forEach(t=>t.stop());void ac.close().catch(()=>{});return;}
   const analyser=ac.createAnalyser();analyser.fftSize=512;ac.createMediaStreamSource(input).connect(analyser);const values=new Float32Array(analyser.fftSize);
   const mime=['audio/webm;codecs=opus','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));const r=new MediaRecorder(input,mime?{mimeType:mime,audioBitsPerSecond:64000}:undefined);const chunks:BlobPart[]=[];recording.current=r;
   r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
   r.onerror=()=>{if(token===session.current){cancelWork();setPhase('idle');setError('录音中断，请检查麦克风后重新录制');}};
   r.onstop=()=>{if(token!==session.current||!alive.current)return;recording.current=null;releaseMic();const b=new Blob(chunks,{type:r.mimeType});if(b.size<100){setPhase('idle');setError('没有录到声音，请重新录制');return;}blob.current=b;preview.current=URL.createObjectURL(b);setAudioUrl(preview.current);setLevel(0);setPhase('review');phaseRef.current='review';if(autoRecognize.current&&modelRef.current?.ready)void recognizeRef.current();};
   input.getAudioTracks()[0].onended=()=>{if(token===session.current&&r.state==='recording'){setError('麦克风已断开，已保留录到的内容');finish(false);}};
   r.start(200);setPhase('recording');phaseRef.current='recording';const began=performance.now(),activity=new VoiceActivity();
   timer.current=setInterval(()=>{const elapsed=(performance.now()-began)/1000;setSeconds(Math.floor(elapsed));analyser.getFloatTimeDomainData(values);const rms=Math.sqrt(values.reduce((n,v)=>n+v*v,0)/values.length);setLevel(Math.min(1,rms*5));if(elapsed>=MAX_RECORDING_SECONDS){finish();return;}if(automaticRef.current){const end=activity.update(elapsed*1000,rms);if(end==='finished')finish();else if(end==='silent'){setError('还没有听到清晰的说话声，请靠近麦克风后重新录音');finish(false);}}},100);
  }catch(e){if(token===session.current&&alive.current){releaseMic();setPhase('idle');phaseRef.current='idle';setError(microphoneError(e));}}
 };
 const launch=()=>{if(disabled)return;const e=editorRef.current;if(!e)return;selection.current={value:e.value,start:e.selectionStart,end:e.selectionEnd};setOpen(true);setPhase('idle');phaseRef.current='idle';setError('');};
 const apply=(recognized:string)=>{const editor=editorRef.current;if(!editor)return false;const old=selection.current;if(editor.value!==old.value)return false;const next=old.value.slice(0,old.start)+recognized+old.value.slice(old.end);if(editor.maxLength>0&&next.length>editor.maxLength){setError('识别文字超过输入框长度，请精简后再填入');return false;}onText(next);close();requestAnimationFrame(()=>{if(editor.isConnected){editor.focus({preventScroll:true});editor.setSelectionRange(old.start+recognized.length,old.start+recognized.length);}});return true;};
 const recognize=async()=>{if(!blob.current||phaseRef.current==='recognizing')return;const token=++session.current;setPhase('recognizing');phaseRef.current='recognizing';setError('');const id=crypto.randomUUID();job.current=id;
  try{const wav=await recordingToWav(blob.current);if(token!==session.current)return;const result=await call('voiceTranscribe',{id,wav});if(token!==session.current||!alive.current)return;job.current='';setText(result.text);if(!apply(result.text)){setPhase('result');setError('草稿已有变化，识别结果已保留，请检查后追加。');}}
  catch(e){if(token===session.current&&alive.current){job.current='';setPhase('review');setError(String((e as Error).message).replace(/^Error invoking remote method '[^']+': Error: /,''));}}
 };
 recognizeRef.current=recognize;
 const modelAction=async(action:string)=>{setError('');try{setModel(await call(action));}catch(e){setError(String((e as Error).message).replace(/^Error invoking remote method '[^']+': Error: /,''));}};
 const busy=phase==='starting'||phase==='recording'||phase==='recognizing';
 return <div className="voice-input"><button ref={button} type="button" className="voice-input-button" aria-label="语音输入" title="工作台录音 · 本地识别" disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={launch}><Mic size={16}/><span>语音输入</span></button>{open&&createPortal(<div className="voice-overlay"><div ref={dialog} className="voice-panel" role="dialog" aria-modal="true" aria-label="语音输入"><header><div><strong>语音输入</strong><small>录音与识别留在本机，文字填入草稿后再发送</small></div><button type="button" className="icon-button" aria-label="关闭语音输入" onClick={close}><X size={18}/></button></header>
 <div className="voice-recording"><div className={'voice-orb '+(phase==='recording'?'active':'')}><Mic size={28}/></div><strong>{phase==='recording'?'正在录音':phase==='starting'?'正在打开麦克风':phase==='recognizing'?'正在本地识别':audioUrl?'录音已完成':'准备好后开始说话'}</strong><span className="voice-clock">{String(Math.floor(seconds/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')} / 02:00</span><div className="voice-level" role="meter" aria-label="麦克风音量" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level*100)}><i style={{width:(level*100)+'%'}}/></div><small>{phase==='recording'&&seconds>3&&level<0.01?'音量较低，请靠近麦克风或检查输入设备':automatic?'说完后安静约 2 秒，自动识别并填入；最多两分钟':'每次最多两分钟；完成或取消后关闭麦克风'}</small></div>
 <label className="voice-auto-option"><input type="checkbox" checked={automatic} disabled={busy} onChange={e=>{setAutomatic(e.target.checked);localStorage.setItem('voice-auto-finish',String(e.target.checked));}}/>说完自动填入<small>需要长时间停顿时可关闭</small></label>
 {audioUrl&&<audio className="voice-preview" aria-label="试听录音" controls src={audioUrl}/>}
 {phase==='result'&&<textarea aria-label="识别结果" value={text} onChange={e=>setText(e.target.value)}/>}
 {error&&<p className="voice-error" role="alert">{error}</p>}
 <div className="voice-model"><div><strong>{model?.ready?'本地模型已就绪':'中文本地识别 · SenseVoice'}</strong><small>{model?.phase==='downloading'?'正在下载 '+Math.round(model.progress*100)+'%':model?.phase==='verifying'?'正在校验并安装':model?.ready?'约 239 MB · CPU 识别 · 用完释放内存':'首次下载约 240 MB；尚未下载也可录音试听'}</small>{model?.error&&<small className="voice-error">{model.error}</small>}</div>{model?.phase==='downloading'||model?.phase==='verifying'?<button type="button" className="text-button" onClick={()=>void modelAction('voiceModelCancel')}>取消下载</button>:model?.ready?<button type="button" className="icon-button" aria-label="删除本地语音模型" disabled={busy} onClick={()=>{if(confirm('删除本地语音模型？以后可以重新下载，聊天记录不受影响。'))void modelAction('voiceModelRemove');}}><Trash2 size={16}/></button>:<button type="button" className="secondary" onClick={()=>void modelAction('voiceModelDownload')}><Download size={15}/>下载模型</button>}</div>
 <small className="voice-source-note">模型下载自 Hugging Face；主站不可达时使用 HF 镜像，文件均校验。录音不上传。</small><footer><button type="button" className="secondary" onClick={close}>取消</button>{phase==='recording'?<button type="button" className="primary" onClick={()=>finish()}><Square size={15}/>完成录音</button>:phase==='starting'||phase==='recognizing'?<button type="button" className="primary" disabled><LoaderCircle size={15} className="spin"/>{phase==='starting'?'正在准备':'识别中…'}</button>:phase==='result'?<button type="button" className="primary" disabled={!text.trim()} onClick={()=>{const e=editorRef.current;if(!e)return;selection.current={value:e.value,start:e.value.length,end:e.value.length};apply((e.value?'\n':'')+text);}}>追加到当前草稿</button>:<><button type="button" className={audioUrl?'secondary':'primary'} onClick={()=>void start()}><Mic size={15}/>{audioUrl?'重新录音':'开始录音'}</button>{audioUrl&&<button type="button" className="primary" disabled={!model?.ready} onClick={()=>void recognize()}>识别并填入</button>}</>}</footer>
 </div></div>,document.body)}</div>;
}
