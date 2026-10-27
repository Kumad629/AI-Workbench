import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
test('Markdown blocks preview tables, toggle source, copy exact text and preserve table excerpts',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'workbench-md-preview-'));let app;
  const table='| 阶段 | 时间 | 内容 |\n| --- | --- | --- |\n| 起步 | 1周 | 阅读与实践 |\n| 进阶 | 2周 | 完成小项目 |';
  const md='# 学习路线\n\n## 下一步\n\n'+table+'\n\n```python\nprint("hello")\n```\n';
  const raw='我：\n整理成 Markdown。\n\nGrok：\n````markdown\n'+md+'````\n\n```\n# 旧记录\n\n'+table+'\n```';
  try{
    app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir}});
    const page=await app.firstWindow();
    await app.evaluate(async({clipboard,ClipboardItem})=>{
      globalThis.savedClipboard=await Promise.all((await clipboard.read()).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))));
    });
    if(!await page.getByRole('button',{name:'保存外部对话',exact:true}).isVisible())await page.locator('.sidebar-more summary').click();
    await page.getByRole('button',{name:'保存外部对话',exact:true}).click();
    let dialog=page.getByRole('dialog',{name:'保存外部对话'});
    await dialog.getByLabel('标题',{exact:true}).fill('Markdown 阅读与复制');
    await dialog.getByLabel('对话原文').fill(raw);
    await dialog.getByRole('button',{name:'保存原文'}).click();
    const block=page.locator('.code-block').first();
    await expect(block.getByRole('heading',{name:'学习路线',exact:true})).toBeVisible();
    await expect(page.locator('.transcript table')).toHaveCount(2);
    await expect(block.locator('th')).toHaveText(['阶段','时间','内容']);
    const toolbar=block.locator(':scope > .code-block-toolbar');
    await toolbar.getByRole('button',{name:'复制代码块原文'}).click();
    await expect(block.locator(':scope > [role="status"]')).toHaveText('已复制');
    expect(await app.evaluate(async({clipboard})=>await clipboard.readText())).toBe(md);
    await toolbar.getByRole('button',{name:'源码',exact:true}).click();
    await expect(block.locator(':scope > pre > code')).toHaveText(md);
    await expect(block.locator('table')).toHaveCount(0);
    await toolbar.getByRole('button',{name:'复制代码块原文'}).click();
    expect(await app.evaluate(async({clipboard})=>await clipboard.readText())).toBe(md);
    await toolbar.getByRole('button',{name:'阅读',exact:true}).click();
    const python=block.locator('.code-block');
    await expect(python.locator('pre')).toHaveText('print("hello")\n');
    await expect(python.getByRole('button',{name:'阅读',exact:true})).toHaveCount(0);
    await python.getByRole('button',{name:'复制代码块原文'}).click();
    expect(await app.evaluate(async({clipboard})=>await clipboard.readText())).toBe('print("hello")\n');
    const td=block.locator('td').first();
    await td.evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);});
    await page.getByTestId('answer-card').getByRole('button',{name:'收藏',exact:true}).click();
    dialog=page.getByRole('dialog',{name:'保存到精选库'});
    await expect(dialog.locator('th')).toHaveText(['阶段','时间','内容']);
    await dialog.getByLabel('标题',{exact:true}).fill('Markdown 中的学习表');
    await dialog.getByRole('button',{name:'保存精选'}).click();
    const snapshot=await page.evaluate(()=>window.workbench.call('snapshot'));
    expect(snapshot.excerpts[0].content).toBe(table);
    expect(snapshot.conversations[0].messages.find(m=>m.isTranscript).content).toBe(raw);
    const rejected=await page.evaluate(async()=>{try{await window.workbench.call('copyText',{text:{bad:true}});return false;}catch{return true;}});
    expect(rejected).toBe(true);
    await page.addStyleTag({content:'.composer-area{display:none}'});
    await page.setViewportSize({width:1440,height:1100});
    if(await page.getByLabel('关闭提示').isVisible())await page.getByLabel('关闭提示').click();
    mkdirSync(join(root,'artifacts'),{recursive:true});
    await block.screenshot({path:join(root,'artifacts/markdown-reader.png')});
    await page.getByRole('button',{name:/^精选库/}).click();
    await expect(page.locator('.excerpt-card table')).toHaveCount(1);
  }finally{
    if(app){await app.evaluate(async({clipboard})=>{if(globalThis.savedClipboard)await clipboard.write(globalThis.savedClipboard);}).catch(()=>{});await app.close();}
    rmSync(dir,{recursive:true,force:true});
  }
});
