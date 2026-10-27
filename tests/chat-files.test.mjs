import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {zipSync,strToU8} from 'fflate';
import {extractChatFile} from '../electron/chat-file-extract.mjs';
import {readChatFile} from '../electron/chat-files.mjs';
import {docxBytes,pptxBytes,spreadsheetBytes,legacyPptBytes,documentText} from './fixtures/chat-files.mjs';
const read=(name,bytes,limit=100000)=>readChatFile({name,bytes,limit});
test('plain MD, TXT and CSV decode Unicode and retain the exact input',async()=>{
 for(const name of ['规则.md','中文.TXT','数据.csv','数据.tsv']){const content='第一行\r\n第二行：事实、判断与来源\n';const r=await read(name,Buffer.from('\ufeff'+content));assert.equal(r.content,content.replace(/\r\n/g,'\n'));assert.equal(r.name,name);}
 const le=await read('旧编码.txt',Buffer.concat([Buffer.from([255,254]),Buffer.from('你好，世界','utf16le')]));assert.equal(le.content,'你好，世界');assert.match(le.notice,/UTF-16LE/);
 const gb=await read('中文.txt',Buffer.from([0xc4,0xe3,0xba,0xc3]));assert.equal(gb.content,'你好');assert.match(gb.notice,/GB18030/);
});
test('DOCX paragraphs, tables, footnotes and footer are read; deletions and field instructions are excluded',async()=>{
 const r=await read('季度资料.docx',docxBytes());assert.match(r.content,new RegExp(documentText));assert.match(r.content,/\| 指标 \| 本季 \|/);assert.match(r.content,/\| 收入 \| 120 \|/);assert.match(r.content,/注：口径保持一致/);assert.match(r.content,/来源：公开季度报告/);assert.doesNotMatch(r.content,/已删除|DDE/);assert.match(r.notice,/不含图片/);
});
test('legacy Word uses actual OLE fixture and preserves Unicode and reviewed text',async()=>{
 const r=await read('旧Word.doc',readFileSync(new URL('./fixtures/word-legacy.doc',import.meta.url)));assert.match(r.content,/This is a test of reviewing/);assert.match(r.content,/😀 ∀/);assert.match(r.content,/This text has been inserted/);
});
for(const ext of ['xls','xlsx'])test(ext+' preserves sheets, hidden label, formatted percentages and merged-cell coordinates',async()=>{
 const r=await read('季度财务.'+ext,spreadsheetBytes(ext));assert.match(r.content,/工作表：业绩/);assert.match(r.content,/收入 \| 120 \| 12\.5%/);assert.match(r.content,/隐藏备忘（隐藏）/);assert.match(r.content,/回款进度/);assert.match(r.content,/合并单元格：A5:B5/);if(ext==='xlsx'){assert.match(r.content,/公式：=SUM\(B2:B3\)/);assert.match(r.content,/文件内缓存结果/);}
});
test('PPTX follows relationship ordering rather than filenames; notes exclude slide numbers and external links',async()=>{
 const r=await read('展示.pptx',pptxBytes());assert.ok(r.content.indexOf('第一页')<r.content.indexOf('第二页'));assert.match(r.content,/备注：核对披露原文/);assert.doesNotMatch(r.content,/999|private\.png/);assert.match(r.content,/## 第 2 页/);
});
test('binary PPT keeps slide sequence and speaker notes',async()=>{
 const r=await read('旧展示.ppt',legacyPptBytes());assert.ok(r.content.indexOf('旧版第一页')<r.content.indexOf('旧版第二页'));assert.match(r.content,/旧版演讲备注/);assert.match(r.content,/现金流80/);
});
test('oversized, encrypted/mismatched, empty and binary inputs fail without partial content',async()=>{
 for(const [name,bytes,pattern] of [['空.txt',new Uint8Array(),/空/],['假.docx',Buffer.from('not zip'),/加密|格式/],['假.ppt',Buffer.from('not ppt'),/格式/],['假.xls',Buffer.from('not xls'),/格式/],['太大.txt',new Uint8Array(1024*1024+1),/1 MB/],['太大.docx',new Uint8Array(10*1024*1024+1),/10 MB/],['字节.md',Buffer.from([0xff,0x80]),/UTF-8/],['二进制.txt',Buffer.from('a\0b'),/文本/],['未知.exe',Buffer.from('x'),/支持/]])await assert.rejects(read(name,bytes),pattern);
 for(const [name,bytes] of [['长.txt',Buffer.from('x'.repeat(101))],['长.docx',docxBytes()],['长.xlsx',spreadsheetBytes()],['长.pptx',pptxBytes()],['长.ppt',legacyPptBytes()]])await assert.rejects(read(name,bytes,50),/超过/);
});
test('ZIP expansion and XML entities are rejected before text extraction',async()=>{
 const bomb=zipSync({'word/document.xml':new Uint8Array(9*1024*1024)});await assert.rejects(read('大正文.docx',bomb),/8 MB/);
 const dtd=zipSync({'word/document.xml':strToU8('<!DOCTYPE d [<!ENTITY x SYSTEM "file:///not-read">]><w:document xmlns:w="x"><w:body><w:p><w:t>&x;</w:t></w:p></w:body></w:document>')});await assert.rejects(read('实体.docx',dtd),/实体/);
 const image=zipSync({'word/document.xml':strToU8('<w:document xmlns:w="x"><w:body><w:p><w:drawing/></w:p></w:body></w:document>')});await assert.rejects(read('图片.docx',image),/没有可读取的文字/);
});
test('file IPC validation does not accept paths or non-binary payloads and recovers after malformed files',async()=>{
 await assert.rejects(read('../file.txt',Buffer.from('test')),/文件名/);await assert.rejects(read('file.txt','not bytes'),/数据无效/);
 await assert.rejects(read('损坏.docx',new Uint8Array([80,75,3,4,1,2])),/损坏/);assert.equal((await read('随后.txt',Buffer.from('仍可正常读取'))).content,'仍可正常读取');
});


test('encrypted Word flag is rejected before attempting to decode its text',async()=>{
 const {CFB}=await import('xlsx'),bytes=readFileSync(new URL('./fixtures/word-legacy.doc',import.meta.url)),ole=CFB.read(bytes,{type:'buffer'}),stream=CFB.find(ole,'WordDocument').content;stream[11]|=1;
 await assert.rejects(read('加密.doc',CFB.write(ole,{type:'buffer'})),/已加密/);
});
