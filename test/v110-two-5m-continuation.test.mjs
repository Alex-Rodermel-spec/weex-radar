import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateV110TwoFiveMinuteContinuation as evaluate,V110_TWO_5M_POLICY as P}
 from '../lib/v110-two-5m-continuation.mjs';

const START=Date.UTC(2026,10,7),DAY=86_400_000,MIN=60_000,NOW=Date.UTC(2026,10,15);
const observed=moveBps=>({status:'OBSERVED',moveBps});
function build({days=5,perDay=40,reversal=false,missing=false}={}){
 const out=[];
 for(let d=0;d<days;d++)for(let i=0;i<perDay;i++){
  const early=i%2===0,good=!reversal||d<3?early:!early;
  const first=good?3:-3;
  const second=good?9:-9,third=good?18:-18;
  out.push({id:out.length.toString(16).padStart(32,'0'),
   symbol:['BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT'][i%4],
   sentAt:START+d*DAY+i*31*MIN+31_000,
   direction:i%3?'LONG':'SHORT',
   strength:early?'STANDARD':'CAUTION',
   preMove5mBps:early?1:19,
   aligned5m:{1:observed(first),2:observed(second),
    3:missing&&i%3===0?{status:'NO_DATA',moveBps:null}:observed(third)},
   windows:{15:observed(third),30:observed(third)},
   firstFavorable10bpsMinute:good?3:null});
 }
 return out;
}
test('two FULL subsequent 5m close-to-close moves, not the partial 5m at first boundary',()=>{
 const now=Date.UTC(2026,10,15);
 const row=build({days:1,perDay:1})[0];
 // The first 5m boundary can still look bearish for a LONG even when
 // both complete subsequent 5m intervals move upward after publication.
 row.aligned5m={1:observed(-21),2:observed(-7),3:observed(11)};
 let result=evaluate([row],now).complete;
 assert.equal(result.n,1);
 assert.equal(result.firstFull5mFavorable,1);
 assert.equal(result.secondFull5mFavorable,1);
 assert.equal(result.bothAndNetPositiveFromNotice,1);
 assert.ok(result.medianMinutesToSecondFullClose>=10);
 assert.ok(result.medianMinutesToSecondFullClose<=16);
 row.aligned5m={1:observed(-30),2:observed(-20),3:observed(-10)};
 result=evaluate([row],now).complete;
 assert.equal(result.bothFull5mFavorable,1);
 assert.equal(result.twoFavorableButStillUnderwater,1);
 assert.equal(result.bothAndNetPositiveFromNotice,0);
});
test('complete cohort reports both direction and strength; no auto promotion',()=>{
 const r=evaluate(build(),NOW);
 assert.equal(r.status,'DESCRIPTIVE_SAMPLE_AVAILABLE');
 assert.equal(r.archived,200);
 assert.equal(r.matured,200);
 assert.equal(r.distinctUtcDays,5);
 assert.equal(r.complete.bothAndNetPositiveFromNotice,100);
 assert.equal(r.complete.bothFull5mAdverse,100);
 assert.equal(r.complete.prior5m.notExtended,100);
 assert.equal(r.complete.prior5m.alreadyExtended,100);
 assert.ok(r.byDirection.LONG.n>0&&r.byDirection.SHORT.n>0);
 assert.equal(r.noLiveChanges,true);
 assert.equal(r.ordersSent,0);
 assert.equal(r.recommendation,'KEEP_108');
 assert.equal(r.readyForLivePromotion,false);
 assert.equal(P.changesForecasts,false);
});
test('duplicates, missing and future closes do not fabricate a confirmed move',()=>{
 const rows=build({missing:true});
 const a=evaluate([...rows,...rows.map(x=>({...x}))],NOW);
 assert.equal(a.archived,400);
 assert.equal(a.matured,130);
 assert.equal(a.complete.bothAndNetPositiveFromNotice,65);
 assert.equal(a.missingOrUnresolved,70);
 const future={...rows[0],id:'f'.repeat(32),sentAt:NOW-1000};
 assert.equal(evaluate([...rows,future],NOW).matured,130);
 assert.equal(evaluate([],NOW).status,'COLLECTING_CLOSED_5M_WINDOWS');
 assert.equal(evaluate('fake',NOW).status,'INVALID_INPUT');
});
test('two adjacent five minute moves can reverse, which is not confirmation',()=>{
 const r=build({days:1,perDay:1})[0];
 r.aligned5m={1:observed(3),2:observed(11),3:observed(2)};
 const a=evaluate([r],NOW).complete;
 assert.equal(a.firstFull5mFavorable,1);
 assert.equal(a.secondFull5mFavorable,0);
 assert.equal(a.bothAndNetPositiveFromNotice,0);
 assert.equal(a.mixedOrFlat,1);
});
test('read-only route and journal, no cron, trading, new market requests or private leaks',()=>{
 const source=readFileSync(new URL('../lib/v110-two-5m-continuation.mjs',import.meta.url),'utf8');
 const route=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
 const cron=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const trade=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 assert.match(route,/twoClosed5mShadow:evaluateV110TwoFiveMinuteContinuation\(forecastRows,now\)/);
 assert.doesNotMatch(cron,/v110-two-5m-continuation/);
 assert.doesNotMatch(trade,/v110-two-5m-continuation/);
 for(const forbidden of ['fetch(', 'process.env','NTFY_TOPIC','placeOrder',
  'trade-confirm','trade-prepare','push-dispatch','@vercel/blob','OPENAI_API_KEY']){
  assert.ok(!source.includes(forbidden),forbidden);
 }
});
