import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {earlyLevelShadow,EARLY_LEVEL_SHADOW_POLICY} from '../lib/early-level-shadow.mjs';
import {normalizeReplayRows,replayEarlyLevelShadow,EARLY_REPLAY_POLICY}
 from '../api/early-level-replay.mjs';
const MIN=60_000,FIVE=5*MIN;
const end=Date.UTC(2026,10,12,18,45);
function bars(){
 return Array.from({length:30},(_,i)=>{
  const close=100+(i%4)*0.03;
  return {time:end-(30-i)*FIVE,closeTime:end-(29-i)*FIVE,
   open:close-0.08,close,high:close+0.15,low:close-0.2,volume:100};
 });
}
const forecast=(triggerPrice=100.22,side='LONG')=>({
 direction:side,triggerPrice,candleCloseTime:end
});
test('no historical 5m obstacle / opposite wick means CLEAR',()=>{
 const s=earlyLevelShadow(forecast(100.8),bars(),'BTCUSDT');
 assert.equal(s.status,'CLEAR');
 assert.equal(s.obstacleAhead,false);
 assert.equal(s.last5mRejection,false);
 assert.equal(s.group,'MAJOR_CRYPTO');
 assert.equal(s.noFutureCandles,true);
 assert.equal(EARLY_LEVEL_SHADOW_POLICY.actualNotificationsChanged,false);
 assert.equal(EARLY_REPLAY_POLICY.liveDeliveryUnchanged,true);
});
test('recent 5m resistance just ahead of LONG trigger is CAUTION',()=>{
 const five=bars();
 const trigger=Math.max(...five.slice(-13,-1).map(x=>x.high))-0.01;
 const r=earlyLevelShadow(forecast(trigger),five,'SOLUSDT');
 assert.equal(r.status,'CAUTION');
 assert.equal(r.obstacleAhead,true);
 assert.match(r.reason,/NEAR_5M_OPPOSING_LEVEL/);
 assert.equal(r.group,'ALT_CRYPTO');
});
test('near 5m support just below SHORT trigger is symmetric CAUTION',()=>{
 const five=bars();
 const min=Math.min(...five.slice(-13,-1).map(x=>x.low));
 const r=earlyLevelShadow(forecast(min+0.01,'SHORT'),five,'1000PEPEUSDT');
 assert.equal(r.status,'CAUTION');
 assert.equal(r.obstacleAhead,true);
 assert.equal(r.group,'MEME_CRYPTO');
});
test('last closed 5m rejection wick on bearish candle cautions LONG',()=>{
 const five=bars();
 five[29]={...five[29],open:100.2,high:100.7,low:99.9,close:100};
 const r=earlyLevelShadow(forecast(101.5),five,'XAUUSDT');
 assert.equal(r.status,'CAUTION');
 assert.equal(r.last5mRejection,true);
 assert.match(r.reason,/REJECTION_WICK_ON_LAST_CLOSED_5M/);
 assert.equal(r.group,'METALS');
});
test('missing, partial, stale, gapped and future bars never become clear',()=>{
 const ok=bars();
 const variants=[[],ok.slice(8),ok.map((x,i)=>i===8?{...x,time:x.time+MIN}:x),
  ok.map((x,i)=>i===29?{...x,closeTime:x.closeTime+FIVE}:x),
  ok.map((x,i)=>i===7?{...x,low:-4}:x)];
 for(const v of variants)assert.equal(
  earlyLevelShadow(forecast(),v,'EURUSDT').status,'UNKNOWN');
});
test('research route rejects bad OHLC and incomplete last candle',()=>{
 const now=end+MIN;
 const raw=[
  [end-2*MIN,100,101,99,100.5,10],
  [end-MIN,100.5,102,100,101.5,10],
  [end,101.5,103,101,102,10]
 ];
 const result=normalizeReplayRows(raw,MIN,now);
 assert.equal(result.length,2);
 assert.equal(result[1].closeTime,end);
 assert.equal(result[1].close,101.5);
});
test('historical replay refuses insufficient history, no fabricated accuracy',()=>{
 const result=replayEarlyLevelShadow([],[],[],{symbol:'BTCUSDT'});
 assert.equal(result.available,false);
 assert.match(result.reason,/INSUFFICIENT/);
 const code=readFileSync(new URL('../api/early-level-replay.mjs',import.meta.url),'utf8');
 assert.match(code,/actualNtfyNotReplayed:true/);
 assert.match(code,/priceProxy:/);
 assert.doesNotMatch(code,/trade-confirm|weex\.placeOrder|\/capi\/v3\/order|NTFY_TOPIC/);
});
