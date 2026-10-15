import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceActivity} from '../src/voice-activity.ts';
test('waits for speech and tolerates a short mid-sentence pause',()=>{const a=new VoiceActivity();for(let t=100;t<=1000;t+=100)assert.equal(a.update(t,0),null);for(let t=1100;t<=1800;t+=100)assert.equal(a.update(t,.04),null);for(let t=1900;t<=3200;t+=100)assert.equal(a.update(t,0),null);for(let t=3300;t<=4000;t+=100)assert.equal(a.update(t,.03),null);for(let t=4100;t<6000;t+=100)assert.equal(a.update(t,0),null);assert.equal(a.update(6000,0),'finished');});
test('silence and a short click never trigger transcription',()=>{const a=new VoiceActivity();for(let t=100;t<15000;t+=100)assert.equal(a.update(t,t===500?.1:0),null);assert.equal(a.update(15000,0),'silent');});
test('a suspended timer does not imply two seconds of silence',()=>{const a=new VoiceActivity();for(let t=100;t<=1000;t+=100)a.update(t,.04);assert.equal(a.update(8000,0),null);for(let t=8100;t<10000;t+=100)assert.equal(a.update(t,0),null);assert.equal(a.update(10000,0),'finished');});
test('quiet continuation and continuous sound keep recording',()=>{const a=new VoiceActivity();for(let t=100;t<=1000;t+=100)assert.equal(a.update(t,.02),null);for(let t=1100;t<=20000;t+=100)assert.equal(a.update(t,.009),null);});
