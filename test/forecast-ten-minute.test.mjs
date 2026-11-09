import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateTenMinuteCandles,tenMinuteForecastContext}
 from '../lib/forecast-ten-minute.mjs';
const FIVE=300000,TEN=600000;
const base=Date.UTC(2026,10,9,0,0,0);
function candles(count=124){
 return Array.from({length:count},(_,i)=>{
  const time=base+i*FIVE,price=100+i*0.01;
  return {time,closeTime:time+FIVE,open:price,close:price+0.005,
   high:price+0.02,low:price-0.02,volume:100+i%4};
 });
}
test('pairs only complete UTC-aligned closed 5m candles into 10m OHLCV',()=>{
 const five=candles(124),ten=aggregateTenMinuteCandles(five,base+124*FIVE);
 assert.equal(ten.length,62);
 assert.equal(ten[0].time,base);assert.equal(ten[0].closeTime,base+TEN);
 assert.equal(ten[0].open,five[0].open);
 assert.equal(ten[0].close,five[1].close);
 assert.equal(ten[0].high,Math.max(five[0].high,five[1].high));
 assert.equal(ten[0].low,Math.min(five[0].low,five[1].low));
 assert.equal(ten[0].volume,five[0].volume+five[1].volume);
});
test('never invents a 10m candle from partial, missing or future 5m bars',()=>{
 const five=candles(125),now=base+124*FIVE;
 assert.equal(aggregateTenMinuteCandles(five,now).length,62);
 const missing=five.filter((_,i)=>i!==25);
 const ten=aggregateTenMinuteCandles(missing,base+125*FIVE);
 assert.equal(ten.length,61);
 assert.ok(!ten.some(x=>x.time===base+24*FIVE));
 assert.equal(tenMinuteForecastContext(candles(60),base+60*FIVE),null);
});
test('10m RSI14/BB20-2/volume make observation, never create trading instructions',()=>{
 const five=candles(124),now=base+124*FIVE+30000;
 const context=tenMinuteForecastContext(five,now);
 assert.equal(context.intervalMinutes,10);
 assert.ok(context.rsi14>=0&&context.rsi14<=100);
 assert.equal(context.bollinger10.period,20);
 assert.equal(context.bollinger10.deviation,2);
 assert.ok(['ALIGNED','MIXED'].includes(context.agreement));
 assert.equal(context.observationOnly,true);
 for(const field of ['direction','enter','stop','take','order','confidenceProbability'])
  assert.equal(Object.hasOwn(context,field),false);
 assert.equal(tenMinuteForecastContext(five,now+12*60000),null);
});
