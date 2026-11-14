import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateV110DirectionDiagnostics as evaluate} from '../lib/v110-direction-diagnostics.mjs';

const MIN=60_000;
const now=Date.parse('2026-11-14T00:00:00Z');
const sentAt=now-90*MIN;
const record=(i,direction='LONG',patch={})=>({
 id:i.toString(16).padStart(32,'0'),
 symbol:direction==='LONG'?'XRPUSDT':'BTCUSDT',direction,sentAt,
 strength:'STANDARD',preMove5mBps:2,
 windows:{5:{status:'OBSERVED',moveBps:2},10:{status:'OBSERVED',moveBps:4},
  15:{status:'OBSERVED',moveBps:8},30:{status:'OBSERVED',moveBps:11}},
 firstFavorable10bpsMinute:null,firstAdverse10bpsMinute:null,
 ...patch
});

test('observed first +/-10bps minute is counted separately for LONG and SHORT',()=>{
 const longs=Array.from({length:25},(_,i)=>record(i,'LONG',{
  firstFavorable10bpsMinute:i<20?4:i<22?9:null,
  firstAdverse10bpsMinute:i<21?15:null
 }));
 const shorts=[record(100,'SHORT',{firstFavorable10bpsMinute:2}),
  record(101,'SHORT',{firstAdverse10bpsMinute:25})];
 const result=evaluate([...longs,...shorts],now);
 assert.equal(result.status,'OBSERVED_AGGREGATES_ONLY');
 assert.equal(result.byDirection.LONG.firstMove10bps.eligibleMature30m,25);
 const long=result.byDirection.LONG.firstMove10bps;
 assert.equal(long.favorable.recorded,22);
 assert.equal(long.favorable.missingOrNotReached,3);
 assert.equal(long.favorable.medianMinute,4);
 assert.deepEqual(long.favorable.bands,{'1-5':20,'6-10':2,'11-15':0,'16-30':0});
 assert.equal(long.adverse.recorded,21);
 assert.equal(long.adverse.medianMinute,15);
 assert.equal(long.adverse.bands['11-15'],21);
 const short=result.byDirection.SHORT.firstMove10bps;
 assert.equal(short.eligibleMature30m,2);
 assert.equal(short.favorable.recorded,1);
 assert.equal(short.favorable.medianMinute,null);
 assert.equal(short.favorable.bands,null);
 assert.equal(result.ordersSent,0);
 assert.equal(result.changesLiveSignals,false);
});

test('unknown and legacy onset fields are never considered a confirmed failure',()=>{
 const rows=[
  record(1,'LONG',{firstFavorable10bpsMinute:null}),
  record(2,'LONG',{firstFavorable10bpsMinute:0}),
  record(3,'LONG',{firstFavorable10bpsMinute:31}),
  record(4,'LONG',{firstFavorable10bpsMinute:6.5}),
  record(5,'LONG',{firstFavorable10bpsMinute:10,
   windows:{30:{status:'PENDING',moveBps:null}}}),
  record(6,'LONG',{firstFavorable10bpsMinute:8,sentAt:now-10*MIN})
 ];
 const result=evaluate(rows,now);
 const r=result.byDirection.LONG.firstMove10bps;
 assert.equal(r.eligibleMature30m,4);
 assert.equal(r.favorable.recorded,0);
 assert.equal(r.favorable.missingOrNotReached,4);
 assert.equal(r.favorable.medianMinute,null);
 assert.equal(r.adverse.recorded,0);
 assert.equal(result.byDirection.SHORT.firstMove10bps.eligibleMature30m,0);
 assert.equal(result.byDirection.LONG.horizons[30].observed,4);
});

test('onset diagnostics do not alter the live scanner or introduce market requests',()=>{
 const lib=readFileSync(new URL('../lib/v110-direction-diagnostics.mjs',import.meta.url),'utf8');
 const scan=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 assert.equal(scan.includes('v110-direction-diagnostics'),false);
 for(const forbidden of ['fetch(','placeOrder','process.env','trade-confirm','PUSH_CRON_KEY'])
  assert.equal(lib.includes(forbidden),false,forbidden);
});

