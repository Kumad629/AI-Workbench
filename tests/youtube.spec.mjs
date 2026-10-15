import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {installYouTubeReader,captureYouTubePage} from '../browser-extension/youtube.js';
import {collectPageHistory} from '../browser-extension/history.js';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
let app,page,dir;
test.beforeEach(async()=>{
 dir=mkdtempSync(join(tmpdir(),'awb-youtube-'));app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});await (await app.firstWindow()).waitForFunction(()=>!!window.workbench);
 const created=app.waitForEvent('window');await app.evaluate(async({BrowserWindow})=>{await new BrowserWindow({width:1100,height:850,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadURL('about:blank');});page=await created;
 await page.route('https://www.youtube.com/**',r=>r.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));await page.goto('https://www.youtube.com/watch?v=subu-xHrp1w');
});
test.afterEach(async()=>{if(app)await app.close();if(dir)rmSync(dir,{recursive:true,force:true});});
const start={command:'start',fixture:true,settleMs:30,boundaryWaitMs:200,maxDurationMs:15000};
async function done(){await expect.poll(async()=>(await page.evaluate(collectPageHistory,{command:'status'})).phase,{timeout:20000}).not.toBe('running');return page.evaluate(collectPageHistory,{command:'status'});}
async function fixture({virtual=false,lazy=false,count=60}={}){
 await page.evaluate(({virtual,lazy,count})=>{
  document.title='视频标题 - YouTube';document.body.innerHTML=`<style>body{margin:0}#watch{height:400px;overflow:auto;width:500px}ytd-engagement-panel-section-list-renderer{display:block;width:440px;position:absolute;left:550px;top:20px}#chat{height:400px;overflow-y:auto;overflow-anchor:none}#rows{position:relative}yt-chat-user-turn-view-model,you-chat-item-view-model,yt-chat-item-view-model{display:block;height:90px;position:absolute;width:400px;overflow:hidden}markdown-div{display:block}yt-chat-input-view-model{display:block}#other{display:none}</style><main id="watch"><h1>视频简介不是提问</h1><div style="height:2000px">视频正文与评论</div></main><ytd-watch-metadata><h1>测试视频标题</h1></ytd-watch-metadata><ytd-engagement-panel-section-list-renderer target-id="PAyouchat"><div id="chat"><div id="rows"></div></div><button>推荐问题不能被提取</button><yt-chat-input-view-model><textarea>未发送的草稿</textarea><button id="send">发送</button></yt-chat-input-view-model></ytd-engagement-panel-section-list-renderer><ytd-engagement-panel-section-list-renderer id="other" target-id="PAyouchat"><yt-chat-user-turn-view-model><div class="ytChatUserTurnViewModelTextContainer">隐藏的旧会话</div></yt-chat-user-turn-view-model></ytd-engagement-panel-section-list-renderer>`;
  const chat=document.querySelector('#chat'),rows=document.querySelector('#rows');let from=lazy?count-12:0,pending=false;
  window.youtubeSends=0;document.querySelector('#send').onclick=()=>window.youtubeSends++;
  const messages=Array.from({length:count},(_,i)=>({role:i%2?'YouTube':'我',text:i%10===0?'继续':i%10===1?'重复的回答':'消息 '+i}));window.expected=messages.map(x=>x.role+'：\n'+x.text).join('\n\n');
  const render=()=>{const at=from+Math.floor(chat.scrollTop/90),lo=virtual?Math.max(from,at-3):from,hi=virtual?Math.min(count,at+8):count;rows.style.height=(count-from)*90+'px';rows.replaceChildren();
   for(let i=lo;i<hi;i++){const row=document.createElement(i%2?(i%4===1?'you-chat-item-view-model':'yt-chat-item-view-model'):'yt-chat-user-turn-view-model');row.setAttribute('data-target-id','turn-'+i);row.style.top=(i-from)*90+'px';if(i%2){row.innerHTML='<div role="alert"><markdown-div></markdown-div><button>赞</button><button>复制</button></div><div class="ytwYouChatChipsDataChipWrapper"><button>猜你想问</button></div>';row.querySelector('markdown-div').textContent=messages[i].text;}else{row.innerHTML='<div class="ytChatUserTurnViewModelTextContainer"></div>';row.firstChild.textContent=messages[i].text;}rows.append(row);}
  };
  chat.addEventListener('scroll',()=>{render();if(lazy&&from>0&&chat.scrollTop<=150&&!pending){pending=true;chat.setAttribute('aria-busy','true');setTimeout(()=>{const old=from;from=Math.max(0,from-12);render();chat.scrollTop+=(old-from)*90;chat.removeAttribute('aria-busy');pending=false;render();},100);}});
  render();chat.scrollTop=chat.scrollHeight;render();document.querySelector('#watch').scrollTop=230;window.initialWatchTop=document.querySelector('#watch').scrollTop;
 },{virtual,lazy,count});
 return page.evaluate(installYouTubeReader);
}
test('loaded 30 rounds contain only questions and answers, plus video provenance and no sending',async()=>{
 expect((await fixture()).ready).toBe(true);const result=await page.evaluate(captureYouTubePage);expect(result.content).toBe(await page.evaluate(()=>window.expected));expect(result.title).toBe('测试视频标题 · 提问');expect(result.product).toBe('YouTube 提问');expect(result.url).toContain('subu-xHrp1w');expect(result.diagnostics.questions).toBe(30);expect(result.diagnostics.answers).toBe(30);expect(JSON.stringify(result.diagnostics)).not.toContain('消息');expect(await page.evaluate(()=>window.youtubeSends)).toBe(0);
});
test('30 virtualized rounds scan inside the panel, preserve repeats and resume status',async()=>{
 await fixture({virtual:true});expect((await page.evaluate(collectPageHistory,start)).phase).toBe('running');const result=await done();expect(result.phase,result.error).toBe('done');expect(result.result.reachedBoth,result.result.scope).toBe(true);expect(result.result.content).toBe(await page.evaluate(()=>window.expected));expect(result.result.diagnostics.platform).toBe('youtube-ask');expect(await page.locator('#watch').evaluate(n=>n.scrollTop)).toBe(await page.evaluate(()=>window.initialWatchTop));expect(await page.locator('#chat').evaluate(n=>Math.abs(n.scrollTop-(n.scrollHeight-n.clientHeight)))).toBeLessThan(2);expect(await page.evaluate(()=>window.youtubeSends)).toBe(0);
});
test('older lazily loaded rounds merge in order',async()=>{await fixture({lazy:true,virtual:true});await page.evaluate(collectPageHistory,start);const result=await done();expect(result.phase,result.error).toBe('done');expect(result.result.reachedBoth,result.result.scope).toBe(true);expect(result.result.content).toBe(await page.evaluate(()=>window.expected));});
test('closed, missing or ambiguous panels never fall back to watch-page content',async()=>{
 await fixture();await page.locator('[target-id="PAyouchat"]').first().evaluate(n=>n.hidden=true);expect((await page.evaluate(installYouTubeReader)).ready).toBe(false);expect((await page.evaluate(captureYouTubePage)).phase).toBe('error');expect((await page.evaluate(collectPageHistory,start)).phase).toBe('error');
 await fixture();await page.locator('#other').evaluate(n=>n.style.display='block');expect((await page.evaluate(installYouTubeReader)).ready).toBe(false);expect((await page.evaluate(captureYouTubePage)).content).toBeUndefined();expect(await page.locator('#watch').evaluate(n=>n.scrollTop)).toBe(await page.evaluate(()=>window.initialWatchTop));
});
test('selection must stay in panel; markdown preserves headings, code and safe links',async()=>{
 await fixture({count:2});await page.locator('markdown-div').evaluate(n=>n.innerHTML='<h2>总结</h2><p><strong>重点</strong> <a href="/watch?v=subu-xHrp1w&t=62">1:02</a></p><pre>const x = 1;</pre><button>复制</button><a href="javascript:alert(1)">危险链接</a>');
 let r=await page.evaluate(captureYouTubePage);expect(r.content).toContain('## 总结');expect(r.content).toContain('**重点**');expect(r.content).toContain('[1:02](https://www.youtube.com/watch?v=subu-xHrp1w&t=62)');expect(r.content).toContain('```\nconst x = 1;\n```');expect(r.content).not.toContain('javascript:');
 await page.locator('#watch').evaluate(n=>{const r=document.createRange();r.selectNodeContents(n);const s=window.getSelection();s.removeAllRanges();s.addRange(r);});r=await page.evaluate(captureYouTubePage);expect(r.phase).toBe('error');
 await page.locator('markdown-div').evaluate(n=>{const r=document.createRange();r.selectNodeContents(n);const s=window.getSelection();s.removeAllRanges();s.addRange(r);});r=await page.evaluate(captureYouTubePage);expect(r.scope).toContain('选中的文字');expect(r.content).toContain('总结');
});
test('cancel labels partial results; navigating video invalidates the scan',async()=>{
 await fixture({virtual:true});await page.evaluate(collectPageHistory,start);await page.evaluate(collectPageHistory,{command:'cancel'});let r=await done();expect(r.phase).toBe('done');expect(r.result.reachedBoth).toBe(false);expect(r.result.scope).toContain('部分记录');expect(r.result.diagnostics.stopReason).toBe('cancelled');
 await fixture({virtual:true});await page.evaluate(collectPageHistory,start);await page.evaluate(()=>history.pushState({},'','/watch?v=abcdefghijk'));expect((await page.evaluate(collectPageHistory,{command:'status'})).phase).toBe('idle');await expect.poll(()=>page.evaluate(()=>window.__aiWorkbenchYouTubeHistoryV1.phase)).toBe('error');
});


