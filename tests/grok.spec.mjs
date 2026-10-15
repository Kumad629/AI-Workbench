import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {installGrokReader,captureGrokPage} from '../browser-extension/grok.js';
import {collectPageHistory} from '../browser-extension/history.js';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
let app,page,dir;
test.beforeEach(async()=>{
  dir=mkdtempSync(join(tmpdir(),'workbench-grok-dom-'));
  app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});
  await (await app.firstWindow()).waitForFunction(()=>!!window.workbench);
  const created=app.waitForEvent('window');
  await app.evaluate(async({BrowserWindow})=>{await new BrowserWindow({width:900,height:700,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadURL('about:blank');});
  page=await created;
  await page.route('https://x.com/**',route=>route.fulfill({contentType:'text/html',body:'<html><title>Grok / X</title><body></body></html>'}));
  await page.goto('https://x.com/i/grok?conversation=fixture-123&s=20');
});
test.afterEach(async()=>{if(app)await app.close();if(dir)rmSync(dir,{recursive:true,force:true});});
const start={command:'start',fixture:true,platform:'grok',settleMs:30,boundaryWaitMs:240,maxDurationMs:15000};
async function finish(){
  await expect.poll(async()=>(await page.evaluate(collectPageHistory,{command:'status'})).phase,{timeout:20000}).not.toBe('running');
  const job=await page.evaluate(collectPageHistory,{command:'status'});
  expect(job.phase,job.error).toBe('done');return job;
}
async function example(){
  await page.setContent('<title>Grok / X</title><nav>私信 通知</nav><main><div data-testid="primaryColumn"><div data-message-author-role="user" class="message-bubble">这个观点呢？<a href="/person/status/123">原推文</a></div><div data-message-author-role="assistant" class="message-bubble"><div class="response-content-markdown"><p>先验证需求。</p><p><a href="https://example.org/report">参考报告</a></p><a href="javascript:alert(1)">无效链接</a></div><div class="thoughts-container">内部思考面板</div><button>复制回答</button></div><div class="message-bubble">未确定身份的原文</div><article data-testid="tweet"><div class="message-bubble">页面推荐推文</div></article><textarea>未发送草稿</textarea></div></main><aside><div class="message-bubble">历史列表</div></aside>');
  await page.evaluate(installGrokReader);
}
test('Grok extraction preserves links, excludes controls and does not invent unknown speakers',async()=>{
  await example();
  const result=await page.evaluate(captureGrokPage);
  expect(result.count).toBe(3);
  expect(result.content).toContain('我：\n这个观点呢？原推文 (https://x.com/person/status/123)');
  expect(result.content).toContain('Grok：\n先验证需求。');
  expect(result.content).toContain('参考报告 (https://example.org/report)');
  expect(result.content).toContain('未识别发言者：\n未确定身份的原文');
  for(const text of ['私信','复制回答','内部思考面板','历史列表','页面推荐推文','未发送草稿','javascript:'])expect(result.content).not.toContain(text);
  await page.evaluate(collectPageHistory,start);
  const job=await finish();
  expect(job.result.count).toBe(3);
  expect(job.result.diagnostics.unknown).toBe(1);
  expect(job.result.diagnostics.questions).toBe(1);
  expect(job.result.diagnostics.answers).toBe(1);
  expect(job.result.product).toBe('Grok');
});
test('Grok virtual history keeps repeated prompts in sequence',async()=>{
  const expected=await page.evaluate(()=>{
    document.body.innerHTML='<style>#chat{height:400px;overflow:auto;overflow-anchor:none}#rows{height:4000px;position:relative}.message-bubble{position:absolute;height:100px;width:600px}</style><main data-testid="primaryColumn" id="chat"><div id="rows"></div></main>';
    const chat=document.querySelector('#chat'),rows=document.querySelector('#rows');
    const messages=Array.from({length:40},(_,i)=>({role:i%2?'assistant':'user',text:i%4===0?'继续':'消息 '+i}));
    function render(){
      const index=Math.floor(chat.scrollTop/100);
      rows.replaceChildren();
      for(let i=Math.max(0,index-2);i<Math.min(40,index+7);i++){
        const node=document.createElement('div');node.className='message-bubble';node.dataset.messageAuthorRole=messages[i].role;
        node.dataset.messageId=String(i);node.style.top=i*100+'px';node.textContent=messages[i].text;rows.appendChild(node);
      }
    }
    chat.addEventListener('scroll',render);chat.scrollTop=3600;render();
    return messages.map(m=>(m.role==='user'?'我':'Grok')+'：\n'+m.text).join('\n\n');
  });
  await page.evaluate(installGrokReader);
  await page.evaluate(collectPageHistory,start);
  const result=await finish();
  expect(result.result.content,result.result.scope).toBe(expected);
  expect(result.result.reachedBoth).toBe(true);
  expect(result.result.count).toBe(40);
});
test('Grok selection and unrecognized-page fallback explicitly describe their scope',async()=>{
  await page.setContent('<main><p id="text">仅保存这一句</p><p>另一段正文</p><textarea>未发送草稿</textarea></main>');
  await page.evaluate(installGrokReader);
  const failed=await page.evaluate(collectPageHistory,start);
  expect(failed.phase).toBe('error');expect(failed.code).toBe('messages-not-found');
  expect(failed.diagnostics.structureCounts.main).toBe(1);
  expect(failed.diagnostics.recognizedMessages).toBe(0);
  expect(JSON.stringify(failed.diagnostics)).not.toContain('仅保存这一句');
  expect((await page.evaluate(collectPageHistory,{command:'status'})).code).toBe('messages-not-found');
  await page.locator('#text').evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
  let result=await page.evaluate(captureGrokPage);
  expect(result.content).toBe('仅保存这一句');expect(result.scope).toContain('选中的文字');
  await page.evaluate(()=>getSelection().removeAllRanges());
  result=await page.evaluate(captureGrokPage);
  expect(result.scope).toContain('未识别到 Grok 消息结构');
  expect(result.content).toContain('另一段正文');expect(result.content).not.toContain('未发送草稿');
});
test('Grok popup saves to the actual desktop bridge with conversation and tweet links',async()=>{
  await example();
  const capture=await page.evaluate(captureGrokPage);
  const main=await app.firstWindow();
  const info=await main.evaluate(()=>window.workbench.call('browserBridgeInfo'));
  const pairing=JSON.parse(info.pairing);
  await page.addInitScript(({capture,pairing})=>{
    window.chrome={
      storage:{local:{get:async()=>({pairing})}},
      tabs:{query:async()=>[{id:1,url:capture.url}]},
      scripting:{executeScript:async({func})=>{
        if(func.name==='installGrokReader')return [{result:{ready:true}}];
        if(func.name==='captureGrokPage')return [{result:capture}];
        return [{result:{phase:'idle'}}];
      }}
    };
  },{capture,pairing:{url:pairing.url,token:pairing.token}});
  // Only proxy the popup's local bridge calls; no real X account is accessed.
  await page.route('http://127.0.0.1:*/**',async route=>{
    const req=route.request();
    const response=await fetch(req.url(),{method:req.method(),headers:{'Content-Type':'application/json',Authorization:req.headers().authorization},body:req.postData()});
    await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
  });
  await page.goto(pathToFileURL(join(root,'browser-extension/popup.html')).href);
  await expect(page.locator('#platform')).toContainText('Grok（X 内）');
  await page.locator('#read-loaded').click();
  await expect(page.locator('#preview')).toBeVisible();
  await expect(page.locator('#source')).toHaveText('https://x.com/i/grok?conversation=fixture-123');
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('已保存在 AI Workbench');
  const snapshot=await main.evaluate(()=>window.workbench.call('snapshot'));
  const saved=snapshot.conversations.find(c=>c.source?.product==='Grok');
  expect(saved.source.urls).toEqual(['https://x.com/i/grok?conversation=fixture-123']);
  expect(saved.messages[1].content).toContain('https://x.com/person/status/123');
  await expect(main.getByRole('heading',{name:saved.title,exact:true})).toBeVisible();
});

