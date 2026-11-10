import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {twoFilterCandidate,replayTwoFilterCandles} from '../lib/scalp-two-filter-research.mjs';
const M=60000,base=Date.UTC(2026,10,9,10,0,0);
function sample(finalClose=102,lastVolume=160){
 return Array.from({length:21},(_,i)=>{
  const close=i===20?finalClose:100,open=i===20?100:close;
  return {time:base+i*M,closeTime:base+(i+1)*M,
   open,close,high:Math.max(open,close)+0.1,
   low:Math.min(open,close)-0.1,volume:i===20?lastVolume:100};
 });
}
test('two indicators detect an upward or downward closed 1m BB breakout with volume',()=>{
 const long=twoFilterCandidate(sample(),base+21*M+1000);
 assert.equal(long.direction,'LONG');
 assert.equal(long.mode,'SHADOW_BB_VOLUME_1M');
 assert.equal(long.volumeRatio,1.6);
 assert.equal(long.notATrade,true);
 assert.equal(twoFilterCandidate(sample(98),base+21*M+1000).direction,'SHORT');
 assert.equal(twoFilterCandidate(sample(102,110),base+21*M+1000).direction,null);
 assert.equal(twoFilterCandidate(sample(102,110),base+21*M+1000).reason,'LOW_VOLUME');
});
test('unclosed, malformed or gapped 1m candles cannot be used',()=>{
 const a=sample();
 assert.equal(twoFilterCandidate(a,a.at(-1).closeTime).direction,null);
 assert.equal(twoFilterCandidate(a,a.at(-1).closeTime).reason,'INCOMPLETE_OR_GAPPED_CANDLES');
 assert.equal(twoFilterCandidate(a.slice(0,19),base+30*M).direction,null);
 assert.equal(twoFilterCandidate(a.map((x,i)=>i===12?{...x,time:x.time+M}:x),base+22*M).direction,null);
 assert.equal(twoFilterCandidate(a.map((x,i)=>i===17?{...x,volume:-1}:x),base+22*M).direction,null);
});
test('historical replay measures signed returns after assumed costs without orders',()=>{
 const bars=sample();
 const last=bars.at(-1);
 for(let i=1;i<=5;i++){
  const close=102+i*.5,open=102+(i-1)*.5;
  bars.push({time:last.closeTime+(i-1)*M,closeTime:last.closeTime+i*M,
   open,close,high:close+.1,low:open-.1,volume:100});
 }
 const result=replayTwoFilterCandles(bars,{horizonMinutes:5});
 assert.equal(result.total.signals,1);
 assert.equal(result.byDirection.LONG.signals,1);
 assert.equal(result.byDirection.SHORT.signals,0);
 assert.equal(result.assumedRoundTripCostsBps,22);
 assert.ok(result.total.averageNetBps>0);
 assert.equal(result.tradeReady,false);
 assert.equal(result.changesLiveSignals,false);
});
test('shadow module has no network, order, push, account or live scan access',()=>{
 const src=readFileSync(new URL('../lib/scalp-two-filter-research.mjs',import.meta.url),'utf8');
 for(const forbidden of [/fetch\(/,/placeOrder/,/trade-confirm/,/trade-prepare/,/ntfySend/,/WEEX_API/,/process\.env/]){
  assert.doesNotMatch(src,forbidden);
 }
});
