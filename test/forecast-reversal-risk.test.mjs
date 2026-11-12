import test from 'node:test';
import assert from 'node:assert/strict';
import {assessForecastReversalRisk,REVERSAL_PROTOCOL}
 from '../lib/forecast-reversal-risk.mjs';
import {assessForecastStrengthRisk} from '../lib/forecast-strength-risk.mjs';
import {forecastDeliveryDecision,forecastShortPreMove}
 from '../lib/forecast-arrival-safeguard.mjs';
import {marketForecastProfile,profileSymbols} from '../lib/market-forecast-profiles.mjs';
const MIN=60000, FIVE=300000, T=Date.UTC(2026,10,12,13,10);
function rows({rebound=false,gap=false}={}){
 const one=Array.from({length:26},(_,i)=>{
  const close=100-i*.08+(rebound&&i>=23?(i-22)*.24:0);
  return {close,open:close+.04,closeTime:T-(25-i)*MIN};
 });
 if(gap)one[8].closeTime+=1000;
 const five=Array.from({length:16},(_,i)=>{
  const close=101-i*.12;
  return {close,open:close+.20,closeTime:T-(15-i)*FIVE};
 });
 if(rebound)five[15]={...five[15],open:98.0,close:98.6};
 return {one,five};
}
function snap(one,five,side='SHORT_BIAS'){
 return {available:true,combinedDirection:side,alignment:'THREE_TIMEFRAME_ALIGNMENT',
  timeframes:[1,5,10].map((intervalMinutes,i)=>({
   intervalMinutes,direction:side,closedAt:i===0?T:T-(i===1?0:0),
   price:i===0?one.at(-1).close:100,atr14:i===0?.15:.7,
   rsi14:44,voteAgreement:3,relativeVolume:1.5,
   bollinger20:{position:'LOWER_HALF'}})),
  primaryContext:{structure:'LOWER_HIGHS_LOW',observedSupport:90}};
}
test('5m reversal after sustained 1m fall suppresses STRONG SHORT even if EMA/RSI vote agrees',()=>{
 const {one,five}=rows({rebound:true}),d=snap(one,five);
 const risk=assessForecastReversalRisk(d,one,five,'CSCOUSDT');
 assert.equal(risk.sampleReady,true);
 assert.equal(risk.risk,'HIGH');
 assert.equal(risk.highRisk,true);
 assert.equal(risk.group,'EQUITY_DERIVED');
 const result={...d,reversalRisk:risk,strongV2Review:{sampleReady:true,
  status:'REVIEW_KEEP_STRONG',baselineLevel:'STRONG'},
  arrivalTiming:{sampleReady:true,lateRisk:false}};
 assert.equal(assessForecastStrengthRisk(result).level,'CAUTION');
 assert.equal(forecastDeliveryDecision(result).status,'SUPPRESS_REVERSAL');
});
test('continuous 1m downtrend and aligned completed 5m candle are not mistaken for reversal',()=>{
 const {one,five}=rows(),d=snap(one,five);
 const risk=assessForecastReversalRisk(d,one,five,'1000PEPEUSDT');
 assert.equal(risk.risk,'CLEAR');
 assert.equal(risk.highRisk,false);
 assert.equal(risk.fiveMinuteBodyAtr>0,true);
 const strong=assessForecastStrengthRisk({...d,reversalRisk:risk});
 assert.equal(strong.level,'STRONG');
});
test('weak closed 5m directional body cannot earn STRONG just from aligned oscillators',()=>{
 const {one,five}=rows(),d=snap(one,five);
 five[15]={...five[15],open:five[15].close+.02};
 const risk=assessForecastReversalRisk(d,one,five,'XAUUSDT');
 assert.equal(risk.sampleReady,true);
 assert.equal(risk.risk,'CLEAR');
 assert.equal(assessForecastStrengthRisk({...d,reversalRisk:risk}).level,'STANDARD');
});
test('opposite 5m candle warns CAUTION without pretending a 1m signal is a confirmed entry',()=>{
 const {one,five}=rows(),d=snap(one,five);
 five[15]={...five[15],open:five[15].close-.35};
 const risk=assessForecastReversalRisk(d,one,five,'EURUSDT');
 assert.equal(risk.risk,'ELEVATED');
 assert.equal(risk.highRisk,false);
 const quality=assessForecastStrengthRisk({...d,reversalRisk:risk});
 assert.equal(quality.level,'CAUTION');
 assert.ok(quality.reasons.includes('OPPOSITE_5M_CANDLE'));
});
test('gaps, future 5m candles and wrong close produce UNKNOWN rather than a false confirmation',()=>{
 const {one,five}=rows({rebound:true});
 const d=snap(one,five);
 assert.equal(assessForecastReversalRisk(d,rows({gap:true}).one,five).sampleReady,false);
 assert.equal(assessForecastReversalRisk(d,one,
  five.map((b,i)=>i===15?{...b,closeTime:b.closeTime+FIVE}:b)).sampleReady,false);
 assert.equal(assessForecastReversalRisk({...d,timeframes:[
  {...d.timeframes[0],price:80},...d.timeframes.slice(1)]},one,five).sampleReady,false);
});
test('all 32 instruments remain categorized, no orders or new WEEX calls',()=>{
 assert.equal(profileSymbols().length,32);
 for(const symbol of profileSymbols())assert.ok(marketForecastProfile(symbol));
 assert.equal(REVERSAL_PROTOCOL.extraWEEXQueries,0);
 assert.equal(REVERSAL_PROTOCOL.noOrders,true);
});
test('market-specific 1m/3m timing rules cannot loosen original 10bps chase defense',()=>{
 const close=Date.UTC(2026,10,12,13,10);
 let p=100;
 const bars=Array.from({length:125},(_,i)=>{
  if(i>0)p*=1+(i%2?0.0003:-0.0003);
  return {close:p,closeTime:close-(124-i)*MIN};
 });
 // Directional +15bps after quiet 60m -> HIGH-volatility meme profile
 // must still suppress any >10bps already-travelled 1m move.
 bars[124].close=bars[123].close*1.0015;
 const d={combinedDirection:'LONG_BIAS',timeframes:[{
  closedAt:close,price:bars[124].close}]};
 const m=forecastShortPreMove(d,bars,'1000PEPEUSDT');
 assert.equal(m.sampleReady,true);
 assert.equal(m.adaptiveReady,true);
 assert.equal(m.legacyLateRisk,true);
 assert.equal(m.lateRisk,true);
});
