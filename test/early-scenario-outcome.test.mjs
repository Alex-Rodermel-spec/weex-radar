import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {outcomeOfEarlyScenario,summarizeEarlyOutcomes,EARLY_OUTCOME_POLICY}
 from '../lib/early-scenario-outcome.mjs';
const MIN=60_000,START=Date.UTC(2026,10,12,14,0);
function bars(){
 return Array.from({length:15},(_,i)=>({
  time:START+i*MIN,closeTime:START+(i+1)*MIN,
  open:100,high:100.05,low:99.95,close:100,volume:10
 }));
}
const long={direction:'LONG',trigger:100.5,invalidation:99.5};
const short={direction:'SHORT',trigger:99.5,invalidation:100.5};
test('first trigger precedes later cancellation, without intrabar lookahead',()=>{
 const rows=bars();
 rows[2]={...rows[2],high:100.6};
 rows[8]={...rows[8],low:99.4};
 const r=outcomeOfEarlyScenario(long,rows,START);
 assert.equal(r.status,'TRIGGER_FIRST');assert.equal(r.triggerMinute,3);
 assert.equal(r.cancellationMinute,null);
 assert.equal(r.postTrigger5mBps<0,true);
 assert.equal(r.notAnExecution,true);
});
test('cancellation before trigger disqualifies LONG scenario',()=>{
 const rows=bars();
 rows[1]={...rows[1],low:99.4};
 rows[3]={...rows[3],high:100.6};
 const r=outcomeOfEarlyScenario(long,rows,START);
 assert.equal(r.status,'CANCEL_FIRST');
 assert.equal(r.cancellationMinute,2);
});
test('SHORT thresholds symmetrical, ambiguous double touches never promoted',()=>{
 const rows=bars();
 rows[2]={...rows[2],low:99.3};
 assert.equal(outcomeOfEarlyScenario(short,rows,START).status,'TRIGGER_FIRST');
 const ambiguous=bars();
 ambiguous[0]={...ambiguous[0],low:99.3,high:100.7};
 assert.equal(outcomeOfEarlyScenario(short,ambiguous,START).status,'AMBIGUOUS');
 assert.equal(outcomeOfEarlyScenario(long,ambiguous,START).status,'AMBIGUOUS');
});
test('neither level reached is not called success',()=>{
 const r=outcomeOfEarlyScenario(long,bars(),START);
 assert.equal(r.status,'NEITHER');
 assert.equal(r.postTrigger5mBps,null);
});
test('future bars must be closed, contiguous and valid',()=>{
 const valid=bars();
 for(const bad of [
  valid.slice(1),
  valid.map((c,i)=>i===7?{...c,time:c.time+MIN}:c),
  valid.map((c,i)=>i===2?{...c,low:-1}:c),
  valid.map((c,i)=>i===14?{...c,closeTime:c.closeTime+MIN}:c)
 ]){
  assert.equal(outcomeOfEarlyScenario(long,bad,START).status,'UNKNOWN');
 }
 assert.equal(outcomeOfEarlyScenario({...long,trigger:99},valid,START).status,'UNKNOWN');
 assert.equal(outcomeOfEarlyScenario({...long,invalidation:101},valid,START).status,'UNKNOWN');
});
test('a signal first touched at minute 14 has no future 5m scoring within the observed window',()=>{
 const rows=bars();rows[13]={...rows[13],high:100.6};
 const r=outcomeOfEarlyScenario(long,rows,START);
 assert.equal(r.status,'TRIGGER_FIRST');
 assert.equal(r.triggerMinute,14);
 assert.equal(r.postTrigger5mBps,null);
});
test('summary separates triggered, cancelled, ambiguous and unknown outcomes',()=>{
 const rows=bars(),r1=outcomeOfEarlyScenario(long,rows,START);
 const a=bars();a[2]={...a[2],high:100.6};
 const b=bars();b[2]={...b[2],low:99.3};
 const c=bars();c[0]={...c[0],low:99.3,high:100.8};
 const results=[r1,outcomeOfEarlyScenario(long,a,START),
  outcomeOfEarlyScenario(long,b,START),
  outcomeOfEarlyScenario(long,c,START),
  outcomeOfEarlyScenario(long,[],START)];
 const summary=summarizeEarlyOutcomes(results);
 assert.deepEqual(summary.statuses,
  {TRIGGER_FIRST:1,CANCEL_FIRST:1,AMBIGUOUS:1,NEITHER:1,UNKNOWN:1});
 assert.equal(summary.total,5);
 assert.equal(summary.firstTriggerMinutes.observed,1);
 assert.equal(summary.postTrigger5m.observed,1);
});
test('study only: no live dispatch, no ntfy or orders, no new market calls',()=>{
 const src=readFileSync(new URL('../lib/early-scenario-outcome.mjs',import.meta.url),'utf8');
 const replay=readFileSync(new URL('../api/early-level-replay.mjs',import.meta.url),'utf8');
 assert.match(replay,/triggerBeforeCancellation:/);
 assert.equal(EARLY_OUTCOME_POLICY.liveFiltersChanged,false);
 assert.equal(EARLY_OUTCOME_POLICY.ordersSent,0);
 assert.doesNotMatch(src,/ntfySend|placeOrder|fetch\(|trade-confirm|\/capi\/v3\/order/);
});