test('popup previews and saves YouTube to the real local bridge and archive UI',async()=>{
 await fixture({count:6});const capture=await page.evaluate(captureYouTubePage);const main=await app.firstWindow();const pairing=JSON.parse((await main.evaluate(()=>window.workbench.call('browserBridgeInfo'))).pairing);
 await page.addInitScript(({capture,pairing})=>{window.chrome={storage:{local:{get:async()=>({pairing})}},tabs:{query:async()=>[{id:1,url:capture.url}]},scripting:{executeScript:async({func})=>[{result:func.name==='installYouTubeReader'?{ready:true,diagnostics:capture.diagnostics}:func.name==='captureYouTubePage'?capture:{phase:'idle'}}]}};},{capture,pairing:{url:pairing.url,token:pairing.token}});
 await page.route('http://127.0.0.1:*/**',async route=>{const req=route.request();const res=await fetch(req.url(),{method:req.method(),headers:{'Content-Type':'application/json',Authorization:req.headers().authorization},body:req.postData()});await route.fulfill({status:res.status,contentType:'application/json',body:await res.text()});});
 await page.goto(pathToFileURL(join(root,'browser-extension/popup.html')).href);await expect(page.locator('#platform')).toContainText('YouTube 提问');await expect(page.locator('#yuanbao-connect')).toBeHidden();await page.locator('#read-loaded').click();await expect(page.locator('#preview')).toBeVisible();await expect(page.locator('#ends')).toContainText('消息 5');await page.locator('#save').click();await expect(page.locator('#status')).toContainText('已保存在 AI Workbench');
 const snapshot=await main.evaluate(()=>window.workbench.call('snapshot'));const saved=snapshot.conversations.find(c=>c.source?.product==='YouTube 提问');expect(saved.source.urls).toEqual(['https://www.youtube.com/watch?v=subu-xHrp1w']);expect(saved.messages[1].content).toBe(capture.content);await expect(main.getByRole('heading',{name:saved.title,exact:true})).toBeVisible();await main.screenshot({path:join(root,'artifacts/youtube-archive-preview.png')});
});

test('short conversations fit in the panel and never scroll the video document',async()=>{await fixture({count:2});await page.evaluate(collectPageHistory,start);const result=await done();expect(result.result.reachedBoth).toBe(true);expect(result.result.count).toBe(2);expect(await page.locator('#watch').evaluate(n=>n.scrollTop)).toBe(await page.evaluate(()=>window.initialWatchTop));});
