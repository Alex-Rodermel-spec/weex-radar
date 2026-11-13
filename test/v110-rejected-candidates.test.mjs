import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 replayForwardAt5m,summarizeMissedOpportunityRows
} from '../lib/strategy-backtest.mjs';

const future=values=>values.map(close=>({close}));
test('5/10/15m forward study respects LONG and SHORT side after cutoff',()=>{
 const l=replayForwardAt5m('LONG',100,future([101,102,103]));
 const s=replayForwardAt5m('SHORT',100,future([99,98,97]));
 assert.equal(l[5].grossBps,100);
 assert.equal(l[5].modeledNetBps,78);
 assert.deepEqual(l,s);
 assert.equal(l[10].modeledNetBps,178);
 assert.equal(l[15].modeledNetBps,278);
});
test('fees and slippage are explicitly subtracted; favorable price may lose after costs',()=>{
 const row=replayForwardAt5m('LONG',100,future([100.1,100.15,100.3]));
 assert.equal(row[5].grossBps,10);
 assert.equal(row[5].modeledNetBps,-12);
 const noCost=replayForwardAt5m('LONG',100,future([100.1,100.15,100.3]),
  {feeBps:0,slippageBps:0});
 assert.equal(noCost[5].modeledNetBps,10);
});
test('empty cohort never fabricates success percentages',()=>{
 const report=summarizeMissedOpportunityRows([]);
 assert.equal(report.count,0);
 assert.equal(report.at5m.grossFavorablePct,null);
 assert.equal(report.at10m.modeledNetPositivePct,null);
 assert.equal(report.at15m.meanModeledNetBps,null);
});
test('unobserved or corrupt data cannot pass and side is validated',()=>{
 assert.throws(()=>replayForwardAt5m('FLAT',100,future([100,100,100])));
 assert.throws(()=>replayForwardAt5m('LONG',100,future([100,100])));
 assert.throws(()=>replayForwardAt5m('LONG',100,future([100,-1,100])));
 assert.throws(()=>replayForwardAt5m('LONG',100,future([100,100,100]),
  {feeBps:-1}));
 const result=summarizeMissedOpportunityRows([{forward:{5:{grossBps:5,modeledNetBps:-17}}}]);
 assert.equal(result.at5m.n,1);
 assert.equal(result.at5m.grossFavorablePct,100);
 assert.equal(result.at5m.modeledNetPositivePct,0);
 assert.equal(result.at10m.n,0);
});
test('missed opportunity addition is strictly historical research and cannot alter ntfy',()=>{
 const source=readFileSync(new URL('../lib/strategy-backtest.mjs',import.meta.url),'utf8');
 const route=readFileSync(new URL('../lib/backtest-route.mjs',import.meta.url),'utf8');
 assert.match(source,/missedOpportunityStudy:/);
 assert.match(source,/BACKTEST_ONLY_NOT_PROSPECTIVE/);
 assert.match(source,/changesLiveSignals:false,ordersSent:0/);
 assert.match(route,/backtestOnly:true,changesLiveSignals:false,changesOrders:false/);
 assert.doesNotMatch(source,/placeOrder|trade-confirm|ntfySend|NTFY_TOPIC|PUSH_CRON_KEY/);
});
