import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateV110MultiHorizonChase,V110_CHASE_POLICY} from '../lib/v110-multihorizon-chase-study.mjs';
const DAY=86400000,MIN=60000;
const origin=Date.parse('2026-11-08T00:00:00Z');
const now=origin+9*DAY;
const symbols=['BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT',
 'HYPEUSDT','ZECUSDT','1000PEPEUSDT','1000SHIBUSDT'];
const row=(i,day,coin,step,late)=>{
 const t=origin+day*DAY+step*40*MIN;
 const direction=coin%2?'SHORT':'LONG',good=!late;
 return {id:i.toString(16).padStart(32,'0'),symbol:symbols[coin],
  direction,strength:'STANDARD',sentAt:t,
  preMove15mBps:late?50:0,preMove30mBps:late?120:8,
  preMove60mBps:late?220:12,
  firstFavorable10bpsMinute:good?4:null,
  firstAdverse10bpsMinute:good?null:3,
  windows:Object.fromEntries([5,15,30].map(h=>[
   h,{status:'OBSERVED',moveBps:good?12:-15}]))};
};
function sevenDays(){
 const arr=[];let id=1;
 for(let day=0;day<7;day++)
  for(let coin=0;coin<8;coin++)
   for(let step=0;step<8;step++)
    arr.push(row(id++,day,coin,step,step%4===0));
 return arr;
}
test('immutable pre-alert 15/30/60m fields and strict chronological independent UTC days',()=>{
 const sample=sevenDays(),r=evaluateV110MultiHorizonChase(sample,now);
 assert.equal(r.status,'HISTORICAL_COMPARISON_AVAILABLE');
 assert.equal(r.eligible,7*8*8);
 assert.equal(r.distinctUtcDays,7);
 assert.equal(r.splitUtcDay,'2026-11-13');
 assert.equal(r.train.n,5*8*8);
 assert.equal(r.holdout.n,2*8*8);
 assert.equal(r.train.byLookback[15].extended.n,5*8*2);
 assert.equal(r.holdout.byLookback[15].clean.n,2*8*6);
 assert.equal(r.holdout.byLookback[15].extended.n,2*8*2);
 assert.equal(r.holdout.byLookback[30].extended.n,2*8*2);
 assert.equal(r.holdout.byLookback[60].absoluteExtreme2pct,2*8*2);
 assert.equal(r.holdoutCleanMinusExtended15mPp,100);
 assert.equal(r.screeningPassHistorical,true);
 assert.equal(r.readyForOwnerReview,true);
 assert.equal(r.acceptedForLive,false);
 assert.equal(r.accuracyImproved,false);
 assert.equal(r.recommendation,'KEEP_108');
 assert.equal(r.ordersSent,0);
 assert.equal(V110_CHASE_POLICY.noLiveChanges,true);
 assert.equal(V110_CHASE_POLICY.noNewWEEXRequests,true);
});
test('missing prior history stays UNKNOWN and never silently becomes an EARLY success',()=>{
 const data=sevenDays();
 const x=data[0];x.preMove15mBps=null;x.preMove30mBps=NaN;
 const t=evaluateV110MultiHorizonChase(data,now);
 assert.equal(t.fullSample.byLookback[15].unknown.n,1);
 assert.equal(t.fullSample.byLookback[30].unknown.n,1);
 assert.equal(t.fullSample.byLookback[15].extended.n,7*8*2-1);
 assert.equal(t.fullSample.byLookback[15].clean.n,7*8*6);
 assert.equal(t.fullSample.byLookback[30].knownCoveragePct,
  Math.round((7*8*8-1)/(7*8*8)*1000)/10);
});
test('same symbol repeated within 30m is excluded before train/holdout calculation',()=>{
 const data=sevenDays(),d=data[0];
 data.push({...d,id:'a'.repeat(32),sentAt:d.sentAt+5*MIN});
 const r=evaluateV110MultiHorizonChase(data,now);
 assert.equal(r.uniquePublished,7*8*8+1);
 assert.equal(r.eligible,7*8*8);
 assert.equal(r.excludedCloseRepeat,1);
});
test('future, incomplete, malformed and unknown archived forecast outcomes cannot be wins',()=>{
 const rows=sevenDays();
 const incomplete={...rows[0],id:'b'.repeat(32),
  windows:{5:rows[0].windows[5],15:{status:'PENDING'},30:rows[0].windows[30]}};
 const future={...rows[1],id:'c'.repeat(32),sentAt:now+MIN};
 const damage={...rows[2],id:'d'.repeat(32),preMove15mBps:Infinity};
 // Missing preMove is UNKNOWN, but damaged outcome candles must be rejected.
 const damagedOutcome={...rows[3],id:'e'.repeat(32),
  windows:{...rows[3].windows,15:{status:'OBSERVED',moveBps:Infinity}}};
 const r=evaluateV110MultiHorizonChase([...rows,incomplete,future,damage,damagedOutcome],now);
 assert.equal(r.eligible,7*8*8);
 assert.equal(r.uniquePublished,7*8*8+1);
 assert.equal(r.fullSample.byLookback[15].unknown.n,0,
  'duplicate-timestamp candidate is discarded, not counted twice');
 assert.equal(r.accuracyImproved,false);
});
test('does not claim results from one short day or absent data',()=>{
 assert.equal(evaluateV110MultiHorizonChase([],now).status,
  'INSUFFICIENT_DISTINCT_UTC_DAYS');
 const oneDay=sevenDays().filter(r=>r.sentAt<origin+DAY);
 const r=evaluateV110MultiHorizonChase(oneDay,now);
 assert.equal(r.status,'INSUFFICIENT_DISTINCT_UTC_DAYS');
 assert.equal(r.acceptedForLive,undefined);
 assert.equal(evaluateV110MultiHorizonChase({},now).status,'INVALID_INPUT');
});
test('new audit reads existing encrypted forecast rows only, not live indicators, ntfy or trading',()=>{
 const audit=readFileSync(new URL('../lib/v110-multihorizon-chase-study.mjs',import.meta.url),'utf8');
 const route=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
 assert.match(route,/multiHorizonChaseAudit:evaluateV110MultiHorizonChase\(forecastRows,now\)/);
 assert.doesNotMatch(audit,/\bfetch\(|\/capi\/v3\/order|trade-confirm|ntfy\.sh|process\.env|WEEX_API_SECRET/);
 assert.match(audit,/recommendation:'KEEP_108'/);
});