test('first 10bps threshold separates favorable-before-adverse from adverse-before-favorable',()=>{
 const favorable=Array.from({length:20},(_,i)=>record(200+i,'LONG',{
  strength:'STRONG',firstFavorable10bpsMinute:3,
  firstAdverse10bpsMinute:i%2===0?12:null
 }));
 const adverse=Array.from({length:5},(_,i)=>record(240+i,'LONG',{
  strength:'STRONG',firstAdverse10bpsMinute:4,
  firstFavorable10bpsMinute:i%2===0?19:null
 }));
 const unclassified=[record(260,'LONG'),record(261,'LONG',{
  firstFavorable10bpsMinute:7,firstAdverse10bpsMinute:7
 })];
 const insufficient=[record(270,'LONG',{sentAt:now-10*MIN,
  firstFavorable10bpsMinute:2}),record(271,'LONG',{
  windows:{30:{status:'NO_DATA',moveBps:null}},
  firstAdverse10bpsMinute:3
 })];
 const shorts=Array.from({length:22},(_,i)=>record(300+i,'SHORT',{
  strength:'STANDARD',
  firstFavorable10bpsMinute:i<11?5:22,
  firstAdverse10bpsMinute:i<11?18:2
 }));
 const output=evaluate([...favorable,...adverse,...unclassified,...insufficient,...shorts],now);
 const l=output.byDirection.LONG.firstMove10bps.firstThresholdOrder;
 assert.equal(l.maturedWithObserved30m,27);
 assert.equal(l.firstFavorable,20);
 assert.equal(l.firstAdverse,5);
 assert.equal(l.resolvedFirstCrossings,25);
 assert.equal(l.firstFavorablePctAmongResolved,80);
 assert.equal(l.firstAdversePctAmongResolved,20);
 assert.equal(l.bothRecorded,14);
 assert.equal(l.onlyFavorableRecorded,10);
 assert.equal(l.onlyAdverseRecorded,2);
 assert.equal(l.ambiguousTie,1);
 assert.equal(l.neitherRecordedOrUnknown,1);
 assert.equal(output.byDirection.LONG.firstMove10bps.thresholdOrderByStrength.STRONG.firstFavorable,20);
 const s=output.byDirection.SHORT.firstMove10bps.firstThresholdOrder;
 assert.equal(s.firstFavorable,11);
 assert.equal(s.firstAdverse,11);
 assert.equal(s.firstFavorablePctAmongResolved,50);
 assert.equal(output.byDirection.SHORT.firstMove10bps.thresholdOrderByStrength.STANDARD.resolvedFirstCrossings,22);
 assert.equal(output.ordersSent,0);
});

test('small cohorts and missing crossings are not reported as meaningful first-hit rates',()=>{
 const rows=[record(700,'SHORT',{firstFavorable10bpsMinute:2}),
  record(701,'SHORT',{firstAdverse10bpsMinute:9}),
  record(702,'SHORT'),record(703,'SHORT',{
   firstFavorable10bpsMinute:8,firstAdverse10bpsMinute:8})];
 const r=evaluate(rows,now).byDirection.SHORT.firstMove10bps;
 assert.equal(r.firstThresholdOrder.resolvedFirstCrossings,2);
 assert.equal(r.firstThresholdOrder.firstFavorablePctAmongResolved,null);
 assert.equal(r.firstThresholdOrder.ambiguousTie,1);
 assert.equal(r.firstThresholdOrder.neitherRecordedOrUnknown,1);
 assert.equal(r.thresholdOrderByStrength.STANDARD.resolvedFirstCrossings,2);
 assert.equal(r.thresholdOrderByStrength.STANDARD.firstAdversePctAmongResolved,null);
 assert.equal(r.thresholdOrderByStrength.CAUTION.resolvedFirstCrossings,0);
});

