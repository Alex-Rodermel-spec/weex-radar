import test from 'node:test';
import assert from 'node:assert/strict';
import {assessForecastFilterOverlap,FILTER_ABLATION_POLICY}
 from '../lib/forecast-filter-ablation.mjs';
function frame(intervalMinutes,emaSide=1,rsi=60,price=102){
 return {intervalMinutes,direction:emaSide>0?'LONG_BIAS':'SHORT_BIAS',
  price,ema20:emaSide>0?100:104,ema50:emaSide>0?99:105,
  rsi14:rsi,bollinger20:{middle:100,position:'UPPER_HALF'},voteAgreement:3};
}
function input(frames,combinedDirection='LONG_BIAS'){
 return {available:true,symbol:'XAUUSDT',combinedDirection,
  timeframes:frames,arrivalTiming:{lateRisk:false},
  strongV2Review:{status:'REVIEW_KEEP_STRONG'}};
}
test('SHADOW: regular 3-frame agreement and early 5m agree on an uptrend',()=>{
 const d=input([frame(1),frame(5),frame(10)]);
 const original=JSON.stringify(d);
 const out=assessForecastFilterOverlap(d);
 assert.equal(out.available,true);
 assert.equal(out.assetGroup,'METALS');
 assert.equal(out.decisions.emaRsi,'LONG_BIAS');
 assert.equal(out.decisions.emaBollinger,'LONG_BIAS');
 assert.equal(out.decisions.fiveMinutePriority,'LONG_BIAS');
 assert.equal(out.liveVsShadowsDisagree,false);
 assert.equal(JSON.stringify(d),original);
 assert.equal(out.ordersSent,0);
 assert.equal(out.tradeSignal,false);
});
test('SHADOW: 5m-first sees watch scenario before completed 10m EMA agrees',()=>{
 const d=input([frame(1),frame(5),frame(10,-1,42,98)],'MIXED');
 const out=assessForecastFilterOverlap(d);
 assert.equal(out.decisions.emaRsi,'MIXED');
 assert.equal(out.decisions.fiveMinutePriority,'LONG_BIAS');
 assert.equal(out.liveVsShadowsDisagree,true);
 assert.equal(out.validatedWinRate,false);
});
test('SHADOW: RSI near exhaustion can be correlated with existing caution and hard veto',()=>{
 const d=input([frame(1,1,81),frame(5,1,70),frame(10,1,65)]);
 const out=assessForecastFilterOverlap(d);
 assert.equal(out.overlap.extremeRsiUsedByDirectionAndRisk,true);
 assert.equal(out.overlap.oneMinuteRsiHardVetoAlsoWarned,true);
 assert.equal(out.overlap.tenMinuteDerivedFromFiveMinute,true);
});
test('SHADOW: existing late checks may overlap; must not change their decisions',()=>{
 const d=input([frame(1),frame(5),frame(10)]);
 d.arrivalTiming.lateRisk=true;
 d.strongV2Review.status='REVIEW_DOWNGRADE';
 const out=assessForecastFilterOverlap(d);
 assert.equal(out.overlap.duplicatedLateReason,true);
 assert.equal(d.arrivalTiming.lateRisk,true);
 assert.equal(d.strongV2Review.status,'REVIEW_DOWNGRADE');
});
test('SHADOW: incomplete or nonfinite input is an unknown audit and no invented signal',()=>{
 const d=input([frame(1),frame(5)]);
 assert.equal(assessForecastFilterOverlap(d).available,false);
 const d2=input([frame(1),frame(5),frame(10)]);
 d2.timeframes[2].ema20=NaN;
 assert.equal(assessForecastFilterOverlap(d2).available,false);
 assert.equal(FILTER_ABLATION_POLICY.newRequests,0);
 assert.equal(FILTER_ABLATION_POLICY.signalChanges,0);
});
