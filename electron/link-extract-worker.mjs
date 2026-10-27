import {parentPort,workerData} from 'node:worker_threads';
import {extractLinkDocument} from './link-extract.mjs';
try{parentPort.postMessage({ok:true,result:await extractLinkDocument(workerData)});}catch(e){parentPort.postMessage({ok:false,error:e.message});}