test('first +10bps onset median is arithmetic for even cohort and middle for odd cohort',()=>{
 const even=Array.from({length:20},(_,i)=>record(1200+i,'LONG',{
  firstFavorable10bpsMinute:i<10?6:7,
  firstAdverse10bpsMinute:15
 }));
 const odd=Array.from({length:21},(_,i)=>record(1300+i,'SHORT',{
  firstFavorable10bpsMinute:i<10?5:i===10?8:11
 }));
 const output=evaluate([...even,...odd],now);
 const l=output.byDirection.LONG.firstMove10bps;
 const s=output.byDirection.SHORT.firstMove10bps;
 assert.equal(l.favorable.recorded,20);
 assert.equal(l.favorable.medianMinute,6.5);
 assert.equal(l.adverse.medianMinute,15);
 assert.equal(s.favorable.recorded,21);
 assert.equal(s.favorable.medianMinute,8);
 assert.equal(l.firstThresholdOrder.firstFavorable,20);
 assert.equal(output.ordersSent,0);
 assert.equal(output.changesLiveSignals,false);
});

test('first threshold order partitions by PRE-alert 5m movement, including missing history',()=>{
 const early=Array.from({length:20},(_,i)=>record(1400+i,'LONG',{
  preMove5mBps:i===0?-2:9.9,
  firstFavorable10bpsMinute:i<16?3:null,
  firstAdverse10bpsMinute:i<16?null:6
 }));
 const chased=Array.from({length:20},(_,i)=>record(1500+i,'LONG',{
  preMove5mBps:i===0?10:24,
  firstFavorable10bpsMinute:i<7?2:null,
  firstAdverse10bpsMinute:i<7?null:4
 }));
 const missing=[
  record(1600,'LONG',{preMove5mBps:null,firstFavorable10bpsMinute:3}),
  record(1601,'LONG',{preMove5mBps:NaN,firstAdverse10bpsMinute:5}),
  record(1602,'LONG',{preMove5mBps:undefined}),
  record(1603,'LONG',{preMove5mBps:null,firstFavorable10bpsMinute:8,
   firstAdverse10bpsMinute:8})
 ];
 const notMature=record(1604,'LONG',{sentAt:now-15*MIN,
  preMove5mBps:50,firstFavorable10bpsMinute:2});
 const invalidWindow=record(1605,'LONG',{preMove5mBps:10,
  windows:{30:{status:'NO_DATA',moveBps:null}},firstFavorable10bpsMinute:2});
 const shorts=Array.from({length:20},(_,i)=>record(1700+i,'SHORT',{
  preMove5mBps:null,firstAdverse10bpsMinute:9
 }));
 const v=evaluate([...early,...chased,...missing,notMature,invalidWindow,...shorts],now);
 const l=v.byDirection.LONG.firstMove10bps;
 const a=l.thresholdOrderByPrior5mMove;
 assert.equal(l.eligibleMature30m,44);
 assert.equal(a.BELOW_10BPS.maturedWithObserved30m,20);
 assert.equal(a.BELOW_10BPS.firstFavorable,16);
 assert.equal(a.BELOW_10BPS.firstAdverse,4);
 assert.equal(a.BELOW_10BPS.firstFavorablePctAmongResolved,80);
 assert.equal(a.AT_LEAST_10BPS.maturedWithObserved30m,20);
 assert.equal(a.AT_LEAST_10BPS.firstFavorable,7);
 assert.equal(a.AT_LEAST_10BPS.firstAdverse,13);
 assert.equal(a.AT_LEAST_10BPS.firstFavorablePctAmongResolved,35);
 assert.equal(a.UNKNOWN.maturedWithObserved30m,4);
 assert.equal(a.UNKNOWN.neitherRecordedOrUnknown,1);
 assert.equal(a.UNKNOWN.ambiguousTie,1);
 assert.equal(a.UNKNOWN.firstFavorablePctAmongResolved,null);
 assert.equal(Object.values(a).reduce((s,x)=>s+x.maturedWithObserved30m,0),l.eligibleMature30m);
 const s=v.byDirection.SHORT.firstMove10bps.thresholdOrderByPrior5mMove;
 assert.equal(s.UNKNOWN.maturedWithObserved30m,20);
 assert.equal(s.UNKNOWN.firstFavorablePctAmongResolved,0);
 assert.equal(s.BELOW_10BPS.maturedWithObserved30m,0);
 assert.equal(s.AT_LEAST_10BPS.maturedWithObserved30m,0);
 assert.equal(v.changesLiveSignals,false);
 assert.equal(v.ordersSent,0);
});
