// Browser and desktop share the same official-site allowlist.
export const webProviders={
 chatgpt:{id:'chatgpt',name:'ChatGPT',home:'https://chatgpt.com/'},
 gemini:{id:'gemini',name:'Gemini',home:'https://gemini.google.com/app'},
 yuanbao:{id:'yuanbao',name:'元宝',home:'https://yuanbao.tencent.com/'},
 grok:{id:'grok',name:'Grok',home:'https://x.com/i/grok'},
 doubao:{id:'doubao',name:'豆包',home:'https://www.doubao.com/chat/'}
};
export function webChatSource(value,expected){
 const u=new URL(value);
 let provider;
 if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port){
  if(u.hostname==='chatgpt.com'&&/^\/(?:c\/[a-zA-Z0-9_-]{1,160}\/?)?$/.test(u.pathname)){provider=webProviders.chatgpt;u.search='';u.pathname=u.pathname.replace(/\/$/,'')||'/';}
  if(u.hostname==='gemini.google.com'&&/^\/app(?:\/[a-zA-Z0-9_-]{1,160})?\/?$/.test(u.pathname)){provider=webProviders.gemini;u.search='';u.pathname=u.pathname.replace(/\/$/,'');}
  if(u.hostname==='yuanbao.tencent.com')provider=webProviders.yuanbao;
  if(['www.doubao.com','doubao.com'].includes(u.hostname)&&/^\/chat(?:\/|$)/.test(u.pathname))provider=webProviders.doubao;
 }
 if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname)&&/^\/i\/grok(?:\/|$)/.test(u.pathname)){
  provider=webProviders.grok;const conversation=u.searchParams.get('conversation');
  if(conversation&&!/^[a-zA-Z0-9_-]{1,160}$/.test(conversation))throw new Error('Grok 会话编号格式不正确');
  u.search='';if(conversation)u.searchParams.set('conversation',conversation);
 }
 if(!provider||expected&&provider.id!==expected)throw new Error('请使用'+(webProviders[expected]?.name||'元宝、豆包、ChatGPT、Gemini 或 X 内的 Grok')+'官方聊天网页');
 u.hash='';return {...provider,url:u.href};
}
