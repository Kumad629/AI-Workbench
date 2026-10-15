import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
test('real CPU model transcribes the public Chinese sample through the Electron worker',async()=>{
 test.skip(!existsSync(join(root,'local-models/sensevoice/model.int8.onnx'))||!existsSync(join(root,'artifacts/voice-sample-zh.wav')),'Download the optional model and public sample before this smoke test');
 const dir=mkdtempSync(join(tmpdir(),'awb-local-asr-'));let app;
 try{app=await electron.launch({args:[root],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir,AI_WORKBENCH_VOICE_MODEL_DIR:join(root,'local-models/sensevoice')}});const page=await app.firstWindow();await page.waitForFunction(()=>!!window.workbench);
 const wav=[...readFileSync(join(root,'artifacts/voice-sample-zh.wav'))];const started=Date.now();
 const result=await page.evaluate(wav=>window.workbench.call('voiceTranscribe',{id:'public-sample',wav:new Uint8Array(wav)}),wav);console.log(JSON.stringify({text:result.text,elapsedMs:Date.now()-started}));expect(result.text.length).toBeGreaterThan(8);expect(result.text).toMatch(/[\u4e00-\u9fff]/);expect((await page.evaluate(()=>window.workbench.call('snapshot'))).conversations).toHaveLength(0);
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('speech followed by silence automatically transcribes and fills without finish or recognize clicks',async()=>{
 test.skip(!existsSync(join(root,'local-models/sensevoice/model.int8.onnx'))||!existsSync(join(root,'artifacts/voice-sample-zh.wav')),'Optional model and sample required');
 const dir=mkdtempSync(join(tmpdir(),'awb-local-voice-ui-'));let app;
 const sample=readFileSync(join(root,'artifacts/voice-sample-zh.wav'));const padded=Buffer.concat([sample,Buffer.alloc(16000*2*4)]);padded.writeUInt32LE(padded.length-8,4);const dataAt=padded.indexOf(Buffer.from('data'));padded.writeUInt32LE(sample.readUInt32LE(dataAt+4)+16000*2*4,dataAt+4);const samplePath=join(dir,'speech-and-silence.wav');writeFileSync(samplePath,padded);
 try{app=await electron.launch({args:[root,'--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+samplePath],env:{...process.env,AI_WORKBENCH_DATA_DIR:dir,AI_WORKBENCH_VOICE_MODEL_DIR:join(root,'local-models/sensevoice')}});const page=await app.firstWindow();await page.waitForFunction(()=>!!window.workbench);await page.bringToFront();
 const input=page.getByRole('textbox',{name:'输入问题',exact:true});await input.fill('备忘：');await input.evaluate(e=>{e.focus();e.setSelectionRange(e.value.length,e.value.length);});
 await page.getByRole('button',{name:'语音输入',exact:true}).click();await page.getByRole('button',{name:'开始录音',exact:true}).click();await expect(page.getByText('正在录音',{exact:true})).toBeVisible();await expect(input).toHaveValue(/备忘：.*早上.*下午/,{timeout:60000});
 await expect(page.getByRole('dialog',{name:'语音输入'})).toBeHidden();await expect.poll(()=>app.evaluate(({app})=>app.getAppMetrics().filter(x=>x.name==='Local speech recognition').length)).toBe(0);expect((await page.evaluate(()=>window.workbench.call('snapshot'))).conversations).toHaveLength(0);
 console.log(JSON.stringify({endToEndText:await input.inputValue()}));await page.screenshot({path:join(root,'artifacts','voice-local-recognition-success.png')});
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});
