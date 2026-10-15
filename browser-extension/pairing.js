export function parsePairing(raw) {
  let value;try{value=JSON.parse(raw);}catch{throw new Error('请粘贴从 AI Workbench 复制的完整配对信息');}
  let url;try{url=new URL(value.url);}catch{throw new Error('配对地址无效');}
  if(value.format!=='awb-browser-v1'||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||!url.port||url.search||url.hash||url.username||url.password||!/^[a-f0-9]{64}$/.test(value.token||''))throw new Error('配对信息无效：只允许连接本机 AI Workbench');
  return {url:url.origin,token:value.token};
}
