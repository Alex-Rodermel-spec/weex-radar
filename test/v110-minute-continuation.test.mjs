import test from 'node:test';
import assert from 'node:assert/strict';
import {V110_MINUTE_POLICY,normalizeV110Minutes,
 validateV110MinuteContinuation} from '../lib/v110-minute-continuation.mjs';
const MIN=60000,CLOSE=Date.UTC(2026,10,12,15,40);
const early={sentAt:CLOSE-3.5*MIN,trigger:99.85,invalidation:100.5};
const signal={direction:'SHORT',candleCloseTime:CLOSE,price:99.4};
function raw(){
 const vals=[
  [100.1,100.13,99.96,100.0],
  [100,100.04,99.88,99.92],
  [99.92,99.95,99.78,99.85],
  [99.85,99.86,99.68,99.70],
  [99.70,99.73,99.35,99.40]];
 return vals.map(([open,high,low,close],i)=>
  [CLOSE-(5-i)*MIN,open,high,low,close,100]);
}
const bars=()=>normalizeV110Minutes(raw(),CLOSE);
test('V110 sees only valid completed 1m candles, never next partial minute',()=>{
 const rows=raw();
 rows.push([CLOSE,99.4,99.6,99.2,99.5,200]);
 const result=normalizeV110Minutes(rows,CLOSE);
 assert.equal(result.length,5);
 assert.equal(result.at(-1).closeTime,CLOSE);
 assert.equal(result.at(-1).close,99.4);
 assert.equal(V110_MINUTE_POLICY.noOrders,true);
});
test('closed-minute SHORT continues after real earlier forecast, price holds below trigger',()=>{
 const result=validateV110MinuteContinuation(signal,early,bars());
 assert.equal(result.ok,true);
 assert.equal(result.observedBars,3);
});
test('closed-minute LONG symmetric: hold above trigger, no lower invalidation',()=>{
 const s={direction:'LONG',candleCloseTime:CLOSE,price:100.6};
 const f={sentAt:CLOSE-3.5*MIN,trigger:100.15,invalidation:99.2};
 const good=[
  [100,100.2,99.95,100.1],[100.1,100.25,100.04,100.16],
  [100.16,100.3,100.12,100.25],[100.25,100.48,100.23,100.42],
  [100.42,100.65,100.4,100.6]];
 const rows=good.map((p,i)=>[CLOSE-(5-i)*MIN,...p,100]);
 assert.equal(validateV110MinuteContinuation(s,f,normalizeV110Minutes(rows,CLOSE)).ok,true);
});
test('invalidate if after-alert candle touches cancellation level, even if final close recovers',()=>{
 const values=raw();values[3][2]=100.6;
 const result=validateV110MinuteContinuation(signal,early,normalizeV110Minutes(values,CLOSE));
 assert.equal(result.reason,'EARLY_SCENARIO_INVALIDATED');
});
test('reject last-minute reversal, missing history, stale 5m close, or unbroken trigger',()=>{
 const reversed=raw();
 reversed[4]=[CLOSE-MIN,99.60,99.75,99.38,99.70,100];
 assert.equal(validateV110MinuteContinuation({...signal,price:99.70},early,
  normalizeV110Minutes(reversed,CLOSE)).reason,'LAST_MINUTE_REVERSAL');
 assert.equal(validateV110MinuteContinuation(signal,early,null).ok,false);
 assert.equal(validateV110MinuteContinuation(signal,early,bars().slice(0,-1)).reason,
  'FINAL_MINUTE_GAP');
 assert.equal(validateV110MinuteContinuation({...signal,price:99.7},early,bars()).reason,
  'FIVE_MINUTE_AND_MINUTE_CLOSE_DISAGREE');
 assert.equal(validateV110MinuteContinuation(signal,{...early,trigger:99.3},bars()).reason,
  'EARLY_TRIGGER_NOT_CLOSED_BEYOND');
});
