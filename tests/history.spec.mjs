import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {collectGeminiHistory} from '../browser-extension/history.js';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
let app,page,dir;
test.beforeEach(async()=>{
  dir=mkdtempSync(join(tmpdir(),'workbench-history-'));
  app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});
  await (await app.firstWindow()).waitForFunction(()=>!!window.workbench);
  const created=app.waitForEvent('window');
  await app.evaluate(async({BrowserWindow})=>{await new BrowserWindow({width:900,height:700,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadURL('about:blank');});
  page=await created;
});
test.afterEach(async()=>{if(app)await app.close();if(dir)rmSync(dir,{recursive:true,force:true});});
async function fixture(options={}){
  return page.evaluate(options=>{
    document.title='Long conversation - Google Gemini';
    document.body.innerHTML='<style>#chat{overflow-anchor:none;height:400px;width:650px;overflow-y:auto;position:relative}#rows{position:relative}user-query,model-response{display:block;position:absolute;height:100px;width:600px;overflow:hidden}#sidebar{height:100px;overflow:auto}</style><aside id="sidebar"><div style="height:3000px">Unrelated sidebar</div></aside><main id="chat"><div id="rows"></div></main>';
    const scroller=document.querySelector('#chat'),rows=document.querySelector('#rows');
    const messages=Array.from({length:60},(_,i)=>({role:i%2?'Gemini':'我',text:i%10===0?'继续':i%10===1?'重复的回复':'消息 '+i}));
    if(options.large)for(const message of messages)message.text+=' '+('正文内容😀'.repeat(2200));
    let from=(options.lazy||options.compensated)?48:0,pending=false,jumped=false,lastRenderKey='',lastScrollTop=800;
    const render=()=>{
      rows.style.height=(messages.length-from)*100+'px';
      const index=from+Math.floor(scroller.scrollTop/100);
      const start=options.virtual?Math.max(from,index-2):from;
      const end=options.virtual?Math.min(60,index+7):60;
      const renderKey=from+':'+start+':'+end;
      if(renderKey===lastRenderKey)return;
      lastRenderKey=renderKey;
      rows.replaceChildren();
      for(let i=start;i<end;i++){
        const node=document.createElement(i%2?'model-response':'user-query');
        if(!options.noIds)node.setAttribute('data-message-id','message-'+(options.reuseIds?i%12:i));
        node.style.top=(i-from)*100+'px';
        if(options.noise){
          const body=document.createElement(i%2?'message-content':'span');
          if(i%2===0)body.className='query-text-line';
          body.textContent=messages[i].text;node.appendChild(body);
          const button=document.createElement('button');button.textContent='工具栏 '+Math.random();node.appendChild(button);
          if(i%2){const thoughts=document.createElement('model-thoughts');thoughts.innerHTML='<message-content>思考面板不应混入正文</message-content>';node.prepend(thoughts);}
        }else node.textContent=messages[i].text+(options.unbridgeable?' window '+renderKey:'');
        rows.appendChild(node);
      }
    };
    scroller.addEventListener('scroll',()=>{
      if(options.compensated&&from>0&&scroller.scrollTop<lastScrollTop&&window.__aiWorkbenchGeminiHistoryV2?.phase==='running'){
        from=Math.max(0,from-4);render();scroller.scrollTop=lastScrollTop;
      }
      lastScrollTop=scroller.scrollTop;
      if(options.gapOnce&&!jumped&&window.__aiWorkbenchGeminiHistoryV2?.phase==='running'){jumped=true;scroller.scrollTop=Math.max(0,scroller.scrollTop-1200);}
      render();
      if(options.lazy&&from>0&&scroller.scrollTop<=200&&!pending){
        pending=true;scroller.setAttribute('aria-busy','true');
        const busy=document.createElement('span');busy.setAttribute('role','progressbar');busy.textContent='loading';rows.appendChild(busy);
        setTimeout(()=>{
          const old=from;from=Math.max(0,from-12);pending=false;
          render();scroller.scrollTop+=(old-from)*100;scroller.removeAttribute('aria-busy');render();
        },options.slow?650:120);
      }
    });
    render();scroller.scrollTop=scroller.scrollHeight;render();
    return messages.map(item=>item.role+'：\n'+item.text).join('\n\n');
  },options);
}
async function finish(timeout=20000){
  await expect.poll(async()=>(await page.evaluate(collectGeminiHistory,{command:'status'})).phase,{timeout}).not.toBe('running');
  return page.evaluate(collectGeminiHistory,{command:'status'});
}
const start={command:'start',fixture:true,settleMs:30,boundaryWaitMs:240,maxDurationMs:15000};
test('history walks virtualized windows, preserves repeated turns, order and scroll position',async()=>{
  const expected=await fixture({virtual:true});
  const initial=await page.evaluate(collectGeminiHistory,start);expect(initial.phase).toBe('running');
  // Status uses the persistent page job, as after reopening the toolbar popup.
  expect((await page.evaluate(collectGeminiHistory,{command:'status'})).phase).toBe('running');
  const result=await finish();
  expect(result.phase,result.error).toBe('done');expect(result.result.content,result.result.scope).toBe(expected);
  expect(result.result.count).toBe(60);expect(result.result.reachedBoth,result.result.scope).toBe(true);
  expect(result.result.scope).not.toContain('没有重叠');
  expect(result.result.title).toBe('Long conversation');
  expect(await page.locator('#chat').evaluate(el=>el.scrollTop===el.scrollHeight-el.clientHeight)).toBe(true);
  expect(await page.locator('#sidebar').evaluate(el=>el.scrollTop)).toBe(0);
});
test('history waits for asynchronously prepended pages and retains the earliest question',async()=>{
  const expected=await fixture({lazy:true,virtual:true});
  await page.evaluate(collectGeminiHistory,start);
  const result=await finish();
  expect(result.phase).toBe('done');expect(result.result.content,result.result.scope).toBe(expected);
  expect(result.result.reachedBoth).toBe(true);
  expect(await page.locator('#chat').evaluate(el=>el.scrollTop===el.scrollHeight-el.clientHeight)).toBe(true);
});
test('history text fallback keeps repeated prompts in chronological order',async()=>{
  const expected=await fixture({virtual:true,noIds:true});
  await page.evaluate(collectGeminiHistory,start);
  const result=await finish();
  expect(result.result.content).toBe(expected);
  expect(result.result.count).toBe(60);
});
test('stopping or timing out retains partial preview and explicitly warns',async()=>{
  await fixture({virtual:true});
  await page.evaluate(collectGeminiHistory,start);
  await page.evaluate(collectGeminiHistory,{command:'cancel'});
  let result=await finish();
  expect(result.phase,result.error).toBe('done');
  expect(result.result.reachedBoth).toBe(false);
  expect(result.result.scope).toContain('部分记录');expect(result.result.scope).toContain('读取已停止');
  expect(result.result.content.length).toBeGreaterThan(0);
  await page.evaluate(collectGeminiHistory,{...start,maxDurationMs:1});
  result=await finish();expect(result.result.scope).toContain('读取超时');
});
test('changing conversations aborts instead of mixing different chats',async()=>{
  await fixture({virtual:true});
  await page.evaluate(collectGeminiHistory,start);
  await page.locator('#chat').evaluate(el=>el.remove());
  const result=await finish();
  expect(result.phase).toBe('error');expect(result.error).toContain('对话页面已切换');
});

