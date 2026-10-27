import {parentPort,workerData} from 'node:worker_threads';
import {extractChatFile} from './chat-file-extract.mjs';
try{parentPort.postMessage({ok:true,result:await extractChatFile(workerData)});}catch(e){parentPort.postMessage({ok:false,error:e.message});}