test('Grok drawer without main is readable and excludes navigation and drafts',async()=>{
  await page.setContent('<nav>导航私信</nav><div data-testid="GrokDrawer"><div class="message-bubble" data-role="user">一个问题</div><div class="message-bubble" data-role="assistant">一个回答</div><textarea>草稿</textarea></div>');
  await page.evaluate(installGrokReader);
  const loaded=await page.evaluate(captureGrokPage);
  expect(loaded.content).toBe('我：\n一个问题\n\nGrok：\n一个回答');
  await page.evaluate(collectPageHistory,start);
  const job=await finish();
  expect(job.result.count).toBe(2);expect(job.result.reachedBoth).toBe(true);
});
test('Grok body fallback and empty pages return explicit results, not lost exceptions',async()=>{
  await page.setContent('<header>全站导航</header><section>没有 main 的页面正文</section><textarea>草稿</textarea>');
  await page.evaluate(installGrokReader);
  const failed=await page.evaluate(collectPageHistory,start);
  expect(failed.code).toBe('messages-not-found');
  expect(failed.diagnostics.bodyFallback).toBe(true);
  let partial=await page.evaluate(captureGrokPage);
  expect(partial.content).toBe('没有 main 的页面正文');
  expect(partial.scope).toContain('页面正文片段');
  await page.setContent('<nav>导航</nav><textarea>草稿</textarea>');
  partial=await page.evaluate(captureGrokPage);
  expect(partial.phase).toBe('error');
  expect(partial.diagnostics.recognizedMessages).toBe(0);
});
test('popup displays actual startup diagnostics and an explicitly partial preview',async()=>{
  await page.setContent('<main>可预览的原文</main>');
  await page.evaluate(installGrokReader);
  const failed=await page.evaluate(collectPageHistory,start);
  const partial=await page.evaluate(captureGrokPage);
  await page.addInitScript(({failed,partial})=>{
    window.chrome={storage:{local:{get:async()=>({})}},tabs:{query:async()=>[{id:1,url:partial.url}]},
      scripting:{executeScript:async({func,args})=>{
        if(func.name==='installGrokReader')return [{result:{ready:true}}];
        if(func.name==='captureGrokPage')return [{result:partial}];
        return [{result:args?.[0]?.command==='start'?failed:{phase:'idle'}}];
      }}};
  },{failed,partial});
  await page.goto(pathToFileURL(join(root,'browser-extension/popup.html')).href);
  await page.locator('#read').click();
  await expect(page.locator('#status')).toContainText('未执行历史扫描');
  await expect(page.locator('#preview')).toBeVisible();
  await expect(page.locator('#scope')).toContainText('页面正文片段');
  expect(await page.locator('#content').inputValue()).toBe('可预览的原文');
  await page.locator('#diagnostics-details summary').click();
  const diagnostics=JSON.parse(await page.locator('#diagnostics').inputValue());
  expect(diagnostics.structureCounts.main).toBe(1);
  expect(JSON.stringify(diagnostics)).not.toContain('可预览的原文');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedDiagnosis=text;}}}));
  await page.getByRole('button',{name:'复制读取诊断',exact:true}).click();
  expect(await page.evaluate(()=>window.copiedDiagnosis)).toBe(await page.locator('#diagnostics').inputValue());
  await expect(page.locator('#status')).toContainText('已复制读取诊断');
  await expect(page.locator('#read')).toBeEnabled();
});
test('both popup buttons expose missing injection results even without a preview',async()=>{
  await page.addInitScript(()=>{
    window.chrome={storage:{local:{get:async()=>({})}},tabs:{query:async()=>[{id:1,url:'https://x.com/i/grok?conversation=fixture'}]},
      scripting:{executeScript:async({func,args})=>{
        if(func.name==='installGrokReader')return [{result:{ready:true}}];
        if(args?.[0]?.command==='status')return [{result:{phase:'idle'}}];
        return [{frameId:0}];
      }}};
  });
  await page.goto(pathToFileURL(join(root,'browser-extension/popup.html')).href);
  for(const [button,stage]of [['read','start'],['read-loaded','loaded']]){
    await page.locator('#'+button).click();
    await expect(page.locator('#status')).toContainText('读取脚本没有返回结果');
    await expect(page.locator('#preview')).toBeHidden();
    await expect(page.locator('#diagnostics-details')).toBeVisible();
    const diagnostics=JSON.parse(await page.locator('#diagnostics').inputValue());
    expect(diagnostics.stage).toBe(stage);expect(diagnostics.hasFrameResult).toBe(true);
    await expect(page.locator('#'+button)).toBeEnabled();
  }
});

