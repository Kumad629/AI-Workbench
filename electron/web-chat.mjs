import {validateImages} from './images.mjs';
import {mergeWebHistory} from './web-history.mjs';
import {randomUUID} from 'node:crypto';
import {webChatSource,webProviders} from '../browser-extension/web-providers.js';
export const yuanbaoUrl=value=>webChatSource(value,'yuanbao').url;
export const grokUrl=value=>webChatSource(value,'grok').url;
export const doubaoUrl=value=>webChatSource(value,'doubao').url;
export const chatgptUrl=value=>webChatSource(value,'chatgpt').url;
export const geminiUrl=value=>webChatSource(value,'gemini').url;
const terminal=new Set(['complete','failed','cancelled','interrupted']);
export class WebChat {
  constructor(store,notify=()=>{},clock=()=>Date.now(),provider='yuanbao'){
    if(!Object.hasOwn(webProviders,provider))throw new Error('未知网页平台');this.provider=provider;this.name=webProviders[provider].name;this.url=value=>webChatSource(value,provider).url;
    this.store=store;this.notify=notify;this.clock=clock;this.binding=null;
    for(const j of store.all('webJob'))if((j.provider||'yuanbao')===this.provider&&!terminal.has(j.state))this.finish(j,'interrupted',`上次连接已中断，请先查看${this.name}网页；不会自动重发。`);
  }
  active(){return this.store.all('webJob').find(j=>(j.provider||'yuanbao')===this.provider&&!terminal.has(j.state));}
  status(){
    const job=this.active();
    if(job&&this.clock()-job.touched>45000)this.finish(job,'interrupted',`浏览器连接中断，请核对${this.name}网页；本次不会自动重发。`);
    if(job&&this.clock()-job.created>720000&&!terminal.has(job.state))this.finish(job,'interrupted',`等待回答超时，已保留收到的内容，请查看${this.name}网页。`);
    const b=this.binding;
    if(b?.history?.phase==='loading'){
      const h=b.history,gap=this.clock()-(h.touched??h.started),total=this.clock()-h.started;
      h.waitingForBrowser=!!h.scan&&gap>45000;
      if(total>930000||gap>(h.scan?180000:45000)){
        h.phase='failed';h.waitingForBrowser=false;h.code=total>930000?'HISTORY_DEADLINE':'HISTORY_CONNECTION_TIMEOUT';
        h.message=total>930000?'历史同步超过总时限，任务已停止；本次扫描结果未写入，请重新扫描':'历史同步长时间未收到浏览器进度，任务已停止；本次扫描结果未写入，请保持网页和连接页打开后重试';
      }else if(h.waitingForBrowser)h.message='扫描暂未收到浏览器进度，已保留本次进度；请回到原网页并保持连接页打开，恢复后将继续（最多等待 3 分钟）';
    }
    return {provider:this.provider,conversationId:b?.conversationId,history:b?.history,online:!!b&&this.clock()-b.seen<15000,ready:!!b?.ready,bindingId:b?.id,url:b?.url||'',reason:b?(b.reason||''):`请在${this.name}页面的扩展中连接网页聊天`,busy:!!this.active()||b?.history?.phase==='loading'};
  }
  bind(data){
    const url=this.url(data.url);
    if(typeof data.clientId!=='string'||!/^[a-f0-9-]{36}$/.test(data.clientId))throw new Error('连接标识无效');
    this.status();
    if(this.active())throw new Error(`请先停止当前接收，再重新连接${this.name}`);
    this.binding={id:randomUUID(),clientId:data.clientId,url,seen:this.clock(),ready:data.ready===true,reason:String(data.reason||'').slice(0,300)};
    const existing=this.store.all('conversation').filter(c=>c.webChat?.url===url&&!c.archived).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
    this.binding.conversationId=existing?.id;
    this.binding.imageEnabled=data.imageEnabled===true&&['yuanbao','doubao'].includes(this.provider);
    this.binding.historyEnabled=data.historyEnabled===true;
    this.binding.scanEnabled=data.historyScanEnabled===true&&['yuanbao','doubao'].includes(this.provider);
    if(this.binding.historyEnabled)this.requestHistory({bindingId:this.binding.id});
    return {bindingId:this.binding.id};
  }
  auth(data){
    const b=this.binding;
    if(!b){const e=new Error('网页连接已失效：工作台重启或连接断开后，需要点击「重新连接」');e.code='WEB_CHAT_DISCONNECTED';throw e;}
    if(b.id!==data.bindingId||b.clientId!==data.clientId){const e=new Error(`此连接页已失效：另一个${this.name}连接页已接管。请使用最新连接页，并关闭多余的旧连接页`);e.code='WEB_CHAT_REPLACED';throw e;}
    return b;
  }
  poll(data){
    const b=this.auth(data);b.seen=this.clock();this.status();
    if(b.history?.phase==='loading'&&b.history.scan&&data.historyProgress?.requestId===b.history.id){
      const p=data.historyProgress;
      if(!Number.isInteger(p.count)||p.count<0||p.count>1000||!Number.isInteger(p.characters)||p.characters<0||p.characters>400000)throw new Error('扫描进度无效');
      b.history.touched=this.clock();b.history.waitingForBrowser=false;b.history.message='正在自动'+(p.direction==='down'?'向下检查':'向上加载')+'历史，已收集 '+p.count+' 条消息、'+p.characters.toLocaleString()+` 字符；请保持${this.name}网页可见`;
    }
    if(data.url){
      const url=this.url(data.url);
      b.ready=url===b.url&&data.ready===true;
      b.reason=url!==b.url?`${this.name}页面已切换，请在扩展中重新连接`:String(data.reason||'').slice(0,300);
    }
    let cancelled=false,finishedState;
    if(data.jobId){const old=this.store.get('webJob',data.jobId);if(old.bindingId!==b.id||old.clientId!==b.clientId)throw new Error('任务不属于当前连接');cancelled=terminal.has(old.state);if(cancelled)finishedState=old.state;}
    const job=this.active();
    if(job&&job.bindingId===b.id&&job.state==='queued'){
      job.state='claimed';job.touched=this.clock();this.store.put('webJob',job);
      // A claimed command is never issued again, even if this response is lost.
      return {job:{id:job.id,lease:job.lease,text:job.text,images:job.images||[],url:b.url},cancelled,finishedState};
    }
    return {job:null,cancelled,finishedState,historyStatus:b.history?{id:b.history.id,phase:b.history.phase,message:b.history.message,code:b.history.code}:null,historyRequest:!job&&b.history?.phase==='loading'?{id:b.history.id,url:b.url,scan:!!b.history.scan}:null};
  }
  send({conversationId,text,bindingId,images:inputImages}){
    const status=this.status(),b=this.binding;
    if(!b||b.id!==bindingId||!status.online||!status.ready)throw new Error(status.reason||`请先连接可用的${this.name}网页`);
    if(this.active()||b.history?.phase==='loading')throw new Error('请等待当前回答或历史同步结束');
    const images=validateImages(inputImages);if(images.length&&!b.imageEnabled)throw new Error(['yuanbao','doubao'].includes(this.provider)?'图片发送需要更新扩展至 0.9.0 并重新连接网页':this.name+' 当前仅支持文字提问，请在原网页发送图片');if(images.length&&typeof text==='string'&&!text.trim())text='请查看图片。';
    if(typeof text!=='string'||!text.trim()||text.length>20000)throw new Error('请输入问题（最多 20000 字符）');
    let c=conversationId?this.store.get('conversation',conversationId):null;
    if(!c&&b.conversationId)c=this.store.get('conversation',b.conversationId);
    if(c&&(!c.webChat||c.webChat.url!==b.url||c.archived))throw new Error(`此记录与当前${this.name}页面不同，请打开对应网页后重新连接`);
    const now=new Date().toISOString();
    c ||= {id:randomUUID(),title:text.trim().slice(0,38),mode:'single',connectionIds:[],messages:[],createdAt:now,updatedAt:now,archived:false,folder:`${this.name}网页聊天`,tags:[],webChat:{provider:`${this.name}`,url:b.url}};
    const user={id:randomUUID(),role:'user',content:text.trim(),images,status:'complete',createdAt:now,targetIds:[]};
    const answer={id:randomUUID(),role:'assistant',content:'',status:'streaming',phase:'等待浏览器发送',createdAt:now,replyTo:user.id,connectionId:'web:'+this.provider,connectionName:`${this.name} · 网页账号`,provider:`${this.name}`,model:'网页当前模型',context:[]};
    c.messages.push(user,answer);c.updatedAt=now;b.conversationId=c.id;
    const j={provider:this.provider,id:randomUUID(),lease:randomUUID(),bindingId:b.id,clientId:b.clientId,conversationId:c.id,messageId:answer.id,text:user.content,images,state:'queued',created:this.clock(),touched:this.clock(),sequence:0};
    this.store.transaction(()=>{this.store.put('conversation',c);this.store.put('webJob',j);});this.notify();
    return {conversationId:c.id,jobId:j.id};
  }
  requestHistory({bindingId,conversationId,mode,scan=false}){
    const status=this.status(),b=this.binding;
    if(!b||b.id!==bindingId||!status.online)throw new Error(`请先连接${this.name}网页`);
    if(scan&&!['yuanbao','doubao'].includes(this.provider))throw new Error(this.name+' 当前支持已加载历史同步；自动提取存档请使用扩展已有的读取入口（如有）');
    if(scan&&!b.scanEnabled)throw new Error(`自动扫描需要更新浏览器扩展至 0.7.0，并重新连接${this.name}`);
    if(!b.historyEnabled)throw new Error(`请更新浏览器扩展至 0.6.0 并重新连接${this.name}`);
    if(this.active()||b.history?.phase==='loading')throw new Error('请等待当前回答或同步结束');
    if(conversationId){
      const c=this.store.get('conversation',conversationId);
      if(c.webChat?.url!==b.url||c.archived)throw new Error(`请先连接这条记录对应的${this.name}网页`);
      b.conversationId=c.id;
    }
    b.history={id:randomUUID(),phase:'loading',scan:scan===true,copy:mode==='copy',started:this.clock(),touched:this.clock(),message:scan?'正在准备自动扫描历史…':mode==='copy'?'正在将网页历史另存为新会话…':'正在读取网页已加载的历史…'};
    return true;
  }
  history(data){
    const b=this.auth(data);this.status();b.seen=this.clock();
    if(!b.history||data.requestId!==b.history.id)throw new Error('历史同步任务已失效');
    if(b.history.phase!=='loading')return b.history.phase==='complete'?{accepted:true,conversationId:b.conversationId,repeated:true}:{accepted:false,error:b.history.message,code:b.history.code||'HISTORY_STOPPED'};
    b.history.waitingForBrowser=false;
    if(this.active())throw new Error('请等待当前回答结束再同步');
    try{
      if(this.url(data.url)!==b.url)throw new Error(`${this.name}页面已切换，未合并历史；请重新连接`);
      if(data.error)throw new Error(String(data.error).slice(0,300));
      let c=b.conversationId?this.store.get('conversation',b.conversationId):null;
      if(c&&(c.webChat?.url!==b.url||c.archived))throw new Error('本地记录与网页不匹配');
      if(b.history.copy)c=null;
      const jobs=c?this.store.all('webJob').filter(j=>j.conversationId===c.id):[];
      const merged=mergeWebHistory(c?.messages||[],data.messages,{id:this.provider,name:this.name},jobs);
      if(!merged.messages.length){b.history.phase='complete';b.history.message='当前网页没有可读取的历史，可以开始新对话';return {accepted:true};}
      const scanReasons={'boundaries-checked':'已自动滚动检查页面顶部和底部；页面未提供历史总数，无法保证完整','time-limit':'自动扫描达到 15 分钟时限，当前仅为部分记录','capacity':'自动扫描达到 1000 条 / 40 万字符容量，当前仅为部分记录'};
      const recovery=(merged.recoveredAnswers?'；已补回 '+merged.recoveredAnswers+' 条此前接收失败的回答':'')+(merged.retainedUnsentAttempts?'；保留 '+merged.retainedUnsentAttempts+' 次未发送成功的本地尝试':'')+(merged.retainedImageDifferences?'；其中 '+merged.retainedImageDifferences+' 处图片占位显示不同，保留本地记录；未核验图片内容':'');
      const previews=merged.messages.flatMap(m=>m.historyImages||[]),remotePreviews=previews.filter(image=>image.src.startsWith('https:')).length;
      const imageSummary=previews.length?'；已保存 '+previews.length+' 张历史图片预览'+(remotePreviews?'（其中 '+remotePreviews+' 张需联网加载）':''):'';
      const scope=b.history.scan?(scanReasons[data.scan?.reason]||'自动扫描结果；未确认全部历史'):'网页已加载消息；更早未加载内容不在本次范围内';
      const now=new Date().toISOString();
      c||={id:randomUUID(),title:(merged.messages.find(m=>m.role==='user')?.content.slice(0,38)||`${this.name}网页对话`)+(b.history.copy?' · 网页副本':''),mode:'single',connectionIds:[],messages:[],createdAt:now,updatedAt:now,archived:false,folder:`${this.name}网页聊天`,tags:[],webChat:{provider:`${this.name}`,url:b.url}};
      c.messages=merged.messages;c.updatedAt=now;
      c.webChat.history={capturedAt:now,loadedMessages:data.messages.length,scope:scope+recovery+imageSummary+(merged.retainedDifferences?'；其中 '+merged.retainedDifferences+' 轮回答与网页不同，保留本地版本':'')};
      this.store.put('conversation',c);b.conversationId=c.id;
      b.history.phase='complete';b.history.message=(b.history.copy?'已另存为新会话；原会话与收藏保留。':'')+'已读取 '+data.messages.length+' 条网页消息，新增 '+merged.added+' 条；'+scope+recovery+imageSummary+(merged.retainedDifferences?'。其中 '+merged.retainedDifferences+' 轮回答与网页不同，已保留本地版本':'');
      b.history.retainedImageDifferences=merged.retainedImageDifferences||0;b.history.retainedDifferences=merged.retainedDifferences||0;b.history.recoveredAnswers=merged.recoveredAnswers||0;
      this.notify();return {accepted:true,conversationId:c.id,added:merged.added,imagePreviews:previews.length,remoteImagePreviews:remotePreviews,message:b.history.message,retainedDifferences:merged.retainedDifferences||0,recoveredAnswers:merged.recoveredAnswers||0};
    }catch(error){b.history.phase='failed';b.history.message=error.message;b.history.code=error.code;b.history.diagnostics=error.diagnostics;return {accepted:false,error:error.message,code:error.code,diagnostics:error.diagnostics};}
  }
  report(data){
    const b=this.auth(data),j=this.store.get('webJob',data.jobId);
    if(j.bindingId!==b.id||j.clientId!==b.clientId||data.lease!==j.lease)throw new Error('任务不属于当前连接');
    b.seen=this.clock();
    if(terminal.has(j.state))return {accepted:false};
    if(!Number.isInteger(data.sequence)||data.sequence<j.sequence)return {accepted:false};
    if(data.sequence===j.sequence&&j.sequence>0)return {accepted:true,repeated:true};
    if(j.state==='queued')throw new Error('任务尚未领取');
    if(data.phase==='complete'&&!data.content?.trim())throw new Error('回答为空，不能标记完成');
    if(!['waiting','streaming','complete','failed'].includes(data.phase))throw new Error('任务状态无效');
    if(typeof data.content!=='string'||data.content.length>500000)throw new Error('回答超过接收容量');
    const url=this.url(data.url);
    if(['chatgpt','gemini'].includes(this.provider)&&url!==b.url){
      const initial=new URL(b.url).pathname,changed=new URL(url).pathname;
      if(initial!==(this.provider==='chatgpt'?'/':'/app')||changed===initial)throw new Error(this.name+' 对话已切换，不能接收另一条会话的回答');
    }
    b.url=url;
    j.sequence=data.sequence;j.touched=this.clock();j.state=data.phase;
    const c=this.store.get('conversation',j.conversationId),m=c.messages.find(m=>m.id===j.messageId);
    if(data.content)m.content=data.content;
    m.phase=data.phase==='waiting'?`等待${this.name}回答`:`正在接收${this.name}回答`;
    if(data.phase==='failed'){m.status='failed';m.error=String(data.error||`网页操作未完成，请查看${this.name}；不会自动重发`).slice(0,400);}
    if(data.phase==='complete')m.status='complete';
    c.webChat.url=url;c.updatedAt=new Date().toISOString();
    this.store.transaction(()=>{this.store.put('webJob',j);this.store.put('conversation',c);});this.notify();return {accepted:true};
  }
  finish(j,state,error){
    j.state=state;
    const c=this.store.get('conversation',j.conversationId),m=c.messages.find(m=>m.id===j.messageId);
    if(m){m.status=state;m.error=error;}
    this.store.transaction(()=>{this.store.put('webJob',j);this.store.put('conversation',c);});this.notify();
  }
  cancel(){if(this.binding?.history?.phase==='loading'){this.binding.history.phase='cancelled';this.binding.history.waitingForBrowser=false;this.binding.history.message='历史同步已停止，本地记录未改变';}const j=this.active();if(j)this.finish(j,'cancelled',`已停止接收；${this.name}网页可能仍在生成，请到网页查看。`);return true;}
  disconnect(){this.cancel();this.binding=null;return true;}
}
