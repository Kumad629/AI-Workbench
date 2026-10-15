import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {browserSource} from '../browser-extension/sources.js';
import {CaptureUploads} from './capture-uploads.mjs';
export class BrowserBridge {
  constructor({getToken,importTranscript,onImport=()=>{},store}) {
    this.uploads=store?new CaptureUploads(store,importTranscript):null;
    this.getToken=getToken;this.importTranscript=importTranscript;this.onImport=onImport;this.receipts=new Map();this.server=null;
  }
  async start() {
    if(this.starting)return this.starting;
    this.starting=this.listen();
    try{return await this.starting;}catch(error){this.starting=null;throw error;}
  }
  async listen() {
    this.server=createServer((req,res)=>void this.handle(req,res));
    this.server.requestTimeout=15000;
    await new Promise((resolve,reject)=>{
      const error=e=>{if(e.code==='EADDRINUSE')this.server.listen(0,'127.0.0.1');else reject(e);};
      this.server.on('error',error);
      this.server.once('listening',()=>{this.server.off('error',error);resolve();});
      this.server.listen(43129,'127.0.0.1');
    });
    this.url='http://127.0.0.1:'+this.server.address().port;
    return this.url;
  }
  async handle(req,res) {
    const respond=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    const expectedHost='127.0.0.1:'+this.server.address().port;
    if(req.headers.host!==expectedHost){respond(403,{error:'不允许的主机'});return;}
    const origin=req.headers.origin;
    if(origin&&!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)){respond(403,{error:'仅允许本地浏览器扩展'});return;}
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    if(!['/web-chat/history','/web-chat/bind','/web-chat/poll','/web-chat/report','/capture','/status','/capture/start','/capture/chunk','/capture/commit'].includes(req.url)){respond(404,{error:'接口不存在'});return;}
    if(req.method==='OPTIONS'){
      res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','authorization, content-type');
      respond(204,{});return;
    }
    if(req.method!=='POST'){respond(405,{error:'请求方法不支持'});return;}
    let token;try{token=this.getToken();}catch{respond(503,{error:'本机连接码不可用，请回到应用重新配对'});return;}
    const provided=String(req.headers.authorization||'').replace(/^Bearer /,'');
    if(!/^[a-f0-9]{64}$/.test(provided)||!timingSafeEqual(Buffer.from(provided),Buffer.from(token))){respond(401,{error:'连接码无效，请从 AI Workbench 重新复制配对信息'});return;}
    if(req.url==='/status'){respond(200,{ok:true,app:'AI Workbench',capabilities:this.uploads?['chunkedCaptureV1','grokXCaptureV1','youtubeAskCaptureV1']:[]});return;}
    if(!String(req.headers['content-type']).startsWith('application/json')){respond(415,{error:'需要 JSON 内容'});return;}
    try {
      let bytes=0;const chunks=[];
      for await(const chunk of req){bytes+=chunk.length;if(bytes>(req.url==='/web-chat/history'?14000000:2200000)){respond(413,{error:'内容过长，请分段保存'});req.resume();return;}chunks.push(chunk);}
      let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{respond(400,{error:'无法解析保存内容'});return;}
      if(req.url.startsWith('/web-chat/')){
        if(!this.webChat)throw new Error('请重启新版工作台以启用网页聊天');
        const method={'/web-chat/history':'history','/web-chat/bind':'bind','/web-chat/poll':'poll','/web-chat/report':'report'}[req.url];
        respond(200,this.webChat[method](data));return;
      }
      if(!/^[a-zA-Z0-9-]{16,80}$/.test(data.requestId||'')){respond(400,{error:'缺少保存请求标识'});return;}
      if(req.url.startsWith('/capture/')){
        if(!this.uploads)throw new Error('请重启新版 AI Workbench 以启用长对话保存');
        const owner=this.uploads.owner(token);
        let result;
        if(req.url==='/capture/start'){
          const source=browserSource(data.url);
          result=this.uploads.start({...data,url:source.url},owner);
        }else if(req.url==='/capture/chunk')result=this.uploads.chunk(data,owner);
        else result=this.uploads.commit(data,owner);
        respond(200,result);
        if(result.conversationId&&req.url==='/capture/commit'&&!result.repeated)this.onImport(result.conversationId);
        return;
      }
      if(this.receipts.has(data.requestId)){respond(200,{ok:true,conversationId:this.receipts.get(data.requestId)});return;}
      const source=browserSource(data.url);
      const id=this.importTranscript({title:data.title,content:data.content,note:data.note||'',product:source.product,urls:[source.url]});
      this.receipts.set(data.requestId,id);
      if(this.receipts.size>500)this.receipts.delete(this.receipts.keys().next().value);
      respond(200,{ok:true,conversationId:id});
      this.onImport(id);
    }catch(error){if(!res.headersSent)respond(400,{error:error instanceof TypeError?'保存内容格式不正确':error.message,...(['WEB_CHAT_DISCONNECTED','WEB_CHAT_REPLACED'].includes(error.code)?{code:error.code}:{})});}
  }
  async close() {if(this.server?.listening){this.server.closeAllConnections();await new Promise(resolve=>this.server.close(resolve));}this.starting=null;}
}