test('Grok structural diagnosis is bounded and omits content and identifying attributes',async()=>{
  await page.route('https://private.example/**',r=>r.abort());
  await page.setContent('<main data-testid="primaryColumn" id="account-secret-123"><div class="css-175oi2r r-13awgt0 account-secret-123" aria-label="PRIVATE_LABEL"><a href="https://private.example/account">PRIVATE_CHAT_CONTENT</a><input value="PRIVATE_INPUT"><textarea>PRIVATE_DRAFT</textarea><img src="https://private.example/image" alt="PRIVATE_ALT"></div></main>');
  await page.evaluate(installGrokReader);
  let diagnostics=await page.evaluate(()=>window.__aiWorkbenchGrokReaderV1.diagnose());
  let raw=JSON.stringify(diagnostics);
  for(const value of ['PRIVATE_CHAT_CONTENT','PRIVATE_INPUT','PRIVATE_DRAFT','PRIVATE_ALT','PRIVATE_LABEL','account-secret-123','private.example'])expect(raw).not.toContain(value);
  expect(raw).toContain('css-175oi2r');
  expect(diagnostics.structureSample.nodes.some(line=>line.includes('text=yes'))).toBe(true);
  await page.locator('main').evaluate(root=>{
    root.replaceChildren();
    for(let i=0;i<1000;i++){const div=document.createElement('div');div.textContent='PRIVATE_ROW_'+i;root.appendChild(div);}
  });
  diagnostics=await page.evaluate(()=>window.__aiWorkbenchGrokReaderV1.diagnose());
  expect(diagnostics.structureSample.truncated).toBe(true);
  expect(diagnostics.structureSample.nodes.length).toBeLessThanOrEqual(120);
  expect(JSON.stringify(diagnostics).length).toBeLessThan(70000);
  expect(JSON.stringify(diagnostics)).not.toContain('PRIVATE_ROW');
});

