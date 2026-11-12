import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluatePublishedPreBreak,summarizePublishedPreBreak,PUBLISHED_EARLY_POLICY}
 from '../lib/published-early-audit.mjs';
const MIN=60_000,START=Date.UTC(2026,10,12,14,0,0);
const NOW=START+31*MIN;
const alert=(x={})=>({watchType:'PRE_BREAK',symbol:'BTCUSDT',
 direction:'LONG',sentAt:START+20_000,entry:100,trigger:101,invalidation:98,
 key:'a'.repeat(32),...x});
function bars(){
 return Array.from({length:31},(_,i)=>({
  time:START+i*MIN,closeTime:START+(i+1)*MIN,
  open:100,high:100.1,low:99.9,close:100,volume:100
 }));
}
function success(){
 const b=bars();
 b[2]={...b[2],high:101.2,close:100.9};
 b[4]={...b[4],high:101.5,close:101.3};
 b[9]={...b[9],high:101.9,close:101.8};
 return b;
}
test('real ntfy notice trigger is observed before a 5m close that holds then continues',()=>{
 const r=evaluatePublishedPreBreak(alert(),success(),NOW);
 assert.equal(r.status,'TRIGGER_FIRST');
 assert.equal(r.triggerMinute,2);
 assert.equal(r.first5mClose,START+5*MIN);
 assert.equal(r.following5mClose,START+10*MIN);
 assert.equal(r.first5m,'HELD');
 assert.equal(r.following5m,'CONTINUED');
 assert.equal(r.invalidatedAfterTrigger,false);
 assert.equal(r.first5mDirectionBps>0,true);
 assert.equal(r.next5mDirectionBps>0,true);
 assert.equal(PUBLISHED_EARLY_POLICY.tradeOrders,0);
});
test('a trigger touch alone is not strong: opposite 5m close is counted',()=>{
 const b=success();
 b[4]={...b[4],high:101.5,close:100.7};
 b[9]={...b[9],high:101.9,close:100.2};
 const r=evaluatePublishedPreBreak(alert(),b,NOW);
 assert.equal(r.status,'TRIGGER_FIRST');
 assert.equal(r.first5m,'FAILED');
 assert.equal(r.following5m,'REVERSED');
});
test('invalidation before any trigger is CANCEL_FIRST, not counted as early success',()=>{
 const b=bars();
 b[1]={...b[1],low:97.5};
 b[2]={...b[2],high:101.2};
 assert.equal(evaluatePublishedPreBreak(alert(),b,NOW).status,'CANCEL_FIRST');
});
test('same-minute double touch is AMBIGUOUS; later closed candle never determines intrabar order',()=>{
 const b=bars();
 b[1]={...b[1],low:97.5,high:101.5};
 assert.equal(evaluatePublishedPreBreak(alert(),b,NOW).status,'AMBIGUOUS');
});
test('incomplete recent signals stay PENDING, missing old future candles stay NO_DATA',()=>{
 const a=alert();
 assert.equal(evaluatePublishedPreBreak(a,success(),START+10*MIN).status,'PENDING');
 assert.equal(evaluatePublishedPreBreak(a,null,NOW).status,'NO_DATA');
 assert.equal(evaluatePublishedPreBreak(a,success().filter((_,i)=>i!==8),NOW).status,'NO_DATA');
 assert.equal(evaluatePublishedPreBreak({...a,trigger:null},success(),NOW).status,'NO_PUBLISHED_LEVELS');
});
test('full 5m boundaries require all five closed 1m bars',()=>{
 const r=evaluatePublishedPreBreak(alert(),success().slice(1),NOW);
 assert.equal(r.status,'TRIGGER_FIRST');
 assert.equal(r.first5m,'NO_DATA');
 assert.equal(r.following5m,'NO_DATA');
});
test('short trade direction is symmetric and remains manual/observational',()=>{
 const b=bars();b[2]={...b[2],low:98.8,close:99};
 b[4]={...b[4],low:98.3,close:98.7};
 b[9]={...b[9],low:98,close:98.4};
 const r=evaluatePublishedPreBreak(alert({direction:'SHORT',trigger:99,
  invalidation:102}),b,NOW);
 assert.equal(r.status,'TRIGGER_FIRST');
 assert.equal(r.first5m,'HELD');
 assert.equal(r.following5m,'CONTINUED');
});
test('aggregates only and groups market classes; source must be real ntfy alert',()=>{
 const a=alert(),b=alert({symbol:'1000PEPEUSDT',key:'b'.repeat(32)});
 const summary=summarizePublishedPreBreak([a,a,b,
  alert({symbol:'XRPUSDT',key:'c'.repeat(32),trigger:null})],
  new Map([['BTCUSDT',success()],['1000PEPEUSDT',success()],
   ['XRPUSDT',success()]]),NOW);
 assert.equal(summary.overall.notices,3);
 assert.equal(summary.overall.triggerFirst,2);
 assert.equal(summary.overall.noPublishedLevels,1);
 assert.equal(summary.overall.first5mHeld,2);
 assert.equal(summary.overall.heldThenContinued,2);
 assert.equal(summary.overall.pctHeldThenContinued,100);
 assert.equal(summary.byMarketGroup.MAJOR_CRYPTO.notices,1);
 assert.equal(summary.byMarketGroup.MEME_CRYPTO.notices,1);
 assert.equal(summary.byMarketGroup.ALT_CRYPTO.noPublishedLevels,1);
 assert.equal(summary.notTrades,true);
 const route=readFileSync(new URL('../lib/early-study-route.mjs',import.meta.url),'utf8');
 const mod=readFileSync(new URL('../lib/published-early-audit.mjs',import.meta.url),'utf8');
 assert.match(route,/study.publishedPreBreak=summarizePublishedPreBreak/);
 assert.match(route,/Object.fromEntries\(Object.entries\(study\)/);
 assert.doesNotMatch(mod,/ntfySend|publishNtfy|placeOrder|\/capi\/v3\/order|fetch\(/);
});
