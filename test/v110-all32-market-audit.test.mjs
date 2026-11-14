import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateV110All32MarketAudit as audit,V110_ALL32_AUDIT_POLICY as P}
 from '../lib/v110-all32-market-audit.mjs';
import {profileSymbols} from '../lib/market-forecast-profiles.mjs';
const NOW=Date.UTC(2026,10,14,20),MIN=60000;
const win=(status,moveBps)=>({status,moveBps});
const row=(id,symbol,direction='SHORT',pre=5)=>({
 id:id.toString(16).padStart(32,'0'),symbol,direction,
 strength:'STANDARD',sentAt:NOW-30*MIN-id*1000,
 preMove5mBps:pre,windows:{
  5:win('OBSERVED',6),15:win('OBSERVED',-4),
  30:win('OBSERVED',10)}
});
test('ALWAYS includes every official 32-market instrument even with no notice',()=>{
 const a=audit([],[],NOW);
 assert.equal(a.status,'DESCRIPTIVE_ONLY');
 assert.equal(a.marketsInUniverse,32);
 assert.equal(a.markets.length,32);
 assert.deepEqual(new Set(a.markets.map(m=>m.symbol)),new Set(profileSymbols()));
 assert.equal(a.marketsWithArchivedForecasts,0);
 assert.equal(a.marketsWithoutArchivedForecasts.length,32);
 assert.equal(a.totals.forecast.published,0);
 assert.equal(a.ordersSent,0);
 assert.equal(a.futurePredictionApproved,false);
 assert.equal(P.noMarketRequests,true);
});
test('count 5m/15m/30m separately; failures and zero move never become wins',()=>{
 const input=[row(1,'BTCUSDT'),row(2,'BTCUSDT','LONG',20),
  row(3,'XRPUSDT','SHORT',null),{
   ...row(4,'BTCUSDT'),windows:{
    5:win('NO_DATA',null),15:win('PENDING',null),30:win('OBSERVED',0)}
  }];
 const out=audit(input,[row(7,'XRPUSDT')],NOW);
 const btc=out.markets.find(m=>m.symbol==='BTCUSDT');
 assert.equal(btc.forecast.published,3);
 assert.equal(btc.forecast.SHORT,2);
 assert.equal(btc.forecast.LONG,1);
 assert.equal(btc.forecast.after5m.observed,2);
 assert.equal(btc.forecast.after5m.favorable,2);
 assert.equal(btc.forecast.after5m.noData,1);
 assert.equal(btc.forecast.after15m.observed,2);
 assert.equal(btc.forecast.after15m.adverse,2);
 assert.equal(btc.forecast.after30m.flat,1);
 assert.equal(btc.forecast.after5m.favorablePct,null,'do not show unreliable percentage under 20');
 assert.equal(btc.forecast.pre5m.alreadyMovedAtLeast10bps,1);
 assert.equal(out.markets.find(m=>m.symbol==='XRPUSDT').confirmed.published,1);
 assert.equal(out.totals.confirmed.published,1);
});
test('dedupe notifications, reject fabricated symbols and stop old / future rows',()=>{
 const v=row(1,'ETHUSDT');
 const a=audit([v,v,{...v,id:'f'.repeat(32),symbol:'FAKEUSDT'},
  {...row(2,'BTCUSDT'),sentAt:NOW+1000},
  {...row(3,'SOLUSDT'),sentAt:NOW-91*86400000}],[],NOW);
 assert.equal(a.totals.forecast.published,1);
 assert.equal(a.marketsWithArchivedForecasts,1);
 assert.equal(a.markets.find(m=>m.symbol==='ETHUSDT').forecast.published,1);
});
test('all 32 market percentages visible ONLY if at least 20 observed',()=>{
 const data=Array.from({length:22},(_,i)=>{
  const r=row(i+1,'SOLUSDT');
  r.windows[15]=win('OBSERVED',i<17?12:-2);
  return r;
 });
 const a=audit(data,[],NOW),s=a.markets.find(m=>m.symbol==='SOLUSDT');
 assert.equal(s.forecast.after15m.observed,22);
 assert.equal(s.forecast.after15m.favorable,17);
 assert.equal(s.forecast.after15m.favorablePct,77.3);
 assert.equal(s.forecast.pre5m.alreadyMovedPct,0);
 assert.equal(s.confirmed.after15m.favorablePct,null);
});
test('read-only journal route returns aggregates; no trading path references new audit',()=>{
 const src=readFileSync(new URL('../lib/v110-all32-market-audit.mjs',import.meta.url),'utf8');
 const journal=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
 const push=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 assert.match(journal,/all32MarketAudit:evaluateV110All32MarketAudit\(forecastRows,confirmedAuditRows,now\)/);
 assert.doesNotMatch(push,/v110-all32-market-audit/);
 for(const forbidden of ['fetch(', 'process.env','NTFY_TOPIC','OPENAI_API_KEY','placeOrder','trade-confirm','trade-prepare','cron-job.org']){
  assert.ok(!src.includes(forbidden),forbidden);
 }
});
