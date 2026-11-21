import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rankForecastV4,FORECAST_V4_RANKING_POLICY as p} from '../lib/forecast-v4-ranking.mjs';
import {forecastMessage} from '../lib/forecast-ntfy.mjs';

const time=Date.UTC(2026,10,21,10,0,0);
function fixture(body='DOWN',withEvidence=true){
 return {available:true,combinedDirection:'SHORT_BIAS',
  alignment:'THREE_TIMEFRAME_ALIGNMENT',
  timeframes:[1,5,10].map((minute,i)=>({
   intervalMinutes:minute,direction:'SHORT_BIAS',
   closedAt:time-(i?5*60000:0),
   price:100,relativeVolume:1.45,atr14:1,rsi14:40,
   voteAgreement:2,
   lastCandleBody:i===1?body:'DOWN',
   bollinger20:{position:'LOWER_HALF'}
  })),
  primaryContext:{structure:'LOWER_HIGHS_LOW'},
  arrivalTiming:{sampleReady:withEvidence,lateRisk:false},
  strongV2Review:{sampleReady:withEvidence,status:'REVIEW_KEEP_STANDARD'},
  reversalRisk:{sampleReady:withEvidence,risk:'CLEAR',highRisk:false}
 };
}
test('5m closed directional body outranks opposing 5m body, not future price',()=>{
 const yes=rankForecastV4(fixture('DOWN'));
 const no=rankForecastV4(fixture('UP'));
 assert.ok(yes.score>no.score);
 assert.equal(yes.notTrade,true);
 assert.equal(yes.validatedAccuracyGain,false);
 assert.equal(rankForecastV4({...fixture('DOWN'),windows:{5:{status:'OBSERVED',moveBps:-999}}}).score,yes.score);
});
test('missing evidence never awarded false confidence',()=>{
 const clear=rankForecastV4(fixture('DOWN',true));
 const unknown=rankForecastV4(fixture('DOWN',false));
 assert.ok(clear.score>unknown.score);
 assert.equal(rankForecastV4({combinedDirection:'MIXED'}).status,'UNVERIFIED');
});
test('forecast remains read-only 5m hypothesis and tells the truth about correlated 10m',()=>{
 const f=fixture();
 const msg=forecastMessage({...f,symbol:'BTCUSDT'});
 assert.match(msg.message,/10М построен из 5М/);
 assert.match(msg.message,/Горизонт 5 минут/);
 assert.match(msg.message,/НЕ сигнал входа/);
 const code=readFileSync(new URL('../lib/forecast-ntfy.mjs',import.meta.url),'utf8');
 assert.match(code,/rankForecastV4\(b\)\.score/);
 for(const unsafe of [/weex\.placeOrder/,/capi\/v3\/order/,/WEEX_API_SECRET/,/trade-confirm/]){
  assert.doesNotMatch(code,unsafe);
 }
 assert.equal(p.maxForecastNtfyPerBucket,2);
 assert.equal(p.newMarketRequests,0);
 assert.equal(p.validatedAccuracyGain,false);
});