test('Grok preserves real tables with links, line breaks, pipes and merged cells',async()=>{
  await page.setContent('<main><div data-role="assistant"><h2>学习路径</h2><table><tr><th>阶段</th><th>时间</th><th>内容</th></tr><tr><td rowspan="2">起步</td><td>1周</td><td>A|B<br>第二行</td></tr><tr><td>2周</td><td><a href="https://example.org/course">课程</a></td></tr></table></div></main>');
  await page.evaluate(installGrokReader);
  const result=await page.evaluate(captureGrokPage);
  expect(result.content).toContain('## 学习路径');
  expect(result.content).toContain('| 阶段 | 时间 | 内容 |\n| --- | --- | --- |');
  expect(result.content).toContain('A\\|B<br>第二行');
  expect(result.content).toContain('|  | 2周 | 课程 (https://example.org/course) |');
});

test('X outline keeps outer rows despite a huge answer and never infers roles from row order',async()=>{
  await page.setContent('<style>.layout{display:grid}.column,.messages,.row{display:flex;flex-direction:column}.bubble{align-self:flex-end;max-width:70%}</style><main data-testid="primaryColumn"><div class="layout r-6413gk r-uef6q5"><div class="column"><div><button>PRIVATE_TOOLBAR</button></div><div class="messages"></div></div><aside>PRIVATE_SIDEBAR</aside></div></main>');
  await page.locator('.messages').evaluate(list=>{
    for(let i=0;i<21;i++){
      const row=document.createElement('div');row.className='row';row.id='PRIVATE_ID_'+i;
      row.setAttribute('aria-label','PRIVATE_LABEL');
      const body=document.createElement('div');if(i%2)body.className='bubble';
      let inner=body;
      for(let depth=0;depth<6;depth++){const wrapper=document.createElement('div');inner.appendChild(wrapper);inner=wrapper;}
      const text=document.createElement('span');text.textContent='PRIVATE_CHAT_'+i;inner.appendChild(text);
      if(i===2)for(let n=0;n<4500;n++){const span=document.createElement('span');span.textContent='PRIVATE_LONG_'+n;inner.appendChild(span);}
      const button=document.createElement('button');button.textContent='PRIVATE_BUTTON';row.append(body,button);
      list.appendChild(row);
    }
    const input=document.createElement('textarea');input.value='PRIVATE_DRAFT';list.lastChild.appendChild(input);
    const link=document.createElement('a');link.href='https://private.example/secret';link.textContent='PRIVATE_LINK';list.firstChild.appendChild(link);
  });
  await page.evaluate(installGrokReader);
  const diagnostics=await page.evaluate(()=>window.__aiWorkbenchGrokReaderV1.diagnose());
  expect(diagnostics.readerVersion).toBe('0.4.6');
  expect(diagnostics.recognizedMessages).toBe(0);
  expect(diagnostics.structureSample.truncated).toBe(true);
  const outline=diagnostics.conversationOutline.candidates[0];
  expect(outline.rowCount).toBe(21);expect(outline.rows).toHaveLength(21);
  expect(outline.branches.map(row=>row.index)).toEqual([0,1,2,18,19,20]);
  for(const row of outline.branches)expect(row.nodes.length).toBeLessThanOrEqual(28);
  expect(outline.branches[1].nodes.some(node=>node.self==='flex-end')).toBe(true);
  const raw=JSON.stringify(diagnostics);
  for(const value of ['PRIVATE_','private.example'])expect(raw).not.toContain(value);
  expect(raw.length).toBeLessThan(100000);
  // A grid without the observed X signature should not be treated as this list.
  await page.locator('.layout').evaluate(el=>el.className='layout');
  expect((await page.evaluate(()=>window.__aiWorkbenchGrokReaderV1.diagnose())).conversationOutline.candidates).toHaveLength(0);
});

