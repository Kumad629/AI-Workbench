// One short-lived CPU process per recording; no network access or audio files.
function reply(value){if(process.parentPort)process.parentPort.postMessage(value);else process.send(value);}
async function recognize(data){try{
 const sherpa=require('sherpa-onnx-node');
 const recognizer=new sherpa.OfflineRecognizer({featConfig:{sampleRate:16000,featureDim:80},modelConfig:{senseVoice:{model:data.model,useInverseTextNormalization:1,language:'auto'},tokens:data.tokens,numThreads:2,provider:'cpu',debug:0}});
 const stream=recognizer.createStream();stream.acceptWaveform({sampleRate:16000,samples:new Float32Array(data.samples)});recognizer.decode(stream);reply({text:recognizer.getResult(stream).text});
}catch(e){reply({error:e.message||'无法加载本地识别组件'});}}
if(process.parentPort)process.parentPort.on('message',({data})=>void recognize(data));else process.on('message',data=>void recognize(data));
