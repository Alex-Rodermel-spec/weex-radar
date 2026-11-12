import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditObservedEarlyPairs,OBSERVED_PAIR_POLICY}
 from '../lib/v110-observed-early-pairs.mjs';
const MIN=60000,FIVE=5*MIN,FIFTEEN=15*MIN;
const T=Date.UTC(2026,10,12,18,45);
function setup(){
 const five=Array.from({length:125},(_,i)=>{
  const close=100+i*.012+.16*Math.sin(i*.45);
  return {time:T-(125-i)*FIVE,closeTime:T-(124-i)*FIVE,
   open:close-.05,close,high:close+.06,low:close-.11,
   volume:i===124?185:100};
 });
 five[119].high=five.at(-1).close+1.0;
 const fifteen=Array.from({length:125},(_,i)=>{
  const close=100+i*.012+.08*Math.sin(i*.23);
  return {time:T-(125-i)*FIFTEEN,closeTime:T-(124-i)*FIFTEEN,
   open:close-.05,close,high:close+.06,low:close-.11,volume:100};
 });
 const close=five.at(-1).close;
 const minute=Array.from({length:20},(_,i)=>{
  const time=T-(20-i)*MIN;
  return {time,closeTime:time+MIN,open:close-.20,
   high:close-.10,low:close-.26,close:close-.15};
 });
 const vals=[close-.13,close-.065,close];
 for(let i=0;i<3;i++){
  const time=T-(3-i)*MIN,p=vals[i];
  minute[17+i]={time,closeTime:time+MIN,open:p-.04,
   close:p,high:p+.02,low:p-.08};
 }
 minute.push({time:T+4*MIN,closeTime:T+5*MIN,
  open:close,high:close+.22,low:close-.02,close:close+.15});
 const early={symbol:'BTCUSDT',direction:'LONG',watchType:'PRE_BREAK',
  key:'prior-real-ntfy-fixture-id',sentAt:T-3.5*MIN,
  trigger:close-.08,invalidation:close-1,entry:close-.15};
 return {early,one:new Map([['BTCUSDT',minute]]),
  five:new Map([['BTCUSDT',five]]),
  fifteen:new Map([['BTCUSDT',fifteen]])};
}
test('research scores a simulated fixture that models a prior published ntfy level',()=>{
 const f=setup();
 const r=auditObservedEarlyPairs([f.early],f.one,f.five,f.fifteen,T+6*MIN);
 assert.equal(r.mode,'REAL_NTFY_ANCHORED_5M_SHADOW');
 assert.equal(r.sampledNotices,1);
 assert.equal(r.shadowMatched,1,JSON.stringify(r.reasons));
 assert.equal(r.shadowUnmatched,0);
 assert.equal(r.matchedObservedFuture5m,1);
 assert.equal(r.matchedFavorableFuture5m,1);
 assert.equal(r.notificationsSent,0);
 assert.equal(r.requiredNewOrders,0);
 assert.equal(OBSERVED_PAIR_POLICY.validForTrading,false);
});
test('later market notice cancels older scenario, even if opposite direction',()=>{
 const f=setup();
 const newer={...f.early,key:'newer-real-ntfy-fixture',
  direction:'SHORT',sentAt:T-2*MIN,trigger:f.early.trigger-.4,
  invalidation:f.early.invalidation+1.5};
 const r=auditObservedEarlyPairs([f.early,newer],
   f.one,f.five,f.fifteen,T+6*MIN);
 assert.equal(r.cancelledByLaterNotice,1);
 assert.equal(r.shadowMatched,0);
});
test('no actual published forecast, no constructed match or backfilled data',()=>{
 const f=setup();
 const none=auditObservedEarlyPairs([],f.one,f.five,f.fifteen,T+6*MIN);
 assert.equal(none.latestNoticesEligible,0);
 assert.equal(none.shadowMatched,0);
 const fake={...f.early,watchType:'BREAKOUT'};
 const wrong=auditObservedEarlyPairs([fake],f.one,f.five,
  f.fifteen,T+6*MIN);
 assert.equal(wrong.shadowMatched,0);
 const missing=auditObservedEarlyPairs([f.early],
  new Map(),f.five,f.fifteen,T+6*MIN);
 assert.equal(missing.missingEvidence,1);
 assert.equal(missing.shadowMatched,0);
});
test('source limits network usage to explicit read-only study, no trading or ntfy sent',()=>{
 const own=readFileSync(new URL('../lib/v110-observed-early-pairs.mjs',import.meta.url),'utf8');
 const route=readFileSync(new URL('../lib/early-study-route.mjs',import.meta.url),'utf8');
 const writer=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
 assert.match(route,/observedAnchored:/);
 assert.match(route,/extraPublicRequestsMax:8/);
 assert.match(route,/includePrivateInputs:true/);
 assert.doesNotMatch(writer,/includePrivateInputs:true/);
 assert.doesNotMatch(own,/ntfySend|publishNtfy|placeOrder|trade-confirm|fetch\(|\/capi\/v3\/order/);
});
