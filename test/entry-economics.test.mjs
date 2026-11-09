import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {
 theoreticalNetRR,requiredPassiveImprovement,studyOneAlert,
 summarizeEconomicAlerts,STUDY_ASSUMPTIONS
} from '../lib/entry-economics.mjs';
import {studyFiveMinutePullback,summarizePullbacks} from '../lib/entry-replay.mjs';
import {parseConfirmedNotification} from '../lib/signal-quality.mjs';

const long={direction:'LONG',entry:100,stop:99,take:102};
const short={direction:'SHORT',entry:100,stop:101,take:98};
const bar=(open,high,low,close)=>({open,high,low,close});
test('published VIP0 market-vs-maker assumptions are disclosed; no private fee claim',()=>{
 assert.match(STUDY_ASSUMPTIONS.feeTier,/not account-specific/);
 assert.match(STUDY_ASSUMPTIONS.spread,/ZERO/);
 assert.match(STUDY_ASSUMPTIONS.limitNotes,/No passive limit order/);
 const lm=theoreticalNetRR(long),sm=theoreticalNetRR(short);
 assert.ok(lm.netRR>0&&sm.netRR>0);
 assert.ok(Math.abs(lm.netRR-sm.netRR)<0.04);
 assert.equal(lm.estimatedCommissionUsdtAt500,0.8);
 const maker=theoreticalNetRR({...long,entryFeeBps:2,exitFeeBps:8,
  entrySlippageBps:0,exitSlippageBps:3});
 assert.equal(maker.estimatedCommissionUsdtAt500,0.5);
 assert.ok(maker.netRR>lm.netRR);
});
test('invalid stops, fee assumptions and raw direction never produce executable guidance',()=>{
 assert.equal(theoreticalNetRR({direction:'LONG',entry:100,stop:101,take:102}),null);
 assert.equal(theoreticalNetRR({...long,entryFeeBps:500}),null);
 assert.equal(theoreticalNetRR({...long,direction:'MAYBE'}),null);
 assert.equal(studyOneAlert({...long}).tradeReady,false);
 assert.equal(studyOneAlert({...short}).filled,false);
});
test('hypothetical maker improvement is priced in correct LONG/SHORT direction and capped at 0.6%',()=>{
 const easy=requiredPassiveImprovement(long);
 assert.ok(easy&&easy.bps===0);
 const borderline={...long,take:101.8};
 const improvement=requiredPassiveImprovement(borderline);
 assert.ok(improvement&&improvement.bps>0&&improvement.bps<=60);
 const price=borderline.entry*(1-improvement.bps/10000);
 const outcome=theoreticalNetRR({...borderline,entry:price,entryFeeBps:2,
  exitFeeBps:8,entrySlippageBps:0,exitSlippageBps:3});
 assert.ok(outcome.netRR>=1.5);
 const shortBorderline={...short,take:98.2};
 const s=requiredPassiveImprovement(shortBorderline);
 assert.ok(s&&s.bps>0&&s.bps<=60);
 const shortOutcome=theoreticalNetRR({...shortBorderline,
  entry:shortBorderline.entry*(1+s.bps/10000),
  entryFeeBps:2,exitFeeBps:8,entrySlippageBps:0,exitSlippageBps:3});
 assert.ok(shortOutcome.netRR>=1.5);
 assert.equal(requiredPassiveImprovement({...long,take:100.01}),null);
});
test('real alert decisions and contemporaneous net R/R do not become trade authorization',()=>{
 const msg={
  event:'message',title:'🔴 ПРОПУСТИТЬ · SUIUSDT LONG · 🟣 СИЛЬНЫЙ',
  time:Math.floor(Date.now()/1000),
  message:'📈 РОСТ · WEEX\n📍 Вход: 0,85485 USDT\n'+
   'SL 0.8508010208 · TP 0.863097795\n'+
   'Чистый R/R (модель): 1.04:1\n⚠️ Чистый R/R ниже 1,5 (модель)'
 };
 const x=parseConfirmedNotification(msg);
 assert.equal(x.decisionAtAlert,'SKIP');
 assert.equal(x.netRRAtAlert,1.04);
 const r=studyOneAlert(x);
 assert.equal(r.netCostPassedAtAlert,false);
 assert.equal(r.tradeReady,false);
 const rows=[{...x,economics:r},{...x,decisionAtAlert:'CHECK',
  netRRAtAlert:1.62,economics:studyOneAlert({...x,decisionAtAlert:'CHECK',netRRAtAlert:1.62})}];
 const summary=summarizeEconomicAlerts(rows);
 assert.equal(summary.total,2);
 assert.equal(summary.reportedFail,1);
 assert.equal(summary.reportedPass,1);
 assert.equal(summary.atAlert.SKIP,1);
 assert.equal(summary.atAlert.CHECK,1);
 assert.equal(summarizeEconomicAlerts([]).reportedPass,0);
});
test('0.1% pullback uses only next three 5m bars and never claims a filled order',()=>{
 const f=[bar(100,100.2,99.85,99.95),bar(100,100.2,99.95,100),bar(100,100.2,99.98,100)];
 const first=studyFiveMinutePullback({...long,signalClose:100,future:f});
 assert.equal(first.status,'TOUCH_POSSIBLE');
 assert.ok(Math.abs(first.limit-99.9)<1e-9);
 const no=studyFiveMinutePullback({...long,signalClose:100,
  future:[bar(100,100.2,99.95,100),bar(100,100.3,99.93,100.1),bar(100,100.2,99.91,100.1)]});
 assert.equal(no.status,'NO_TOUCH');
 const ambiguous=studyFiveMinutePullback({...long,signalClose:100,
  future:[bar(100,102.2,99.85,100),...f.slice(1)]});
 assert.equal(ambiguous.status,'AMBIGUOUS_TOUCH');
 assert.equal(studyFiveMinutePullback({...long,signalClose:100,
  future:[bar(99.8,100,99.7,99.9),...f.slice(1)]}).status,'GAP_OR_MARKETABLE');
 assert.equal(studyFiveMinutePullback({...short,signalClose:100,
  future:[bar(100,100.15,99.9,100.03),...f.slice(1)]}).status,'TOUCH_POSSIBLE');
 assert.equal(studyFiveMinutePullback({...long,signalClose:100,
  future:[bar(100,100.2,99.85,99.95)]}).status,'INVALID');
 const sum=summarizePullbacks([first,no,ambiguous]);
 assert.equal(sum.total,3);
 assert.equal(sum.TOUCH_POSSIBLE,1);
 assert.equal(sum.fillRate,null);
 assert.equal(sum.actualProfit,null);
});
test('dashboard and routes remain market-only; trade safety gates never edited',()=>{
 for(const path of ['quality.html','backtest.html']){
  const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const script=source.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script);
  assert.doesNotThrow(()=>new Script(script[1],{filename:path}));
  assert.doesNotMatch(source,/\/api\/trade-confirm|\/api\/trade-prepare/);
 }
 const report=readFileSync(new URL('../lib/signal-quality-route.mjs',import.meta.url),'utf8');
 const backtest=readFileSync(new URL('../lib/strategy-backtest.mjs',import.meta.url),'utf8');
 for(const s of [report,backtest])
  assert.doesNotMatch(s,/weex\.placeOrder|trade-confirm|trade-prepare|WEEX_API_SECRET/);
 assert.match(report,/summarizeEconomicAlerts/);
 assert.match(backtest,/studyFiveMinutePullback/);
 const main=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(main,/href="\/quality\.html#economics"/);
});