test('reused batch IDs and toolbar noise do not erase or duplicate messages',async()=>{
  const expected=await fixture({virtual:true,reuseIds:true,noise:true});
  await page.evaluate(collectGeminiHistory,start);
  const result=await finish();
  expect(result.phase,result.error).toBe('done');
  expect(result.result.content).toBe(expected);expect(result.result.count).toBe(60);
});
test('large loaded conversation exceeds the former 500000 character ceiling',async()=>{
  const expected=await fixture({large:true,noise:true});
  expect(expected.length).toBeGreaterThan(500000);
  // Large real DOM extraction needs a longer fixture budget than the tiny-window tests.
  await page.evaluate(collectGeminiHistory,{...start,maxDurationMs:45000});
  const result=await finish(50000);
  expect(result.phase,result.error).toBe('done');expect(result.result.content).toBe(expected);
  expect(result.result.reachedBoth).toBe(true);
});
test('slow history loading waits for busy state and content to settle',async()=>{
  const expected=await fixture({virtual:true,lazy:true,slow:true});
  await page.evaluate(collectGeminiHistory,start);
  const result=await finish();
  expect(result.phase,result.error).toBe('done');expect(result.result.content).toBe(expected);
});
test('a skipped scroll window is recovered by backing up and taking smaller steps',async()=>{
  const expected=await fixture({virtual:true,gapOnce:true});
  await page.evaluate(collectGeminiHistory,start);
  const result=await finish();
  expect(result.phase,result.error).toBe('done');expect(result.result.content,result.result.scope).toBe(expected);
  expect(result.result.repairs).toBeGreaterThan(0);
});

