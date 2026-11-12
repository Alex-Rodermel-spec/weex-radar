import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastShortPreMove,forecastDeliveryDecision,FORECAST_ARRIVAL_POLICY}
 from '../lib/forecast-arrival-safeguard.mjs';
import {runForecastNotifications,forecastTopic}
 from '../lib/forecast-ntfy.mjs';
import {buildStandaloneForecast,completedForecastBars}
 from '../lib/standalone-forecast.mjs';
const MIN=60000, FIVE=300000;
const now=Date.UTC(2026,10,12,11,0,30);
const t=Math.floor(now/MIN)*MIN;
const down={combinedDirection:'SHORT_BIAS',timeframes:[{
 closedAt:t,price:99.7}]};
const up={combinedDirection:'LONG_BIAS',timeframes:[{
 closedAt:t,price:100.3}]};
function bars(prices=[100.1,100.0,99.8,99.7]){
 return prices.map((close,i)=>({close,closeTime:t-(3-i)*MIN}));
}
test('uses ONLY four completed consecutive 1m bars, direction-aware LONG/SHORT',()=>{
 const short=forecastShortPreMove(down,bars());
 assert.equal(short.sampleReady,true);
 assert.equal(short.lateRisk,true);
 assert.ok(short.preMove3mBps>10);
 assert.equal(short.tradeSignal,false);
 const long=forecastShortPreMove(up,bars([100,100.1,100.2,100.3]));
 assert.equal(long.sampleReady,true);
 assert.equal(long.lateRisk,true);
 assert.ok(long.preMove3mBps>10);
 const early=forecastShortPreMove(
  {...down,timeframes:[{closedAt:t,price:100}]},
  bars([100,100.04,99.99,100]));
 assert.equal(early.sampleReady,true);
 assert.equal(early.lateRisk,false);
 assert.equal(FORECAST_ARRIVAL_POLICY.maxExtraQueries,0);
});
test('missing/gapped/future/mismatched bars are UNKNOWN not safely early',()=>{
 const source=bars();
 assert.equal(forecastShortPreMove(down,source.slice(1)).sampleReady,false);
 assert.equal(forecastShortPreMove(down,source.map((x,i)=>
  i===1?{...x,closeTime:x.closeTime+1000}:x)).sampleReady,false);
 assert.equal(forecastShortPreMove(down,source.map((x,i)=>
  i===3?{...x,closeTime:x.closeTime+MIN}:x)).sampleReady,false);
 assert.equal(forecastShortPreMove(down,bars([100,100,100,100])).sampleReady,false);
 assert.equal(forecastShortPreMove({...down,timeframes:[{closedAt:t,price:99.7}]},
   bars([99.7,99.7,99.7,99.7])).lateRisk,false);
});
test('never use future outcomes; both V2-extended and 3m price-extension suppress slots',()=>{
 const clean={strongV2Review:{sampleReady:true,status:'REVIEW_KEEP_STRONG',baselineLevel:'STRONG'},
  arrivalTiming:{sampleReady:true,lateRisk:false},windows:{5:{status:'OBSERVED',moveBps:-30}}};
 const late={...clean,arrivalTiming:{sampleReady:true,lateRisk:true},
  windows:{5:{status:'OBSERVED',moveBps:30}}};
 assert.deepEqual(forecastDeliveryDecision(clean),{
  status:'CANDIDATE',reason:'NO_DETECTED_CHASE'});
 assert.equal(forecastDeliveryDecision(late).status,'SUPPRESS_LATE');
 assert.equal(forecastDeliveryDecision({...clean,strongV2Review:{
  sampleReady:true,status:'REVIEW_DOWNGRADE',baselineLevel:'STRONG'}}).status,'SUPPRESS_LATE');
 assert.equal(forecastDeliveryDecision({
  ...clean,arrivalTiming:{sampleReady:false,lateRisk:false}}).status,'UNKNOWN');
});
function forecast(symbol,timing,revision={sampleReady:true,status:'REVIEW_KEEP_STRONG',
 baselineLevel:'STRONG'},t=now){
 const closed=Math.floor(t/MIN)*MIN;
 const side='SHORT_BIAS';
 const timeframes=[1,5,10].map((v,i)=>({
  intervalMinutes:v,closedAt:closed-(i?5*MIN:0),
  direction:side,relativeVolume:1.5,rsi14:45,atr14:1,price:100,
  voteAgreement:3,bollinger20:{position:'LOWER_HALF'}}));
 return {mode:'STANDALONE_WEEX_FORECAST_1_5_10',symbol,
  exchange:'WEEX',available:true,notTrade:true,ordersSent:0,signalPermission:false,
  alignment:'THREE_TIMEFRAME_ALIGNMENT',combinedDirection:side,timeframes,
  primaryContext:{structure:'LOWER_HIGHS_LOW'},
  arrivalTiming:timing,strongV2Review:revision};
}
test('production-like ntfy sends non-late candidate instead of late STRONG, at same cadence and cap',async()=>{
 const env={NTFY_TOPIC:'wr-'+('c'.repeat(32))};
 const events=[];
 const pub=async(topic,msg)=>{events.push({topic,...msg});return true};
 const early={sampleReady:true,lateRisk:false};
 const late={sampleReady:true,lateRisk:true};
 const sources={
  BTCUSDT:forecast('BTCUSDT',late),
  ETHUSDT:forecast('ETHUSDT',early),
  XRPUSDT:forecast('XRPUSDT',late),
  SOLUSDT:forecast('SOLUSDT',early)
 };
 const result=await runForecastNotifications({env,now,clock:()=>now,
  symbols:Object.keys(sources),reader:async symbol=>sources[symbol],
  fetchImpl:async()=>({ok:true,text:async()=>''}),publish:pub});
 const messages=events.filter(x=>x.topic===forecastTopic(env));
 assert.equal(result.scanned,4);
 assert.equal(result.eligible,4);
 assert.equal(result.lateSuppressed,2);
 assert.equal(result.delivered,2);
 assert.deepEqual(messages.map(x=>x.title.split(' · ')[1]),[
  'ETHUSDT SHORT','SOLUSDT SHORT']);
 assert.ok(messages.every(x=>x.title.includes('СИЛЬНЫЙ ПРОГНОЗ')));
 assert.ok(messages.every(x=>x.message.includes('НЕ сигнал входа')));
 assert.equal(result.ordersSent,0);
 assert.equal(result.notATrade,true);
});
test('V2 LATE suppressed even if all 3 timeframes and momentum otherwise look STRONG',async()=>{
 const env={NTFY_TOPIC:'wr-'+('d'.repeat(32))};const messages=[];
 const snap=forecast('BTCUSDT',{sampleReady:true,lateRisk:false},{
  sampleReady:true,status:'REVIEW_DOWNGRADE',baselineLevel:'STRONG',
  proposedLevel:'STANDARD'});
 const r=await runForecastNotifications({env,now,clock:()=>now,
  symbols:['BTCUSDT'],reader:async()=>snap,
  fetchImpl:async()=>({ok:true,text:async()=>''}),
  publish:async(topic,msg)=>{messages.push({topic,...msg})}});
 assert.equal(r.eligible,1);
 assert.equal(r.lateSuppressed,1);
 assert.equal(r.delivered,0);
 assert.equal(messages.filter(x=>x.topic===forecastTopic(env)).length,0);
});
test('closed WEEX forecast build includes real fast timing assessment with zero extra requests',()=>{
 const make=(dur,step)=>{
  const close=Math.floor(now/dur)*dur;
  return Array.from({length:125},(_,i)=>{
   const p=100+step*i;
   return [close-(125-i)*dur,p,p+0.05,p-0.05,p,100+i%7];
  });
 };
 const one=completedForecastBars(make(MIN,0.08),MIN,now);
 const five=completedForecastBars(make(FIVE,0.08),FIVE,now);
 const b=buildStandaloneForecast(one,five,now);
 assert.equal(b.available,true);
 assert.equal(b.arrivalTiming?.sampleReady,true);
 assert.equal(b.arrivalTiming?.mode,'FORECAST_PRE_ALERT_1M_3M');
 assert.equal(b.arrivalTiming?.lateRisk,true);
 assert.equal(b.ordersSent,0);
});
