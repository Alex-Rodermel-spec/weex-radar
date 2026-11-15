import test from 'node:test';
import assert from 'node:assert/strict';
import {
 V110_EARLY_REVERSAL_SHADOW_POLICY as POLICY,
 detectEarlyOneMinuteCandidate,
 evaluateEarlyTwoFullFuture5m,
 summarizeEarlyOneMinuteStudies
} from '../lib/v110-early-reversal-shadow.mjs';
import {freeSnapshot} from '../lib/v110-ntfy-free-screenshot-inbox.mjs';

const MIN=60000,FIVE=5*MIN;
const at=Date.UTC(2026,10,15,3,7,14);
const context=(one='LONG_BIAS',five='SHORT_BIAS',ten='SHORT_BIAS')=>({
 available:true,exchange:'WEEX',symbol:'XRPUSDT',combinedDirection:'MIXED',
 timeframes:[
  {intervalMinutes:1,direction:one,closedAt:at-14_000,price:0.9033,rsi14:61,
   lastCandleBody:'UP'},
  {intervalMinutes:5,direction:five,closedAt:at-2*MIN,price:0.9000,rsi14:46,
   lastCandleBody:'DOWN'},
  {intervalMinutes:10,direction:ten,closedAt:at-2*MIN,price:0.8995,rsi14:44,
   lastCandleBody:'DOWN'}]
});
const cap={ok:true,symbol:'XRPUSDT',timeframeMinutes:5};
const fullBars=(priceFunc=i=>0.9033+i*0.0001)=>{
 const first=Math.ceil(at/FIVE)*FIVE;
 return Array.from({length:11},(_,i)=>({
  time:first+i*MIN,
  open:priceFunc(i),close:priceFunc(i+1)
 }));
};
test('catches 1m LONG AGAINST bearish 5m, without recommending a trade',()=>{
 const c=detectEarlyOneMinuteCandidate(context(),at);
 assert.equal(c.kind,'ONE_MINUTE_OPPOSES_FIVE');
 assert.equal(c.bias,'LONG_BIAS');
 assert.equal(c.fiveMinuteBiasAtPrediction,'SHORT_BIAS');
 assert.equal(c.headlinePermission,false);
 const rec=freeSnapshot(cap,context(),'img-bytes-not-stored',at);
 assert.equal(rec.scorable,true);
 assert.equal(rec.publishedDecision,'MIXED');
 assert.equal(rec.researchKind,'ONE_MINUTE_OPPOSES_FIVE');
 assert.equal(rec.direction,'LONG_BIAS');
 assert.equal(rec.noTrade,true);
 assert.equal(rec.screenshotDecoded,false);
 assert.equal(POLICY.noNewWEEXRequests,true);
 assert.equal(POLICY.noStrategyChanges,true);
});
test('captures 1m LONG vs neutral 5m; reversed SHORT vs 5m LONG',()=>{
 const neutral=detectEarlyOneMinuteCandidate(context('LONG_BIAS','NEUTRAL','SHORT_BIAS'),at);
 assert.equal(neutral.kind,'ONE_MINUTE_LEADS_NEUTRAL_FIVE');
 const short=detectEarlyOneMinuteCandidate(context('SHORT_BIAS','LONG_BIAS','LONG_BIAS'),at);
 assert.equal(short.kind,'ONE_MINUTE_OPPOSES_FIVE');
 assert.equal(short.bias,'SHORT_BIAS');
 const lag10=detectEarlyOneMinuteCandidate(context('LONG_BIAS','LONG_BIAS','NEUTRAL'),at);
 assert.equal(lag10.kind,'ONE_AND_FIVE_AHEAD_OF_TEN');
});
test('does NOT capture neutral 1m or already fully aligned signs',()=>{
 assert.equal(detectEarlyOneMinuteCandidate(context('NEUTRAL','SHORT_BIAS','SHORT_BIAS'),at),null);
 assert.equal(detectEarlyOneMinuteCandidate(context('LONG_BIAS','LONG_BIAS','LONG_BIAS'),at),null);
 assert.equal(detectEarlyOneMinuteCandidate({...context(),exchange:'Bybit'},at),null);
 assert.equal(detectEarlyOneMinuteCandidate(context(),at+3*MIN),null);
});
test('only scores TWO full 5m candle bodies after forecast; never retroactively scores initial partial bar',()=>{
 const c=detectEarlyOneMinuteCandidate(context(),at);
 const bars=fullBars();
 const result=evaluateEarlyTwoFullFuture5m(c,bars,Math.ceil(at/FIVE)*FIVE+11*MIN+2_000);
 assert.equal(result.status,'OBSERVED');
 assert.equal(result.firstFull5m.bodyResult,'FAVORABLE');
 assert.equal(result.secondFull5m.bodyResult,'FAVORABLE');
 assert.equal(result.twoCandleConfirmation,true);
 assert.equal(result.firstCompleteFiveMinuteCandleStartAt,Date.UTC(2026,10,15,3,10));
 assert.equal(result.ordersSent,0);
 const early=evaluateEarlyTwoFullFuture5m(c,bars,Date.UTC(2026,10,15,3,17,0));
 assert.equal(early.status,'PENDING_OR_MISSING');
 assert.equal(early.twoCandleConfirmation,null);
 const gap=evaluateEarlyTwoFullFuture5m(c,bars.filter(x=>x.time!==Date.UTC(2026,10,15,3,13)),Date.UTC(2026,10,15,3,21,2));
 assert.equal(gap.status,'PENDING_OR_MISSING');
 assert.equal(gap.twoCandleConfirmation,null);
});
test('unfavorable reversal is never a win and percentage hidden below sample n20',()=>{
 const c=detectEarlyOneMinuteCandidate(context(),at);
 const bars=fullBars(i=>1-i*0.002);
 const x=evaluateEarlyTwoFullFuture5m(c,bars,Math.ceil(at/FIVE)*FIVE+11*MIN+2_000);
 assert.equal(x.status,'OBSERVED');
 assert.equal(x.twoCandleConfirmation,false);
 const aggregate=summarizeEarlyOneMinuteStudies([x]);
 assert.equal(aggregate.readyForPromotion,false);
 assert.equal(aggregate.byKind.ONE_MINUTE_OPPOSES_FIVE.observed,1);
 assert.equal(aggregate.byKind.ONE_MINUTE_OPPOSES_FIVE.confirmedPct,null);
});
