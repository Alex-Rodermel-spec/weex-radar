import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyV110MarketRegime} from '../lib/v110-regime-shadow.mjs';
import {
 estimateV110ExecutionContext,summarizeV110ExecutionContext
} from '../lib/v110-execution-shadow.mjs';
const END=Date.UTC(2026,10,13,3,45);
const bars=(duration,delta=0,lastRange=0.2)=>Array.from({length:60},(_,i)=>{
 const time=END-(60-i)*duration,close=100+i*delta;
 const range=i===59?lastRange:0.2;
 return {time,closeTime:time+duration,
  open:close,close,high:close+range/2,low:close-range/2};
});
test('regime is a deterministic observation on fully closed 5m and 15m bars',()=>{
 assert.equal(classifyV110MarketRegime(bars(300000),bars(900000),END).regime,'RANGE');
 assert.equal(classifyV110MarketRegime(bars(300000,.2),bars(900000,.3),END).regime,'TREND_UP');
 assert.equal(classifyV110MarketRegime(bars(300000,-.2),bars(900000,-.3),END).regime,'TREND_DOWN');
 assert.equal(classifyV110MarketRegime(bars(300000,0,3),bars(900000),END).regime,'VOLATILE');
});
test('gapped, incomplete, future-closed or invalid series fail closed as UNKNOWN',()=>{
 const five=bars(300000),fifteen=bars(900000);
 assert.equal(classifyV110MarketRegime(five,fifteen,END-300000).regime,'UNKNOWN');
 assert.equal(classifyV110MarketRegime(five.slice(1),fifteen,END).regime,'UNKNOWN');
 const gap=five.map(x=>({...x}));gap[30].time+=300000;
 assert.equal(classifyV110MarketRegime(gap,fifteen,END).regime,'UNKNOWN');
 const bad=five.map(x=>({...x}));bad[59].low=0;
 assert.equal(classifyV110MarketRegime(bad,fifteen,END).regime,'UNKNOWN');
});
const forward={5:{grossBps:20},10:{grossBps:30},15:{grossBps:40}};
test('cost shock and next-open chase estimate are stress-only, symmetric by side',()=>{
 const a=estimateV110ExecutionContext({
  direction:'LONG',signalClose:100,nextOpen:100.15,forward
 });
 const b=estimateV110ExecutionContext({
  direction:'SHORT',signalClose:100,nextOpen:99.85,forward
 });
 assert.equal(a.chaseProxy,true);
 assert.equal(a.priceGapBps,15);
 assert.equal(a.series[5].normalModeledNetBps,-2);
 assert.equal(a.series[5].stressModeledNetBps,-12);
 assert.deepEqual(a.series,b.series);
 assert.equal(b.chaseProxy,true);
 const s=summarizeV110ExecutionContext([a,b]);
 assert.equal(s.count,2);
 assert.equal(s.chaseProxyCount,2);
 assert.equal(s.at5m.stressFlipsFromPositive,0);
});
test('empty cohort and invalid inputs never fabricate profitable execution',()=>{
 const o=summarizeV110ExecutionContext([]);
 assert.equal(o.at5m.normalNetPositivePct,null);
 assert.equal(o.meanNextOpenGapBps,null);
 assert.equal(estimateV110ExecutionContext({direction:'NEUTRAL',signalClose:100,nextOpen:101,forward}),null);
 assert.equal(estimateV110ExecutionContext({direction:'LONG',signalClose:100,nextOpen:101,forward:{5:{grossBps:3}}}),null);
});
test('live scanner and ntfy logic never import research-only modules',()=>{
 const live=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const scan=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const replay=readFileSync(new URL('../lib/strategy-backtest.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(live,/v110-regime-shadow|v110-execution-shadow/);
 assert.doesNotMatch(scan,/classifyV110MarketRegime|estimateV110ExecutionContext/);
 assert.match(replay,/regimeStudy:/);
 assert.match(replay,/executionShadowStudy:/);
});
