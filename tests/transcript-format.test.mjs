import test from 'node:test';
import assert from 'node:assert/strict';
import {transcriptTurns,formatArchiveMarkdown} from '../src/transcript-format.ts';

test('archive roles require explicit standalone labels and ignore labels in code',()=>{
  const raw='前言\n\n我：\n一个问题\n\nGrok：\n回答\n\n```text\n我：\n示例\n```';
  const turns=transcriptTurns(raw);
  assert.deepEqual(turns.map(t=>t.role),['unknown','user','assistant']);
  for(const turn of turns)assert.equal(raw.slice(turn.start,turn.start+turn.content.length),turn.content);
  assert.equal(transcriptTurns('我的问题写在普通段落里。\n\n这是回答。')[0].role,'unknown');
});
test('legacy tables regain headers, escaped pipes and source ranges without changing stored text',()=>{
  const table='阶段 | 时间 | 内容\n\n开始 | 1周 | A\\|B\n\n继续 | 2周 | 学习';
  const raw='前言\n\n'+table+'\n\n结尾';
  const result=formatArchiveMarkdown(raw);
  assert.ok(result.markdown.includes('| --- | --- | --- |'));
  const start=result.markdown.indexOf('| 阶段'),end=result.markdown.indexOf('\n\n结尾');
  assert.equal(raw.slice(result.sourceOffset(start),result.sourceOffset(end,true)),table);
  assert.equal(result.sourceOffset(result.markdown.indexOf('结尾')),raw.indexOf('结尾'));
});
test('valid tables, fenced code and ambiguous prose stay unchanged',()=>{
  for(const raw of [
    '| A | B | C |\n| --- | --- | --- |\n| a | b | c |\n| d | e | f |\n| g | h | i |',
    '```\nA | B | C\na | b | c\nd | e | f\n```',
    'A | B | C\na | b | c',
    '    A | B | C\n    a | b | c\n    d | e | f',
    'one | two\nthree | four\nfive | six'
  ])assert.equal(formatArchiveMarkdown(raw).markdown,raw);
});

test('long fences keep embedded shorter fences and speaker labels as literal code',()=>{
  const raw='Grok：\n````text\n```\n我：\nA | B | C\na | b | c\nd | e | f\n````';
  assert.equal(transcriptTurns(raw).length,1);
  assert.equal(formatArchiveMarkdown(raw).markdown,raw);
});

test('Markdown code source keeps body whitespace, nested fences and offsets',async()=>{
  const {codeBlockSource,markdownCode}=await import('../src/code-block.ts');
  const body='# 标题\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst x=1;\n```\n';
  const raw='````markdown\n'+body+'````';
  const result=codeBlockSource(raw,'');
  assert.equal(result.content,body);
  assert.equal(raw.slice(result.offset,result.offset+result.content.length),body);
  assert.equal(result.language,'markdown');
  assert.equal(markdownCode('',body),true);
  assert.equal(markdownCode('python',body),false);
  assert.equal(markdownCode('','const x=1;'),false);
});

test('YouTube archive labels display questions and answers without mixing Gemini',()=>{
 const turns=transcriptTurns('我：\n总结视频\n\nYouTube：\n这是重点。\n\n我：\n再详细些\n\nYouTube：\n补充说明');
 assert.deepEqual(turns.map(t=>t.role),['user','assistant','user','assistant']);assert.equal(turns[1].label,'YouTube');
});
