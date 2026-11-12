import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateAnchored5mConfirmation,ANCHORED_5M_POLICY}
 from '../lib/v110-anchored-5m-shadow.mjs';
import {_test as core} from '../api/signals.mjs';
const MIN=60_000,FIVE=5*MIN,FIFTEEN=15*MIN;
const T=Date.UTC(2026,10,12,18,45);
function fixture(){
 const five=Array.from({length:125},(_,i)=>{
  const close=100+i*.012+.16*Math.sin(i*.45);
  return {time:T-(125-i)*FIVE,closeTime:T-(124-i)*FIVE,
   open:close-.05,close,high:close+.06,low:close-.11,
   volume:i===124?185:100};
 });
 // A 5m-range barrier above the candle remains UNBROKEN, so the old
 // independent 12x5m scanner cannot confirm this potential early trigger.
 five[119].high=five.at(-1).close+1.0;
 const fifteen=Array.from({length:125},(_,i)=>{
  const close=100+i*.012+.08*Math.sin(i*.23);
  return {time:T-(125-i)*FIFTEEN,closeTime:T-(124-i)*FIFTEEN,
   open:close-.05,close,high:close+.06,low:close-.11,volume:100};
 });
 const close=five.at(-1).close;
 const one=[3,2,1].map((lag,i)=>{
  const p=close-.13+i*.065;
  return {time:T-lag*MIN,closeTime:T-(lag-1)*MIN,
   open:p-.04,close:p,high:p+.02,low:p-.08,volume:100};
 });
 one[2].close=close;one[2].high=close+.02;
 const scenario={direction:'LONG',sentAt:T-3.5*MIN,
  trigger:close-.08,invalidation:close-1};
 return {symbol:'BTCUSDT',scenario,five,fifteen,one,
  quote:close,asOf:T};
}
test('positive anchored 5m example is different from independently breaking 12 prior 5m highs',()=>{
 const x=fixture();
 const res=evaluateAnchored5mConfirmation(x);
 assert.equal(res.status,'ANCHOR_CONFIRMED_RESEARCH_ONLY',res.reason);
 assert.equal(res.ordersSent,0);
 assert.equal(res.notTrade,true);
 const old=core.getAnalysis(x.five,x.fifteen,x.quote,T+1000);
 assert.equal(old.direction,null,'the unrelated 12bar high has not broken');
 assert.equal(ANCHORED_5M_POLICY.independent5mRangeBreakNotRequired,true);
 assert.equal(ANCHORED_5M_POLICY.newLiveNotifications,0);
});
test('can never confirm with missing prior alert, invalid price geometry or future alert',()=>{
 const x=fixture();
 for(const changed of [
  {scenario:null},
  {scenario:{...x.scenario,sentAt:T+MIN}},
  {scenario:{...x.scenario,sentAt:T-16*MIN}},
  {scenario:{...x.scenario,invalidation:x.scenario.trigger+1}},
  {quote:null},
  {symbol:'INVALIDUSDT'}
 ]){
  const r=evaluateAnchored5mConfirmation({...x,...changed});
  assert.equal(r.status,'REJECT',JSON.stringify(changed));
 }
});
test('invalidation wick and 5m closing before early trigger fail closed',()=>{
 const x=fixture();
 const bad=x.one.map(y=>({...y}));
 bad[1].low=x.scenario.invalidation-.1;
 assert.equal(evaluateAnchored5mConfirmation({...x,one:bad}).reason,
  'EARLY_SCENARIO_INVALIDATED');
 const tooHigh={...x.scenario,trigger:x.quote+.2};
 const rejected=evaluateAnchored5mConfirmation({...x,scenario:tooHigh});
 assert.equal(rejected.status,'REJECT');
});
test('missing closed 5m, stale fifteen, gapped history, or late quote do not pass',()=>{
 const x=fixture();
 const trials=[
  {five:x.five.slice(0,-1)},
  {fifteen:x.fifteen.slice(0,-3)},
  {five:x.five.map((v,i)=>i===50?{...v,time:v.time+MIN}:v)},
  {quote:x.quote+10},
  {fifteen:x.fifteen.map(v=>({...v,open:v.open+10,
    close:v.close+10,high:v.high+10,low:v.low+10}))}
 ];
 for(const changed of trials){
  const r=evaluateAnchored5mConfirmation({...x,...changed});
  assert.equal(r.status,'REJECT',JSON.stringify(changed).slice(0,100));
 }
});
test('read-only shadow contains no sending, order placing or account access',()=>{
 const source=readFileSync(new URL('../lib/v110-anchored-5m-shadow.mjs',import.meta.url),'utf8');
 const replay=readFileSync(new URL('../api/early-level-replay.mjs',import.meta.url),'utf8');
 assert.match(replay,/anchoredWithin15m/);
 assert.match(source,/prototypeUsesHypotheticalNotices:true/);
 assert.doesNotMatch(source,/ntfySend|placeOrder|fetch\(|PUSH_CRON_KEY|WEEX_API_KEY|trade-confirm|\/capi\/v3\/order/);
 assert.equal(ANCHORED_5M_POLICY.autoTrade,false);
});
