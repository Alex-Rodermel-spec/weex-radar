import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {assessForecastStrengthRisk,FORECAST_RISK_LABELS,
 FORECAST_RISK_REASONS} from '../lib/forecast-strength-risk.mjs';
import {forecastMessage} from '../lib/forecast-ntfy.mjs';

function sample({side='SHORT_BIAS',rsi1=40.7,rsi5=43,rsi10=40.5,
 volume=1.55,bb='LOWER_HALF',structure='LOWER_HIGHS_LOW',
 votes=3,support=91,atr=0.14,price=100}={}){
 return {symbol:'LINKUSDT',mode:'STANDALONE_WEEX_FORECAST_1_5_10',
 available:true,exchange:'WEEX',notTrade:true,ordersSent:0,
 signalPermission:false,alignment:'THREE_TIMEFRAME_ALIGNMENT',
 combinedDirection:side,
 timeframes:[1,5,10].map((t,i)=>({
  intervalMinutes:t,direction:side,closedAt:1000,price,
  rsi14:[rsi1,rsi5,rsi10][i],relativeVolume:i?1.1:volume,
  atr14:atr,voteAgreement:votes,trend:side==='SHORT_BIAS'?'DOWN':'UP',
  bollinger20:{position:bb}
 })),
 primaryContext:{structure,observedSupport:support,observedResistance:110}
 };
}
test('strong requires agreement, volume, correct structure, no late-entry risk',()=>{
 const q=assessForecastStrengthRisk(sample());
 assert.equal(q.level,'STRONG');
 assert.equal(q.risk,'NORMAL');
 assert.deepEqual(q.reasons,[]);
 assert.equal(q.tradeSignal,false);
 assert.equal(q.calibratedProbability,false);
 assert.equal(FORECAST_RISK_LABELS[q.level],'🟣 СИЛЬНЫЙ ПРОГНОЗ');
 const m=forecastMessage(sample());
 assert.match(m.title,/СИЛЬНЫЙ ПРОГНОЗ/);
 assert.match(m.message,/не гарантия/);
 assert.match(m.message,/НЕ сигнал входа/);
});
test('LINK 11:50 screenshot RSI 5m 25.8, 10m 24.3 is elevated risk',()=>{
 const d=sample({rsi1:40.7,rsi5:25.8,rsi10:24.3,
  volume:.98,price:10.43,support:9.8,atr:.06});
 const q=assessForecastStrengthRisk(d);
 assert.equal(q.level,'CAUTION');
 assert.equal(q.risk,'ELEVATED');
 assert.ok(q.reasons.includes('OVERSOLD_5M'));
 assert.ok(q.reasons.includes('OVERSOLD_10M'));
 assert.match(FORECAST_RISK_REASONS.OVERSOLD_10M,/отскока/);
 const m=forecastMessage(d);
 assert.match(m.title,/ПОВЫШЕННЫЙ РИСК/);
 assert.match(m.message,/RSI 5М перепродан/);
 assert.match(m.message,/RSI 10М перепродан/);
});
test('LONG overbought 5m/10m and top Bollinger position warn on pullback',()=>{
 const d=sample({side:'LONG_BIAS',rsi1:62,rsi5:77,rsi10:73,
  bb:'ABOVE_UPPER',structure:'HIGHER_HIGHS_LOW'});
 const q=assessForecastStrengthRisk(d);
 assert.equal(q.level,'CAUTION');
 assert.ok(q.reasons.includes('OVERBOUGHT_5M'));
 assert.ok(q.reasons.includes('OVERBOUGHT_10M'));
 assert.ok(q.reasons.includes('ABOVE_UPPER_BOLLINGER'));
 assert.match(forecastMessage(d).message,/риск отката/);
});
test('weak volume and nearby price obstacle warn instead of saying strong',()=>{
 const d=sample({volume:.79,price:100,support:99.96,atr:.14});
 const q=assessForecastStrengthRisk(d);
 assert.equal(q.level,'CAUTION');
 assert.ok(q.reasons.includes('WEAK_1M_VOLUME'));
 assert.ok(q.reasons.includes('SUPPORT_NEAR_PRICE'));
});
test('standard forecasts remain uncalibrated, mismatch cannot be strong',()=>{
 const d=sample({volume:1.0});
 const standard=assessForecastStrengthRisk(d);
 assert.equal(standard.level,'STANDARD');
 const mismatch=assessForecastStrengthRisk({...d,combinedDirection:'MIXED'});
 assert.equal(mismatch.level,'UNAVAILABLE');
 assert.equal(mismatch.risk,'UNKNOWN');
 assert.equal(mismatch.tradeSignal,false);
});
test('web dashboard shows risk and strong labels without placing trades',()=>{
 const page=readFileSync(new URL('../forecast.html',import.meta.url),'utf8');
 const backend=readFileSync(new URL('../lib/standalone-forecast.mjs',import.meta.url),'utf8');
 const app=readFileSync(new URL('../lib/forecast-ntfy.mjs',import.meta.url),'utf8');
 assert.match(page,/Оценка силы \/ риска/);
 assert.match(page,/ПОВЫШЕННЫЙ РИСК|Повышенный риск/);
 assert.match(page,/Сильный \(эвристика/);
 assert.match(page,/forecastStrengthAndRisk:d.strengthRisk/);
 assert.match(backend,/strengthRisk:assessForecastStrengthRisk\(forecast\)/);
 assert.match(app,/const quality=assessForecastStrengthRisk\(d\)/);
 const script=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
});
