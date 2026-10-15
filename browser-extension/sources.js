// Shared by the popup and desktop. Never trust a client-provided product label.
export function browserSource(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port)throw new Error('仅支持 Gemini、X 内 Grok 或 YouTube 视频提问页面');
  let product;
  if(url.hostname==='gemini.google.com'&&/^\/(app|share)(\/|$)/.test(url.pathname)){
    product='Gemini';url.search='';
  }else if(['x.com','www.x.com','twitter.com','www.twitter.com'].includes(url.hostname)&&/^\/i\/grok(?:\/|$)/.test(url.pathname)){
    product='Grok';
    const conversation=url.searchParams.get('conversation');
    if(conversation&&!/^[a-zA-Z0-9_-]{1,160}$/.test(conversation))throw new Error('Grok 会话编号格式不正确');
    url.search='';if(conversation)url.searchParams.set('conversation',conversation);
  }else if(['www.youtube.com','youtube.com'].includes(url.hostname)&&url.pathname==='/watch'){
    const video=url.searchParams.get('v');if(!video||!/^[a-zA-Z0-9_-]{11}$/.test(video)||url.searchParams.getAll('v').length!==1)throw new Error('YouTube 视频编号格式不正确');
    product='YouTube 提问';url.hostname='www.youtube.com';url.search='';url.searchParams.set('v',video);
  }else throw new Error('请打开 Gemini、X 内 Grok 或带提问侧边栏的 YouTube 视频');
  url.hash='';
  return {product,url:url.toString()};
}
