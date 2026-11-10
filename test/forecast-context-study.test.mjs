import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {forecastContextStudy} from '../lib/forecast-context-study.mjs';
import {formatPhoneAlert} from '../lib/alert-presentation.mjs';
const M=300000,base=Date.UTC(2026,10,9,10,0);
function samples(drift=0.025){
 return Array.from({length:60},(_,i)=>{
  const close=100+i*drift;
  return {time:base+i*M,closeTime:base+(i+1)*M,
   open:close-0.05,close,high:close+0.1,low:close-0.12,volume:100};
 });
}
const clock=base+61*M;
test('completed candle context reports structure and never changes forecast eligibility',()=>{
 const up=forecastContextStudy(samples(),{
  direction:'LONG',referencePrice:101.5,atr5:0.3,now:clock
 });
 assert.equal(up.available,true);
 assert.equal(up.structure.trend,'UP');
 assert.equal(up.structure.alignment,'ALIGNED');
 assert.equal(up.blocksTrade,false);
 assert.equal(up.changesForecastEligibility,false);
 assert.equal(up.liquidity.orderBookChecked,false);
 assert.equal(up.liquidity.actualStopsKnown,false);
 const short=forecastContextStudy(samples(),{
  direction:'SHORT',referencePrice:101.5,atr5:0.3,now:clock
 });
 assert.equal(short.structure.alignment,'OPPOSING');
});
test('hypothetical order block needs closed displacement after opposite candle',()=>{
 const arr=samples(0);
 const make=(i,open,close,high,low)=>({
  ...arr[i],open,close,high,low
 });
 arr[49]=make(49,100,99.7,100.05,99.65);
 arr[50]=make(50,99.7,100.85,100.9,99.65);
 for(let i=51;i<60;i++)arr[i]=make(i,100.8,100.85,100.93,100.76);
 const context=forecastContextStudy(arr,{
  direction:'LONG',referencePrice:100.85,atr5:0.5,now:clock
 });
 assert.equal(context.available,true);
 assert.ok(context.orderBlock);
 assert.equal(context.orderBlock.kind,'BULLISH_CANDLE_PROXY');
 assert.equal(context.orderBlock.sourceCloseTime,arr[49].closeTime);
 assert.equal(context.orderBlock.displacementConfirmedAt,arr[50].closeTime);
 assert.equal(context.orderBlock.verifiedOrders,false);
 // A completed candle through the proxy invalidates the previously seen zone.
 arr[56]=make(56,100.7,99.4,100.8,99.35);
 assert.equal(forecastContextStudy(arr,{
  direction:'LONG',referencePrice:100.85,atr5:0.5,now:clock
 }).orderBlock,null);
});
test('close times, continuity and stale data prevent fabricated structure',()=>{
 const bars=samples();
 assert.equal(forecastContextStudy(bars,{
  direction:'LONG',referencePrice:101,atr5:.3,now:bars.at(-1).closeTime
 }).available,false);
 assert.equal(forecastContextStudy(bars.slice(0,39),{
  direction:'LONG',referencePrice:101,atr5:.3,now:clock
 }).available,false);
 assert.equal(forecastContextStudy(bars.map((x,i)=>i===30?{...x,time:x.time+M}:x),{
  direction:'LONG',referencePrice:101,atr5:.3,now:clock
 }).available,false);
});
test('forecast context is presented only as a hypothesis, never as a signal',()=>{
 const context=forecastContextStudy(samples(),{
  direction:'LONG',referencePrice:101.5,atr5:0.3,now:clock
 });
 const f={mode:'PRE_BREAK_SCENARIO',rsi1:52,rsi5:58,volumeRatio:1.3,
  triggerPrice:102,invalidationPrice:100,horizonMinutes:5,contextStudy:context};
 const msg=formatPhoneAlert({
  symbol:'XRPUSDT',direction:'LONG',watchType:'PRE_BREAK',forecast:f,
  livePrice:101.5
 },{early:true});
 assert.match(msg.message,/ТЕСТ · структура 5М/);
 assert.match(msg.message,/Только прогноз, не разрешение на сделку/);
 assert.doesNotMatch(msg.message,/🟢 ВХОД|📊 Расчётный R\/R/);
});
test('context module cannot fetch an order book, send orders or change alerts',()=>{
 const src=readFileSync(new URL('../lib/forecast-context-study.mjs',import.meta.url),'utf8');
 for(const forbidden of [/fetch\(/,/ntfy/,/WEEX_API/,/trade-confirm/,/trade-prepare/,/placeOrder/,/process\.env/])
  assert.doesNotMatch(src,forbidden);
});
