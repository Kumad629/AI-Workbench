import {startWebRelay} from './web-relay.js';
import {yuanbaoCommand} from './yuanbao-adapter.js';
import {grokCommand} from './grok-adapter.js';
import {doubaoCommand} from './doubao-adapter.js';
import {standardChatCommand} from './standard-chat-adapter.js';
import {webProviders} from './web-providers.js';
const readers={yuanbao:yuanbaoCommand,doubao:doubaoCommand,grok:grokCommand,chatgpt:standardChatCommand,gemini:standardChatCommand};

// One in-memory executor per connection panel. Worker termination is surfaced;
// a lost send is never replayed or automatically rebound.
export function installRelayWorker(api,createSession=startWebRelay){
 const sessions=new Map();
 api.runtime.onConnect.addListener(port=>{
  if(port.name!=='awb-web-relay'||port.sender?.id!==api.runtime.id)return;
  let source;try{source=new URL(port.sender.url);}catch{return;}
  const platform=Object.keys(readers).find(p=>source.protocol===new URL(api.runtime.getURL('/')).protocol&&source.host===new URL(api.runtime.getURL('/')).host&&source.pathname==='/'+p+'.html');
  const targetTabId=Number(source.searchParams.get('tabId'));
  if(!platform||!source.searchParams.has('tabId')||!Number.isInteger(targetTabId)||targetTabId<0){port.disconnect();return;}
  const key=platform+':'+targetTabId;let session=null,disposed=false,visible=true;
  const state={};
  const publish=(id,property,value)=>{if(disposed||!visible)return;try{port.postMessage({type:'view',id,property,value});}catch{}};
  const panel=new Proxy({},{
   get(_,id){
    if(!state[id])state[id]=new Proxy({}, {set(node,property,value){node[property]=value;if(['textContent','disabled','open'].includes(property))publish(id,property,value);return true;}});
    return state[id];
   }
  });
  const dispose=()=>{if(disposed)return;disposed=true;session?.dispose();if(sessions.get(key)?.port===port)sessions.delete(key);};
  port.onDisconnect.addListener(dispose);
  port.onMessage.addListener(message=>{
   if(disposed)return;
   if(message?.type==='visibility'){visible=message.visible===true;return;}
   if(message?.type==='start'&&!session){
    const previous=sessions.get(key);if(previous){previous.dispose();previous.port.disconnect();}
    sessions.set(key,{port,dispose});
    session=createSession({reader:readers[platform],provider:platform,name:webProviders[platform].name,panel,targetTabId});
   }else if(message?.type==='connect')session?.connect();
   else if(message?.type==='snapshot')for(const [id,node]of Object.entries(state))for(const [property,value]of Object.entries(node))if(['textContent','disabled','open'].includes(property))publish(id,property,value);
  });
 });
 return {dispose(){for(const entry of [...sessions.values()]){entry.dispose();entry.port.disconnect();}}};
}
if(typeof chrome!=='undefined'&&chrome.runtime?.onConnect)installRelayWorker(chrome);
