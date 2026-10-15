// Runs in the extension's isolated world, only in the tab the user selected.
// No network requests, cookies, private API calls, or page-world script execution.
export function installGrokReader(){
  const root=()=>document.querySelector('[data-testid="primaryColumn"]')||document.querySelector('main, [role="main"]')||document.querySelector('[data-testid="GrokDrawer"]')||document.body;
  const selector='[data-message-author-role], [data-role="user"], [data-role="assistant"], .message-bubble, [data-testid="grokMessage"], [data-testid="message"], [data-testid="grokUserMessage"], [data-testid="grokResponse"], [data-testid="grokResponseText"], .response-content-markdown';
  const excluded='nav, aside, [role="navigation"], [data-testid="sidebarColumn"], [data-testid="tweet"], [data-testid="tweetText"]';
  const layoutMessages=new WeakMap();
  const visible=node=>!!node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';
  // Validated against the user's 0.4.4 outline: row > centred wrapper > role frame.
  // Class combinations are scoped to the observed X grid, never matched across the page.
  const layoutRows=area=>{
    const rows=[];
    for(const grid of area.querySelectorAll('div.r-6413gk.r-uef6q5')){
      if(getComputedStyle(grid).display!=='grid'||grid.closest(excluded))continue;
      const list=grid.children[0]?.children[1];
      if(!list||getComputedStyle(list).flexDirection!=='column')continue;
      for(const row of list.children){
        if(row.tagName!=='DIV'||!visible(row)||row.children.length!==1)continue;
        const center=row.children[0],frame=center.children[0];
        if(!center.matches('.r-1awozwy.r-13qz1uu')||center.children.length!==1||!frame)continue;
        const style=getComputedStyle(frame);
        if(style.display!=='flex'||style.flexDirection!=='column')continue;
        let speaker='未识别发言者',body=frame;
        if(frame.matches('.r-obd0qt.r-qn3fzs.r-11niif6')&&style.alignItems==='flex-end'){
          speaker='我';
        }else if(frame.matches('.r-1awozwy.r-16lk18l.r-13qz1uu')&&style.alignItems==='center'){
          const column=frame.children[0];
          if(column?.matches('.r-1wbh5a2.r-11niif6.r-bnwqim')){
            const content=[...column.children].find(el=>el.matches('.r-3pj75a')&&el.querySelector(':scope > .css-146c3p1.r-bcqeeo'));
            if(content){speaker='Grok';body=content;}
          }
        }
        layoutMessages.set(row,{role:speaker,body});rows.push(row);
      }
    }
    return rows;
  };
  const nodes=()=>{
    const area=root();if(!area)return [];
    const candidates=[...new Set([...layoutRows(area),...area.querySelectorAll(selector)])]
      .filter(node=>visible(node)&&!node.closest(excluded));
    const selected=new Set(candidates);
    return candidates.filter(node=>{
      for(let parent=node.parentElement;parent&&parent!==area;parent=parent.parentElement)if(selected.has(parent))return false;
      return true;
    }).sort((a,b)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
  };
  const role=node=>{
    if(layoutMessages.has(node))return layoutMessages.get(node).role;
    const value=node.getAttribute('data-message-author-role')||node.getAttribute('data-role');
    if(['user','human'].includes(value))return '我';
    if(['assistant','bot','grok'].includes(value))return 'Grok';
    if(node.matches('[data-testid="grokUserMessage"], .message-bubble.bg-surface-l1'))return '我';
    if(node.matches('[data-testid="grokResponse"], [data-testid="grokResponseText"], .response-content-markdown')||
       node.querySelector('[data-testid="grokResponseText"], .response-content-markdown'))return 'Grok';
    return '未识别发言者';
  };
  const cleanText=node=>{
    node=layoutMessages.get(node)?.body||node;
    const walk=el=>{
      if(el.nodeType===3)return el.textContent||'';
      if(el.nodeType!==1)return '';
      if(el.matches('button, [role="button"], input, textarea, [contenteditable="true"], nav, aside, header, footer, [role="navigation"], [role="banner"], [data-testid="sidebarColumn"], script, style, svg, [aria-hidden="true"], [data-testid="grokThoughts"], .thoughts-container, .action-buttons'))return '';
      const style=getComputedStyle(el);
      if(style.display==='none'||style.visibility==='hidden')return '';
      const tag=el.tagName.toLowerCase();
      if(tag==='br')return '\n';
      if(tag==='pre'){
        const codeNode=el.querySelector('code');
        const code=codeNode?.textContent??el.textContent??'',runs=code.match(/`+/g)||[];
        const classLanguage=[...(codeNode?.classList||[]),...el.classList].find(name=>name.startsWith('language-'))?.slice(9);
        const label=classLanguage||codeNode?.getAttribute('data-language')||el.getAttribute('data-language')||'';
        const language=/^[a-z0-9_+-]{1,32}$/i.test(label)?label:'';
        const fence='`'.repeat(Math.max(3,...runs.map(s=>s.length+1)));
        return '\n\n'+fence+language+'\n'+code+'\n'+fence+'\n\n';
      }
      if(tag==='table'){
        const grid=[];
        const rows=[...el.querySelectorAll('tr')].filter(row=>row.closest('table')===el);
        for(let r=0;r<rows.length;r++){
          grid[r] ||= [];let c=0;
          for(const cell of rows[r].children){
            if(!['TD','TH'].includes(cell.tagName))continue;
            while(grid[r][c]!==undefined)c++;
            const value=walk(cell).trim().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
              .replace(/\\/g,'\\\\').replace(/\|/g,'\\|').replace(/\s*\n+\s*/g,'<br>');
            const rs=Math.min(100,Math.max(1,cell.rowSpan===0?rows.length-r:cell.rowSpan));
            const cs=Math.min(100,Math.max(1,cell.colSpan||1));
            for(let y=0;y<rs&&r+y<rows.length;y++){
              grid[r+y] ||= [];
              for(let x=0;x<cs;x++)grid[r+y][c+x]=y===0&&x===0?value:'';
            }
            c+=cs;
          }
        }
        const width=Math.max(0,...grid.map(row=>row.length));
        if(!width)return '';
        const line=row=>'| '+Array.from({length:width},(_,i)=>row[i]||'').join(' | ')+' |';
        return '\n\n'+[line(grid[0]),line(Array(width).fill('---')),...grid.slice(1).map(line)].join('\n')+'\n\n';
      }
      if(tag==='tr')return '\n'+[...el.children].map(cell=>walk(cell).trim()).join(' | ')+'\n';
      if(tag==='img')return el.alt?'[图片：'+el.alt+']':'[图片]';
      const text=[...el.childNodes].map(walk).join('');
      if(/^h[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+text.trim()+'\n\n';
      if(tag==='strong'||tag==='b')return '**'+text+'**';
      if(tag==='em'||tag==='i')return '*'+text+'*';
      if(tag==='a'){
        try{
          const link=new URL(el.getAttribute('href'),location.href);
          if(['https:','http:'].includes(link.protocol)&&!link.username&&!link.password){
            const href=link.href;
            return text.trim()===href?href:text.trim()+' ('+href+')';
          }
        }catch{}
        return text;
      }
      return (['p','div','li','section','h1','h2','h3','h4','blockquote','article'].includes(tag)||(tag==='span'&&style.display==='block'))?'\n'+text+'\n':text;
    };
    return walk(node).replace(/\n{3,}/g,'\n\n').trim();
  };
  const title=()=>{
    const question=nodes().find(node=>role(node)==='我');
    return (question?cleanText(question).slice(0,80):document.title.replace(/\s*[/|–—-]\s*(X|Twitter)\s*$/i,'').trim())||'Grok 对话';
  };
  const loaded=()=>{
    const selected=window.getSelection()?.toString().trim();
    let content,scope,count=0;
    if(selected){content=selected;scope='选中的文字（只保存所选片段）';}
    else{
      const messages=nodes().map(node=>({role:role(node),text:cleanText(node)})).filter(item=>item.text);
      count=messages.length;
      if(count){
        content=messages.map(item=>item.role+'：\n'+item.text).join('\n\n');
        scope='当前页面已加载的 '+count+' 条消息；未自动加载更早历史。';
        if(messages.some(item=>item.role==='未识别发言者'))scope+='部分发言者无法确认，已保留原文并标记，请核对。';
      }else{
        const area=root();content=area?cleanText(area):'';
        scope='页面正文片段：未识别到 Grok 消息结构，可能包含页面其他文字，请在预览中检查或改用选中文字。';
      }
    }
    if(!content)throw new Error('未读到 Grok 对话，请打开 X 内的一条历史对话，或选中要保存的文字。');
    if(content.length>10000000)throw new Error('对话超过 1000 万字符，请缩小读取范围。');
    return {title:title().slice(0,150),content,url:location.href,product:'Grok',scope,count};
  };
  // Bounded structural sample only: no text, URLs, ids, labels, values or HTML.
  const structureSample=()=>{
    const area=root();if(!area)return {elementsSeen:0,truncated:false,nodes:[]};
    const areaRect=area.getBoundingClientRect(),rows=[];
    const roles=new Set(['main','article','list','listitem','button','link','textbox','dialog','group','navigation','banner']);
    const skip='svg, script, style, noscript, iframe, input, textarea, [contenteditable="true"], nav, aside, header, footer, [role="navigation"], [role="banner"]';
    let visited=0,limited=false;
    const walk=(el,path,depth)=>{
      if(++visited>4000||depth>35){limited=true;return;}
      if(el.matches(skip))return;
      const style=getComputedStyle(el);
      if(style.display==='none'||style.visibility==='hidden')return;
      const rect=el.getBoundingClientRect();
      const tag=el.tagName.toLowerCase();
      const classes=[...el.classList].filter(name=>/^(css-[a-z0-9]{6,10}|r-[a-z0-9]{5,10})$/.test(name)).slice(0,8);
      const role=el.getAttribute('role');
      const directText=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
      const percent=value=>areaRect.width?Math.round(value/areaRect.width*20)*5:0;
      const label=[path,tag,classes.map(c=>'.'+c).join(''),roles.has(role)?'role='+role:'',
        'display='+style.display,style.display.includes('flex')?'flow='+style.flexDirection+' align='+style.alignItems+' self='+style.alignSelf+' justify='+style.justifyContent:'',
        'x='+percent(rect.left-areaRect.left)+'% w='+percent(rect.width)+'%',
        directText?'text=yes':'','children='+el.children.length].filter(Boolean).join(' ');
      rows.push(label);
      [...el.children].forEach((child,index)=>{if(visited<4000)walk(child,path+'.'+index,depth+1);else limited=true;});
    };
    walk(area,'0',0);
    const selected=new Set();
    for(let i=0;i<Math.min(50,rows.length);i++)selected.add(i);
    for(let i=Math.max(0,rows.length-50);i<rows.length;i++)selected.add(i);
    if(rows.length>100)for(let i=1;i<=20;i++)selected.add(Math.floor(i*(rows.length-1)/21));
    return {elementsSeen:rows.length,truncated:limited||selected.size<rows.length,
      nodes:[...selected].sort((a,b)=>a-b).map(i=>rows[i])};
  };
  // The supplied X sample places the conversation list in the first grid column.
  // Keep this diagnostic outline alongside the narrowly scoped role rules above.
  const conversationOutline=()=>{
    const area=root();if(!area)return {candidates:[]};
    const areaRect=area.getBoundingClientRect();
    const allowedRoles=new Set(['main','article','list','listitem','button','link','textbox','dialog','group','navigation','banner']);
    const excludedBranch='button,[role="button"],input,textarea,[contenteditable="true"],svg,script,style,nav,aside,header,footer,[role="navigation"],[role="banner"]';
    const pathOf=node=>{
      const parts=[];let current=node;
      while(current&&current!==area){parts.unshift([...current.parentElement.children].indexOf(current));current=current.parentElement;}
      return current===area?'0'+(parts.length?'.'+parts.join('.'):''):'outside';
    };
    const summary=(el,path)=>{
      const s=getComputedStyle(el),r=el.getBoundingClientRect();
      const percent=value=>areaRect.width?Math.round(value/areaRect.width*20)*5:0;
      const value={path,tag:el.tagName.toLowerCase(),
        classes:[...el.classList].filter(n=>/^(css-[a-z0-9]{6,10}|r-[a-z0-9]{5,10})$/.test(n)).slice(0,8),
        display:s.display,flow:s.flexDirection,align:s.alignItems,self:s.alignSelf,justify:s.justifyContent,
        x:percent(r.left-areaRect.left),width:percent(r.width),
        visible:!!el.getClientRects().length&&s.visibility!=='hidden'&&s.display!=='none',
        directText:[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()),children:el.children.length};
      const role=el.getAttribute('role');if(allowedRoles.has(role))value.role=role;
      return value;
    };
    const branch=node=>{
      const queue=[{node,path:pathOf(node),depth:0}],sample=[];
      // Breadth first preserves outer wrappers even when one answer has thousands of spans.
      while(queue.length&&sample.length<28){
        const item=queue.shift(),el=item.node;
        sample.push(summary(el,item.path));
        if(el.matches(excludedBranch)||getComputedStyle(el).display==='none'||item.depth>=8)continue;
        [...el.children].forEach((child,i)=>{if(!child.matches('svg,script,style'))queue.push({node:child,path:item.path+'.'+i,depth:item.depth+1});});
      }
      return {nodes:sample,truncated:queue.length>0||sample.some(n=>n.path.split('.').length-pathOf(node).split('.').length>=8&&n.children>0)};
    };
    const grids=[...area.querySelectorAll('div.r-6413gk.r-uef6q5')].filter(el=>getComputedStyle(el).display==='grid'&&!el.closest(excludedBranch)).slice(0,2);
    return {basis:'observed-x-grid-layout',candidates:grids.map(grid=>{
      const column=grid.children[0],list=column?.children[1];
      const ancestors=[grid,column,list].filter(Boolean).map(el=>summary(el,pathOf(el)));
      if(!list)return {ancestors,rowCount:0,rows:[],branches:[]};
      const children=[...list.children],indices=[...new Set([0,1,2,children.length-3,children.length-2,children.length-1])].filter(i=>i>=0&&i<children.length);
      return {ancestors,rowCount:children.length,
        rows:children.slice(0,60).map(el=>({...summary(el,pathOf(el)),buttons:el.querySelectorAll('button,[role="button"]').length,tables:el.querySelectorAll('table').length})),
        rowsTruncated:children.length>60,branches:indices.map(index=>({index,...branch(children[index])}))};
    })};
  };
  const diagnose=()=>{
    const counts={};
    for(const [name,query] of Object.entries({main:'main, [role="main"]',primaryColumn:'[data-testid="primaryColumn"]',
      messageBubble:'.message-bubble',authorRole:'[data-message-author-role]',dataRole:'[data-role="user"], [data-role="assistant"]',
      messageTestId:'[data-testid="message"], [data-testid="grokMessage"]',grokResponse:'[data-testid="grokResponse"], [data-testid="grokResponseText"]',
      grokUserMessage:'[data-testid="grokUserMessage"]',markdown:'.response-content-markdown',grokDrawer:'[data-testid="GrokDrawer"]',iframe:'iframe'})){
      counts[name]=document.querySelectorAll(query).length;
    }
    return {readerVersion:'0.4.6',platform:'grok-x',readyState:document.readyState,
      adapterLoaded:true,rootFound:!!root(),bodyFallback:root()===document.body,recognizedMessages:nodes().length,structureCounts:counts,structureSample:structureSample(),conversationOutline:conversationOutline()};
  };
  window.__aiWorkbenchGrokReaderV1={version:'0.4.6',nodes,role,cleanText,title,loaded,diagnose};
  return {ready:true};
}
export function captureGrokPage(){
  try{
    if(!window.__aiWorkbenchGrokReaderV1)throw new Error('Grok 读取器未准备好，请重新点击读取');
    return window.__aiWorkbenchGrokReaderV1.loaded();
  }catch(error){
    return {phase:'error',error:error.message||'未读到页面内容',diagnostics:window.__aiWorkbenchGrokReaderV1?.diagnose?.()};
  }
}