const observedLayout=JSON.parse(readFileSync(join(root,'tests/fixtures/grok-x-layout.json'),'utf8'));
async function observedConversation(){
  await page.setContent('<style>main{height:450px;overflow:auto}.grid{display:grid}.column,.list{display:flex;flex-direction:column}</style><main data-testid="primaryColumn"><div class="grid r-6413gk r-uef6q5"><div class="column"><div><button>HEADER_NOISE</button></div><div class="list"></div></div><aside>SIDEBAR_NOISE</aside></div></main>');
  await page.evaluate(fixtures=>{
    const list=document.querySelector('.list');
    function make(index,number){
      const sample=fixtures.find(f=>f.index===index),byPath=new Map();
      for(const n of [...sample.nodes].sort((a,b)=>a.path.split('.').length-b.path.split('.').length)){
        const el=document.createElement(n.tag);el.className=n.classes.join(' ');
        Object.assign(el.style,{display:n.display,flexDirection:n.flow,alignItems:n.align,alignSelf:n.self});
        if(n.role)el.setAttribute('role',n.role);
        byPath.set(n.path,el);
        if(n.path){const parts=n.path.split('.');const position=Number(parts.pop()),parent=byPath.get(parts.join('.'));while(parent.children.length<=position)parent.appendChild(document.createElement('div'));parent.replaceChild(el,parent.children[position]);}
      }
      const row=byPath.get('');
      if(index===1){
        const card=byPath.get('.0.0.0.0.1');
        card.appendChild(Object.assign(document.createElement('p'),{textContent:'引用推文：这个观点如何验证？'}));
        const link=document.createElement('a');link.href='/author/status/123';link.textContent='原推文';card.appendChild(link);
      }else if(index===33){
        byPath.get('.0.0.0.0.0.0.0.0').textContent='继续讨论 '+number;
      }else{
        const text=byPath.get(index===2?'.0.0.0.2.0.0':'.0.0.0.1.0.0');
        text.innerHTML='<p>回答 '+number+'</p><table><tr><th>阶段</th><th>内容</th></tr><tr><td>起步</td><td>验证想法</td></tr></table>';
        const thoughts=row.querySelector('.r-nhe8su.r-yn5ncy.r-clrlgt');thoughts.appendChild(Object.assign(document.createElement('div'),{textContent:'THOUGHT_PANEL_NOISE'}));
        for(const button of row.querySelectorAll('button'))button.textContent='BUTTON_NOISE';
        const actions=byPath.get(index===2?'.0.0.2':'.0.0.1');actions.appendChild(Object.assign(document.createElement('span'),{textContent:'ACTION_LABEL_NOISE'}));
      }
      return row;
    }
    list.appendChild(document.createElement('span'));
    for(let i=0;i<17;i++)list.append(make(i===0?1:33,i),make(i===0?2:34,i));
    list.appendChild(document.createElement('span'));
    // Two consecutive user messages must remain users: no odd/even inference.
    list.insertBefore(list.children[3],list.children[2]);
    const hidden=make(33,999);hidden.style.display='none';list.appendChild(hidden);
    const editor=document.createElement('textarea');editor.value='UNSENT_DRAFT';document.querySelector('.column').appendChild(editor);
  },observedLayout);
  await page.evaluate(installGrokReader);
}
test('observed X layout reads 34 messages, preserves quoted tweets and tables, then renders left/right',async()=>{
  await observedConversation();
  const result=await page.evaluate(captureGrokPage);
  expect(result.count).toBe(34);
  const roles=await page.evaluate(()=>{const a=window.__aiWorkbenchGrokReaderV1;return a.nodes().map(a.role);});
  expect(roles.slice(0,3)).toEqual(['我','我','Grok']);
  expect(roles.filter(r=>r==='我')).toHaveLength(17);
  expect(roles.filter(r=>r==='Grok')).toHaveLength(17);
  expect(result.content).toContain('原推文 (https://x.com/author/status/123)');
  expect(result.content).toContain('| 阶段 | 内容 |\n| --- | --- |');
  for(const noise of ['HEADER_NOISE','SIDEBAR_NOISE','THOUGHT_PANEL_NOISE','BUTTON_NOISE','ACTION_LABEL_NOISE','UNSENT_DRAFT','999'])expect(result.content).not.toContain(noise);
  await page.evaluate(collectPageHistory,start);
  const job=await finish();
  expect(job.result.count).toBe(34);
  expect(job.result.diagnostics).toMatchObject({readerVersion:'0.4.6',questions:17,answers:17,unknown:0});
  expect(job.result.content).toBe(result.content);
  const workbench=await app.firstWindow();
  await workbench.getByRole('button',{name:'保存外部对话',exact:true}).click();
  const dialog=workbench.getByRole('dialog',{name:'保存外部对话'});
  await dialog.getByLabel('标题',{exact:true}).fill('真实布局回归样例');
  await dialog.getByLabel('对话原文').fill(result.content);
  await dialog.getByRole('button',{name:'保存原文'}).click();
  await expect(workbench.locator('.transcript-user')).toHaveCount(17);
  await expect(workbench.locator('.transcript-assistant')).toHaveCount(17);
  await expect(workbench.locator('.transcript table')).toHaveCount(17);
});
test('X layout stays scoped, deduplicates nested legacy markers, and leaves unfamiliar roles unknown',async()=>{
  await observedConversation();
  await page.evaluate(()=>{
    const list=document.querySelector('.list');
    // Unknown frame in a known message wrapper must not inherit the next role.
    list.children[1].children[0].children[0].className='unfamiliar-frame';
    const nested=document.createElement('div');nested.className='message-bubble';nested.textContent='嵌套内容';
    list.children[2].children[0].children[0].appendChild(nested);
    const outside=list.children[2].cloneNode(true);document.body.appendChild(outside);
  });
  const result=await page.evaluate(captureGrokPage);
  // Even a legacy marker outside the primary column is outside the capture scope.
  expect(result.count).toBe(34);
  expect(result.content.match(/未识别发言者：/g)).toHaveLength(1);
  expect(result.content.match(/嵌套内容/g)).toHaveLength(1);
  await page.locator('.grid').evaluate(grid=>grid.classList.remove('r-6413gk'));
  const noGrid=await page.evaluate(captureGrokPage);
  expect(noGrid.count).toBe(1);
});

test('Grok keeps Markdown language and code body without code toolbar text',async()=>{
  await page.setContent('<main><div data-role="assistant"><pre><button>复制</button><code class="language-markdown"></code></pre></div></main>');
  const content='# 标题\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
  await page.locator('code').evaluate((el,text)=>el.textContent=text,content);
  await page.evaluate(installGrokReader);
  const result=await page.evaluate(captureGrokPage);
  expect(result.content).toBe('Grok：\n```markdown\n'+content+'\n```');
});
