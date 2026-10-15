export function validateEndpoint(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('请输入完整的 API 基础地址'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含凭据、查询参数或片段');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('远程 API 必须使用 HTTPS；本地服务可以使用 HTTP');
  return url.toString().replace(/\/$/, '');
}
export async function* parseSSE(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const decodeEvent = (block) => block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
  try {
    while (true) {
      const {value, done} = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, {stream:true});
      buffer = buffer.replace(/\r\n/g, '\n');
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const data = decodeEvent(buffer.slice(0,index));
        buffer = buffer.slice(index+2);
        if (data) yield data;
      }
      if (done) {
        const data = decodeEvent(buffer);
        if (data) yield data;
        break;
      }
    }
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}
export async function streamCompletion(connection, key, messages, signal, onEvent) {
  const endpoint = validateEndpoint(connection.baseUrl) + '/chat/completions';
  const body = {model:connection.model, messages, stream:true, stream_options:{include_usage:true}};
  const response = await fetch(endpoint, {
    method:'POST', redirect:'error', signal,
    headers:{'Content-Type':'application/json', Authorization:'Bearer '+key},
    body:JSON.stringify(body)
  });
  if (!response.ok) {
    // Never persist provider response bodies: they can contain credentials or request data.
    const hints = {401:'密钥无效或已过期',403:'账号无权访问此模型',404:'模型或 API 地址不存在',429:'额度不足或请求过于频繁'};
    throw new Error('HTTP '+response.status+' · '+(hints[response.status] || '服务暂时不可用，请检查连接设置后重试'));
  }
  if (!response.body) throw new Error('服务未返回响应内容');
  let finished = false;
  for await (const data of parseSSE(response.body)) {
    if (data === '[DONE]') { finished = true; break; }
    let event;
    try { event = JSON.parse(data); } catch { throw new Error('服务返回了无法解析的流式数据'); }
    if (event.error) throw new Error('模型服务返回错误，请检查模型配置与额度');
    if (event.usage) onEvent({usage:event.usage});
    const choice = event.choices?.[0];
    if (choice?.delta?.content) onEvent({delta:choice.delta.content});
    if (choice?.delta?.reasoning_content) onEvent({reasoning:true});
    if (choice?.finish_reason) {
      if (['content_filter','error'].includes(choice.finish_reason)) throw new Error('服务中止了回答：'+choice.finish_reason);
      onEvent({finishReason:choice.finish_reason});
      finished = true;
    }
  }
  if (!finished) throw new Error('连接提前断开，已保留收到的内容');
}
