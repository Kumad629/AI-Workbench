// Use audio time, not accumulated timer ticks: delayed callbacks must not count as speech.
export class VoiceActivity {
 private previous=0;
 private voiced=0;
 private lastVoice=0;
 private heard=false;
 update(now:number,rms:number):'finished'|'silent'|null {
  const gap=now-this.previous,step=Math.max(0,Math.min(150,gap));this.previous=now;
  // A suspended/backgrounded timer cannot prove the user was silent in the gap.
  if(gap>500){this.lastVoice=now;this.voiced=0;}
  if(rms>=0.012){this.voiced+=step;this.lastVoice=now;if(this.voiced>=300)this.heard=true;}
  else if(!this.heard)this.voiced=0;
  else if(rms>=0.008)this.lastVoice=now;
  if(this.heard&&now-this.lastVoice>=2000)return 'finished';
  if(!this.heard&&now>=15000)return 'silent';
  return null;
 }
}