test('unrecoverable gap stops after bounded retries without appending duplicate windows',async()=>{
  await fixture({virtual:true,unbridgeable:true});
  await page.evaluate(collectGeminiHistory,start);
  const result=await finish();
  expect(result.phase,result.error).toBe('done');
  expect(result.result.reachedBoth).toBe(false);
  expect(result.result.repairs).toBe(4);
  expect(result.result.count).toBeLessThanOrEqual(9);
  expect(result.result.scope).toContain('未能补齐');
});

test('history continues when prepending content compensates every upward scroll',async()=>{
  const expected=await fixture({virtual:true,compensated:true});
  await page.evaluate(collectGeminiHistory,start);
  const result=await finish();
  expect(result.phase,result.error).toBe('done');
  expect(result.result.content,result.result.scope).toBe(expected);
  expect(result.result.count).toBe(60);
  expect(result.result.reachedBoth,result.result.scope).toBe(true);
});

async function blockUpwardScroll(permanent){
  await page.locator('#chat').evaluate((scroller,permanent)=>{
    const native=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
    let unlocked=false;
    Object.defineProperty(scroller,'scrollTop',{
      get(){return native.get.call(this);},
      set(value){
        if(window.__aiWorkbenchGeminiHistoryV2?.phase==='running'&&!unlocked){
          if(!permanent&&value>native.get.call(this))unlocked=true;
          else return;
        }
        native.set.call(this,value);
      }
    });
  },permanent);
}
test('history recovers after a temporarily blocked scroll',async()=>{
  const expected=await fixture({virtual:true});
  await blockUpwardScroll(false);
  await page.evaluate(collectGeminiHistory,start);
  const result=await finish();
  expect(result.result.content,result.result.scope).toBe(expected);
  expect(result.result.reachedBoth).toBe(true);
  expect(result.result.diagnostics.scrollRetries).toBe(1);
});
test('history stops a real stall with bounded retries and explains counts without old totals',async()=>{
  await fixture({virtual:true});
  await blockUpwardScroll(true);
  await page.evaluate(collectGeminiHistory,start);
  let result=await finish();
  expect(result.result.reachedBoth).toBe(false);
  expect(result.result.diagnostics.stopReason).toBe('stalled');
  expect(result.result.diagnostics.scrollRetries).toBe(2);
  expect(result.result.scope).toContain('页面位置和消息内容均未变化');
  expect(result.result.scope).toContain('不叠加上次读取');
  expect(result.result.scope).not.toContain('容量上限');
  expect(result.result.diagnostics.characters).toBe(result.result.content.length);
  expect(result.result.diagnostics.questions+result.result.diagnostics.answers).toBe(result.result.count);
  expect(result.result.diagnostics).not.toHaveProperty('content');
  expect(result.result.diagnostics).not.toHaveProperty('url');
  const count=result.result.count;
  await page.evaluate(collectGeminiHistory,start);
  result=await finish();
  expect(result.result.count).toBe(count);
  // Reopening the actual popup presents this job and privacy-safe diagnostics.
  await page.addInitScript(job=>{
    window.chrome={
      storage:{local:{get:async()=>({})}},
      tabs:{query:async()=>[{id:1,url:'https://gemini.google.com/app/fixture'}]},
      scripting:{executeScript:async()=>[{result:job}]}
    };
  },{...result,result:{...result.result,url:'https://gemini.google.com/app/fixture'}});
  await page.goto(pathToFileURL(join(root,'browser-extension/popup.html')).href);
  await expect(page.locator('#scope')).toContainText('不叠加上次读取');
  await page.getByText('读取诊断（不含对话正文）',{exact:true}).click();
  const diagnostics=JSON.parse(await page.locator('#diagnostics').inputValue());
  expect(diagnostics.stopReason).toBe('stalled');
  expect(diagnostics.readerVersion).toBe('0.4.1');
  expect(diagnostics.count).toBe(count);
  await expect(page.locator('#diagnostics')).toBeVisible();
});
