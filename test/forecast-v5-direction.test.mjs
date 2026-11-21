import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {evaluateForecastV5,FORECAST_V5_POLICY} from '../lib/forecast-v5-direction.mjs';
import {completedForecastBars,buildStandaloneForecast} from '../lib/standalone-forecast.mjs';
const MIN=60_000,FIVE=5*MIN,at=Date.UTC(2026,10,21,10,42,30);
function raw(step,slope=0.012,noise=0.12){
 const end=Math.floor(at/step)*step;
 return Array.from({length:125},(_,i)=>{
  const price=100+(i-124)*slope+noise*(Math.sin(i*1.7)-Math.sin(124*1.7));
  return [end-(125-i)*step,price-0.01,price+0.09,price-0.09,price,100+i%4];
 });
}
function fixture(){
 return {one:completedForecastBars(raw(MIN,0.012,0.045),MIN,at),
  five:completedForecastBars(raw(FIVE,0.05,0.18),FIVE,at)};
}
test('independent V5 computes a closed candle 5m opinion, no live trading or probability claim',()=>{
 const {one,five}=fixture();
 const v=evaluateForecastV5(one,five,at);
 assert.equal(v.available,true);
 assert.equal(v.mode,'V5_5M_DIRECTION_RESEARCH');
 assert.ok(['MIXED','LONG_BIAS','SHORT_BIAS'].includes(v.direction));
 assert.equal(v.ordersSent,0);
 assert.equal(v.signalPermission,false);
 assert.equal(v.confidenceIsCalibrated,false);
 assert.equal(v.accuracyImprovedNotYetProven,true);
 assert.equal(v.evidence.no10mDoubleCount,true);
 assert.equal(FORECAST_V5_POLICY.liveNotificationsChanged,false);
 const d=buildStandaloneForecast(one,five,at,'BTCUSDT');
 assert.equal(d.available,true);
 assert.equal(d.forecastV5.direction,v.direction);
 assert.equal(d.combinedDirection,d.timeframes.every(f=>f.direction==='LONG_BIAS')?
  'LONG_BIAS':d.timeframes.every(f=>f.direction==='SHORT_BIAS')?'SHORT_BIAS':'MIXED');
});
test('missing, gapped, unfinished and stale 5m bars fail closed',()=>{
 const {one,five}=fixture();
 assert.equal(evaluateForecastV5(one.slice(-40),five,at).available,false);
 assert.equal(evaluateForecastV5(one,five.slice(-40),at).available,false);
 assert.equal(evaluateForecastV5(one,five.filter((b,i)=>i!==60),at).available,false);
 assert.equal(evaluateForecastV5(one,five,at+15*MIN).available,false);
 // Candles published AFTER the decision timestamp may not enter the model.
 assert.equal(evaluateForecastV5([...one,{...one.at(-1),closeTime:at+MIN}],five,at).available,false);
});
test('long linear exhausted RSI does NOT turn into a blind high-confidence buy',()=>{
 const one=completedForecastBars(raw(MIN,0.07,0),MIN,at);
 const five=completedForecastBars(raw(FIVE,0.35,0),FIVE,at);
 const v=evaluateForecastV5(one,five,at);
 assert.equal(v.available,true);
 assert.equal(v.direction,'MIXED');
 assert.equal(v.ordersSent,0);
});
test('same 1m/5m history remains unchanged regardless of any future outcome field',()=>{
 const {one,five}=fixture();
 const original=evaluateForecastV5(one,five,at);
 const other=evaluateForecastV5(one.map(x=>({...x,futureFiveMinuteWin:true})),
  five.map(x=>({...x,futureFiveMinuteReturnBps:-900})),at);
 assert.deepEqual(other,original);
});
test('dashboard exposes V5 independent read-only column without modifying ntfy',()=>{
 const page=readFileSync(new URL('../forecast.html',import.meta.url),'utf8');
 const script=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
 assert.match(page,/🧪 V5 · 5М/);
 assert.match(page,/forecastV5/);
 const ntfy=readFileSync(new URL('../lib/forecast-ntfy.mjs',import.meta.url),'utf8');
 // V5 is now copied to the existing receipt at send time solely for
 // observational validation. Direction/eligibility and slots remain V4.
 assert.match(ntfy,/const side=d.combinedDirection==='LONG_BIAS'/);
 assert.match(ntfy,/rankForecastV4\(b\)\.score/);
 assert.match(ntfy,/🧪 V5: /);
 assert.doesNotMatch(ntfy,/d\.combinedDirection\s*=\s*d\.forecastV5/);
 assert.equal(FORECAST_V5_POLICY.marketRequestsAdded,0);
});
