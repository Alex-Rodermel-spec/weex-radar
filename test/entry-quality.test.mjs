import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {MIN_REWARD_RISK,MIN_STRUCTURAL_ROOM_R,closestOpposingPivot,
 checkEntryLevels,checkConfirmedEntry} from '../lib/entry-quality.mjs';

function sample(){
 return Array.from({length:72},(_,i)=>({
  open:100,close:100,high:100.2,low:99.8,
  time:Date.now()-72*300_000+i*300_000,volume:100
 }));
}

test('minimum R/R is calculated at the current quote for BOTH LONG and SHORT',()=>{
 assert.equal(MIN_REWARD_RISK,1.5);
 assert.equal(checkEntryLevels({direction:'LONG',entry:100,stop:99,take:102}).ok,true);
 assert.equal(checkEntryLevels({direction:'SHORT',entry:100,stop:101,take:98}).ok,true);
 assert.equal(checkEntryLevels({direction:'LONG',entry:100.6,stop:99,take:102}).ok,false);
 assert.equal(checkEntryLevels({direction:'SHORT',entry:99.4,stop:101,take:98}).ok,false);
 assert.equal(checkEntryLevels({direction:'LONG',entry:102,stop:99,take:102}).ok,false);
 assert.equal(checkEntryLevels({direction:'SHORT',entry:98,stop:101,take:98}).ok,false);
 assert.equal(checkEntryLevels({direction:'LONG',entry:100,stop:100,take:102}).ok,false);
 assert.equal(checkEntryLevels({direction:'SHORT',entry:NaN,stop:101,take:98}).ok,false);
});

test('resistance/support swing pivot must have two older AND two newer completed candles',()=>{
 const longs=sample(),shorts=sample();
 longs[45].high=100.7;
 shorts[45].low=99.3;
 assert.equal(closestOpposingPivot(longs,'LONG',100,102),100.7);
 assert.equal(closestOpposingPivot(shorts,'SHORT',100,98),99.3);
 // Removing the mature pivot also removes the barrier.
 longs[46].high=101;
 shorts[46].low=99;
 assert.equal(closestOpposingPivot(longs,'LONG',100,102),101);
 assert.equal(closestOpposingPivot(shorts,'SHORT',100,98),99);
 // An isolated wick on the signal candle must not affect the past-level check.
 const lastOnly=sample();lastOnly.at(-1).high=101.5;lastOnly.at(-1).low=98.5;
 assert.equal(closestOpposingPivot(lastOnly,'LONG',100,102),null);
 assert.equal(closestOpposingPivot(lastOnly,'SHORT',100,98),null);
});
test('close obstacle less than 1R blocks entries symmetrically',()=>{
 assert.equal(MIN_STRUCTURAL_ROOM_R,1);
 const long=checkEntryLevels({direction:'LONG',entry:100,stop:99,take:102,nearestLevel:100.5});
 assert.equal(long.ok,false);
 assert.equal(long.roomR,0.5);
 const short=checkEntryLevels({direction:'SHORT',entry:100,stop:101,take:98,nearestLevel:99.5});
 assert.equal(short.ok,false);
 assert.equal(short.roomR,0.5);
 assert.equal(checkEntryLevels({direction:'LONG',entry:100,stop:99,take:102,nearestLevel:101.4}).ok,true);
 assert.equal(checkEntryLevels({direction:'SHORT',entry:100,stop:101,take:98,nearestLevel:98.6}).ok,true);
});
test('no nearby completed 5m swing keeps the known R/R, not an invented level',()=>{
 const result=checkConfirmedEntry('LONG',100,100,0.5,sample());
 assert.equal(result.ok,true);
 assert.equal(result.rr,2.5);
 assert.equal(result.nearestLevel,null);
 assert.equal(result.roomR,null);
 assert.equal(checkConfirmedEntry('SHORT',100,100,0.5,sample()).ok,true);
});
test('the 5m feed and cron use the same risk gate but 1m early stays watch only',()=>{
 const signals=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const dispatcher=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const early=readFileSync(new URL('../lib/early-watch.mjs',import.meta.url),'utf8');
 const ntfy=readFileSync(new URL('../lib/ntfy-alerts.mjs',import.meta.url),'utf8');
 const site=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(signals,/checkConfirmedEntry\(candidate,last\.close,livePrice,volatility,five\)/);
 assert.match(signals,/entryQuality\?\.ok&&/);
 assert.match(dispatcher,/checkEntryLevels\(/);
 assert.match(dispatcher,/signal\.entryQuality\?\.ok===true&&entry\.ok/);
 assert.match(dispatcher,/fetchCurrentQuote\(signal\.symbol,signal\.exchange\)/);
 assert.match(early,/out\.level='EARLY_WATCH'/);
 assert.doesNotMatch(early,/checkConfirmedEntry|checkEntryLevels/);
 assert.match(ntfy,/R\/R/);
 const inline=site.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(inline);
 assert.doesNotThrow(()=>new Script(inline[1],{filename:'index.html'}));
 assert.doesNotMatch(signals,/\/capi\/v3\/order|trade-confirm/);
});
