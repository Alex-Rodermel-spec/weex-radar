import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {alertCandleCloseAt,studyConfirmedArrival,summarizeConfirmedArrival}
 from '../lib/arrival-timing-study.mjs';
import {parseConfirmedNotification} from '../lib/signal-quality.mjs';
const M=60_000,FIVE=5*M;
const close=Date.parse('2026-11-11T13:25:00Z'); // Berlin 14:25
const sentAt=close+22_000;
const note='🕒 Свеча 14:25:00 · отправка 14:25:22 · задержка 22с';
const msg={
 event:'message',time:Math.floor(sentAt/1000),
 title:'🟢 ПРОВЕРИТЬ · HYPEUSDT SHORT · 🔔 ОБЫЧНЫЙ',
 message:'🟢 ЧТО ДЕЛАТЬ: ПРОВЕРЬ ЦЕНУ И РИСК. НЕ АВТОВХОД.\n'+
  '📉 ПАДЕНИЕ · WEEX\n📍 Вход: 98 USDT\n'+
  'SL 99 · TP 96.5\nЧистый R/R (модель): 1.38:1\n'+
  '⏰ До 14:27:00 · Проверь актуальную цену\n'+note
};
const parsed=parseConfirmedNotification(msg);
const bar=(time,open,close)=>{
 const high=Math.max(open,close)+0.05,low=Math.min(open,close)-0.05;
 return {time,closeTime:time+M,open,high,low,close};
};
const candles=[
 ...Array.from({length:5},(_,i)=>bar(close-FIVE+i*M,100-i*0.4,99.6-i*0.4)),
 ...Array.from({length:15},(_,i)=>bar(close+i*M,
  98-i*0.1,97.9-i*0.1))
];
const now=close+20*M;
test('parse only original 5m timestamp, with DST and replay protection',()=>{
 assert.ok(parsed);
 assert.equal(parsed.candleCloseAt,close);
 assert.equal(parsed.sentAt,sentAt);
 assert.equal(alertCandleCloseAt(note,sentAt),close);
 assert.equal(alertCandleCloseAt('🕒 Свеча 14:20:00',sentAt),null);
 assert.equal(alertCandleCloseAt('Сигнал отправлен',sentAt),null);
 assert.equal(alertCandleCloseAt('🕒 Свеча 14:25:00',sentAt+5*M),null);
 const summer=Date.parse('2026-07-01T12:30:00Z');
 assert.equal(alertCandleCloseAt('🕒 Свеча 14:30:00',summer+22_000),summer);
 const winter=Date.parse('2026-11-11T13:30:00Z');
 assert.equal(alertCandleCloseAt('🕒 Свеча 14:30:00',winter+35_000),winter);
 assert.equal(alertCandleCloseAt('🕒 Свеча 14:30:00',winter+91_000),null);
});
test('separate completed 5m movement from five FULL subsequent 1m closes',()=>{
 const a=studyConfirmedArrival(parsed,candles,now);
 assert.equal(a.status,'OBSERVED');
 assert.equal(a.lagSeconds,22);
 assert.equal(a.pre5mMoveBps,200);
 assert.equal(a.closeToAlertBps,0);
 assert.equal(a.after5mStatus,'OBSERVED');
 assert.equal(a.after10mStatus,'OBSERVED');
 assert.ok(a.after5mMoveBps>0);
 assert.equal(a.after5mMoveBps,Math.round((98-97.4)/98*100_000)/10);
 assert.equal(a.tradeReady,false);
 assert.equal(a.notATrade,true);
 const long={...parsed,direction:'LONG',stop:97,take:99};
 const b=studyConfirmedArrival(long,candles,now);
 assert.equal(b.pre5mMoveBps,-200);
 assert.ok(b.after5mMoveBps<0);
});
test('no future looking, gaps and missing time are NEVER positive outcomes',()=>{
 const noTime=studyConfirmedArrival({...parsed,candleCloseAt:null},candles,now);
 assert.equal(noTime.status,'NO_CANDLE_TIMESTAMP');
 assert.equal(noTime.lagSeconds,null);
 assert.equal(noTime.after5mMoveBps,null);
 const pending=studyConfirmedArrival(parsed,candles,close+2*M+900);
 assert.equal(pending.after5mStatus,'PENDING');
 assert.equal(pending.after5mMoveBps,null);
 const missing=candles.filter(x=>x.time!==close+3*M);
 const incomplete=studyConfirmedArrival(parsed,missing,now);
 assert.equal(incomplete.after5mStatus,'NO_DATA');
 assert.equal(incomplete.after5mMoveBps,null);
 const withoutBefore=studyConfirmedArrival(parsed,
  candles.filter(x=>x.time!==close-3*M),now);
 assert.equal(withoutBefore.pre5mMoveBps,null);
 assert.equal(withoutBefore.after5mStatus,'OBSERVED');
 const duplicated=studyConfirmedArrival(parsed,[...candles,candles[0]],now);
 assert.equal(duplicated.status,'NO_DATA');
 assert.equal(duplicated.after5mMoveBps,null);
});
test('aggregate excludes unknown and pending, not a trading win rate',()=>{
 const ok=studyConfirmedArrival(parsed,candles,now);
 const pending=studyConfirmedArrival(parsed,candles,close+2*M);
 const unknown=studyConfirmedArrival({...parsed,candleCloseAt:null},candles,now);
 const sum=summarizeConfirmedArrival([
  {arrivalTiming:ok},{arrivalTiming:pending},{arrivalTiming:unknown}]);
 assert.equal(sum.total,3);
 assert.equal(sum.lagMeasured,2);
 assert.equal(sum.pre5mMeasured,2);
 assert.equal(sum.pre5mAtLeast10Bps,2);
 assert.equal(sum.after5mMeasured,1);
 assert.equal(sum.after5mFavorable,1);
 assert.equal(sum.after5mAdverse,0);
 assert.equal(sum.after5mPending,1);
 assert.equal('winRatePct' in sum,false);
 assert.equal('profit' in sum,false);
});
test('API and dashboard remain read-only and browser script is valid',()=>{
 const route=readFileSync(new URL('../lib/signal-quality-route.mjs',import.meta.url),'utf8');
 const html=readFileSync(new URL('../quality.html',import.meta.url),'utf8');
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1],{filename:'quality.html'}));
 assert.match(route,/arrivalTiming:studyConfirmedArrival/);
 assert.match(route,/arrivalTimingStudy:summarizeConfirmedArrival/);
 assert.match(html,/id="arrival-timing"/);
 assert.match(html,/id="timing-lag"/);
 assert.match(html,/id="timing-plus"/);
 assert.match(html,/id="timing-minus"/);
 assert.match(route,/oneMinuteResearch:studyRealAlertOneMinute/);
 for(const source of [route,html,readFileSync(
  new URL('../lib/arrival-timing-study.mjs',import.meta.url),'utf8')])
  assert.doesNotMatch(source,/\/api\/trade-confirm|\/api\/trade-prepare|WEEX_API_SECRET|placeOrder/);
});
