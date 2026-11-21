import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastMessage,forecastTopic} from '../lib/forecast-ntfy.mjs';
import {parsePublishedForecast,normalizeForecastArchiveRow,
 mergeForecastArchive,FORECAST_HORIZONS} from '../lib/forecast-journal.mjs';
import {evaluateV110V5Forward, V5_FORWARD_POLICY as POLICY}
 from '../lib/v110-v5-forward-audit.mjs';
const now=Date.UTC(2026,10,21,10,30,40),sent=now-40*60000;
const env={NTFY_TOPIC:'wr-'+('a'.repeat(32))};
function forecast(v5='SHORT_BIAS'){
 const frames=[1,5,10].map((n,i)=>({
  intervalMinutes:n,closedAt:sent-(i?5*60000:0),
  direction:'SHORT_BIAS',rsi14:40,relativeVolume:1.1,
  atr14:.3,price:100,trend:'DOWN',voteAgreement:2,
  bollinger20:{position:'LOWER_HALF'}
 }));
 return {available:true,symbol:'BTCUSDT',combinedDirection:'SHORT_BIAS',
  alignment:'THREE_TIMEFRAME_ALIGNMENT',timeframes:frames,
  primaryContext:{structure:'LOWER_HIGHS_LOW'},
  forecastV5:{available:true,direction:v5,closedAt1m:frames[0].closedAt}};
}
function ntfy(v5,seq='a'.repeat(32)){
 const n=forecastMessage(forecast(v5));
 return {event:'message',topic:forecastTopic(env),sequence_id:seq,
  title:n.title,message:n.message,time:Math.floor(sent/1000)};
}
function entry(id,legacy='SHORT',v5='SHORT',bps=12){
 const windows=Object.fromEntries(FORECAST_HORIZONS.map(h=>
  [h,{status:'OBSERVED',moveBps:bps}]));
 return {id,reference:100,symbol:'BTCUSDT',direction:legacy,
  strength:'STANDARD',sentAt:sent,windows,v5Direction:v5,
  v2Timing:null};
}
test('real ntfy publication contains V5 receipt in same line and legacy journal parses it',()=>{
 for(const [side,want] of [['SHORT_BIAS','SHORT'],['LONG_BIAS','LONG'],['MIXED','MIXED']]){
  const n=ntfy(side);
  assert.match(n.message,new RegExp('🧪 V5: '+want));
  const parsed=parsePublishedForecast(n,forecastTopic(env),now,env);
  assert.ok(parsed);
  assert.equal(parsed.v5Direction,want);
  assert.equal(parsed.direction,'SHORT');
  assert.ok(n.message.split('\n').length<=7);
 }
 const old=ntfy('SHORT_BIAS');
 const older={...old,message:old.message.replace(' · 🧪 V5: SHORT','')};
 assert.equal(parsePublishedForecast(older,forecastTopic(env),now,env).v5Direction,null);
 const forged={...old,message:old.message.replace(' · 🧪 V5: SHORT',' · 🧪 V5: BANANA')};
 assert.equal(parsePublishedForecast(forged,forecastTopic(env),now,env).v5Direction,null);
});
test('encrypted-journal row normalization and merge keep publication-time V5 rather than reconstruct later',()=>{
 const old=normalizeForecastArchiveRow(entry('a'.repeat(32),'SHORT',null,3),now);
 const newer=normalizeForecastArchiveRow(entry('a'.repeat(32),'SHORT','LONG',3),now);
 const first=mergeForecastArchive([old],[newer],now);
 assert.equal(first.rows.length,1);
 assert.equal(first.rows[0].v5Direction,'LONG');
 assert.equal(first.rows[0].windows[5].moveBps,3);
 const stale=mergeForecastArchive(first.rows,[old],now);
 assert.equal(stale.rows[0].v5Direction,'LONG');
});
test('V5 comparison uses ONLY observed direction after published snapshot with correct sign reversal',()=>{
 const r=evaluateV110V5Forward([
  entry('a'.repeat(32),'SHORT','LONG',10),
  {...entry('b'.repeat(32),'SHORT','SHORT',-7),
   symbol:'ETHUSDT',sentAt:sent+60000},
  {...entry('c'.repeat(32),'SHORT','MIXED',30),
   symbol:'XRPUSDT',sentAt:sent+120000},
  {...entry('d'.repeat(32),'SHORT',null,500),
   symbol:'SOLUSDT',sentAt:sent+180000},
  {...entry('e'.repeat(32),'SHORT','SHORT',999),
   symbol:'ADAUSDT',sentAt:now-3*60000,
   windows:{5:{status:'PENDING'},15:{status:'PENDING'}}}
 ],now);
 assert.equal(r.receiptCount,3);
 assert.equal(r.mixedAbstentions,1);
 assert.equal(r.candidateCount,2);
 assert.equal(r.primary5m.legacy.observed,2);
 assert.equal(r.primary5m.legacy.favorable,1);
 assert.equal(r.primary5m.v5.observed,2);
 assert.equal(r.primary5m.v5.favorable,0);
 assert.equal(r.primary5m.differencePp,-50);
 assert.equal(r.recommendation,'KEEP_V4');
 assert.equal(r.ordersSent,0);
 assert.equal(r.allV5OnlyCandidatesObserved,false);
});
test('future outcomes absent, no V5 receipt, or too few days never allows promotion',()=>{
 const r=evaluateV110V5Forward([entry('a'.repeat(32),'SHORT',null,-20)],now);
 assert.equal(r.receiptCount,0);
 assert.equal(r.status,'COLLECTING_PUBLISHED_V5_RECEIPTS');
 assert.equal(r.prospectiveOutcomeMeasured,false);
 assert.equal(POLICY.autoPromotion,false);
 assert.equal(POLICY.live108Unchanged,true);
 assert.equal(POLICY.extraMarketRequests,0);
});
