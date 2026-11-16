import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {preBreakCandidate,forecastPreBreak,PREBREAK_CONTEXT_GUARD} from '../lib/forecast-watch.mjs';
import {formatPhoneAlert} from '../lib/alert-presentation.mjs';
import {_test as ntfy} from '../lib/ntfy-alerts.mjs';
const MINUTE=60000;
const now=Date.UTC(2026,10,8,20,40,30);
const lastClose=(step)=>Math.floor(now/step)*step;
function candles(step,drift,amp,freq,phase,up,down,finalPrice=null){
 const raw=Array.from({length:125},(_,i)=>100+i*drift+amp*Math.sin(i*freq+phase));
 const adjust=finalPrice===null?0:finalPrice-raw.at(-1);
 return raw.map((x,i)=>{
  const close=x+adjust;
  const open=step===MINUTE?close-0.025:close;
  return {time:lastClose(step)-(125-i)*step,
   closeTime:lastClose(step)-(124-i)*step,
   close,open,high:Math.max(open,close)+up,
   low:Math.min(open,close)-down,volume:100};
 });
}
const one=candles(MINUTE,0.006,0.04,0.5,0,0.055,0.075);
const five=candles(MINUTE*5,0.015,0.08,0.5,5.25,0.10,0.10,one.at(-1).close);
const fifteen=candles(MINUTE*15,0.03,0.025,0.4,0,0.10,0.10,one.at(-1).close);
test('pre-break forecast is an actual future conditional level, not a signal after a drop',()=>{
 const pre=preBreakCandidate(one,fifteen,now);
 assert.ok(pre,'positive trend scenario should be detected BEFORE breakout');
 assert.equal(pre.direction,'LONG');
 assert.ok(pre.barrier>one.at(-1).close);
 const forecast=forecastPreBreak(one,five,fifteen,one.at(-1).close,now);
 assert.ok(forecast,'all three closed timeframes should support conditional scenario');
 assert.equal(forecast.mode,'PRE_BREAK_SCENARIO');
 assert.equal(forecast.direction,'LONG');
 assert.ok(forecast.triggerPrice>one.at(-1).close);
 assert.ok(forecast.invalidationPrice<one.at(-1).close);
 assert.equal(forecast.scoreIsCalibratedProbability,false);
 assert.equal(forecast.horizonMinutes,5);
});
test('no forecast without fresh same-exchange quote or after already reaching breakout',()=>{
 const pre=preBreakCandidate(one,fifteen,now);
 assert.ok(pre);
 assert.equal(forecastPreBreak(one,five,fifteen,null,now),null);
 assert.equal(forecastPreBreak(one,five,fifteen,pre.barrier+pre.atr1,now),null);
 assert.equal(forecastPreBreak(one,five,fifteen,one.at(-1).close+2*pre.atr1,now),null);
 assert.equal(preBreakCandidate(one,fifteen,now+50000),null);
 assert.equal(preBreakCandidate([...one,{...one.at(-1),closeTime:now+1000}],fifteen,now),null);
});
test('five-minute disagreement cancels forecast instead of inventing a reversal',()=>{
 const falling=five.map((c,i)=>({...c,
  close:c.close-i*0.05,open:c.open-i*0.05,
  high:c.high-i*0.05,low:c.low-i*0.05}));
 assert.equal(forecastPreBreak(one,falling,fifteen,one.at(-1).close,now),null);
});
test('phone notification explicitly says FORECAST, direction, confirm, invalidate; no order TP/SL',()=>{
 const forecast=forecastPreBreak(one,five,fifteen,one.at(-1).close,now);
 assert.ok(forecast);
 const s={symbol:'BTCUSDT',exchange:'WEEX',direction:'LONG',level:'EARLY_WATCH',
  watchType:'PRE_BREAK',forecast,livePrice:one.at(-1).close};
 const msg=formatPhoneAlert(s,{early:true,deadline:'20:41'});
 assert.match(msg.title,/🔮 ПРОГНОЗ.*LONG/);
 assert.match(msg.message,/Возможный РОСТ/);
 assert.match(msg.message,/Подтверждение: выше/);
 assert.match(msg.message,/Отмена сценария: ниже/);
 assert.match(msg.message,/НЕ ВХОДИ/);
 assert.doesNotMatch(msg.message,/Прибыль \(TP\)|Стоп \(SL\)|R\/R|✅ Прибыль/);
});
test('repeat forecast dedupes by symbol + direction in ten-minute buckets',()=>{
 const x={exchange:'WEEX',symbol:'BTCUSDT',direction:'LONG',
  watchType:'PRE_BREAK',candleCloseTime:600000*10000+60000};
 assert.equal(ntfy.sequenceForSignal('early',x),
  ntfy.sequenceForSignal('early',{...x,candleCloseTime:x.candleCloseTime+60000}));
 assert.notEqual(ntfy.sequenceForSignal('early',x),
  ntfy.sequenceForSignal('early',{...x,candleCloseTime:x.candleCloseTime+600000}));
 assert.notEqual(ntfy.sequenceForSignal('early',x),
  ntfy.sequenceForSignal('early',{...x,watchType:undefined}));
});
test('forecast uses closed 1m/5m/15m only; original breakout strategy is not changed',()=>{
 const forecastSource=readFileSync(new URL('../lib/forecast-watch.mjs',import.meta.url),'utf8');
 const earlySource=readFileSync(new URL('../lib/early-watch.mjs',import.meta.url),'utf8');
 const dispatch=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const ntfySource=readFileSync(new URL('../lib/ntfy-alerts.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(forecastSource,/fetch\(|\/capi\/v3\/order|trade-confirm|trade-prepare|process\.env/);
 assert.match(forecastSource,/evaluateStructure\(five,atr5/);
 assert.match(forecastSource,/evaluateRetestBoth\(five,atr5/);
 assert.match(earlySource,/preBreakCandidate\(one,fifteen,now\)/);
 assert.match(earlySource,/forecastPreBreak\(one,five,fifteen,quote\.price,Date\.now\(\)\)/);
 assert.match(earlySource,/fetchCandles\(symbol,'5m'\)/);
 assert.match(dispatch,/ntfySend\('confirmed',signals\)/);
 assert.match(ntfySource,/candidates\.filter\(s=>s\.watchType==='PRE_BREAK'\)\.slice\(0,2\)/);
});

test('new 1m/5m/15m freshness guard rejects stale trend and missing close, never reads future',()=>{
 const fresh=forecastPreBreak(one,five,fifteen,one.at(-1).close,now);
 assert.ok(fresh,'fixture must otherwise qualify');
 assert.equal(PREBREAK_CONTEXT_GUARD.strictLatestClosed15m,true);
 assert.equal(PREBREAK_CONTEXT_GUARD.strictLatestClosed5m,true);
 assert.equal(PREBREAK_CONTEXT_GUARD.lastConsecutiveCandles,50);
 assert.equal(preBreakCandidate(one,fifteen.slice(0,-1),now),null,'stale 15m may mislead');
 assert.equal(forecastPreBreak(one,five.slice(0,-1),fifteen,one.at(-1).close,now),null,
  'stale 5m may contradict currently forming trend');
 assert.equal(preBreakCandidate(one.slice(0,-1),fifteen,now),null,'old 1m source rejected');
 const gapped15=[...fifteen.slice(0,-6),...fifteen.slice(-5)];
 assert.equal(preBreakCandidate(one,gapped15,now),null,'missing latest 15m series candle');
 const gapped5=[...five.slice(0,-7),...five.slice(-6)];
 assert.equal(forecastPreBreak(one,gapped5,fifteen,one.at(-1).close,now),null,
  'missing latest 5m series candle');
 const future5=five.map((c,i)=>i===five.length-1?{...c,closeTime:c.closeTime+300000}:c);
 assert.equal(forecastPreBreak(one,future5,fifteen,one.at(-1).close,now),null);
});
test('PRE_BREAK LONG does not issue alert when latest fully closed 5m candle strongly reverses DOWN',()=>{
 const original=forecastPreBreak(one,five,fifteen,one.at(-1).close,now);
 assert.equal(original?.direction,'LONG');
 const last=five.at(-1),opposingOpen=last.close+0.75;
 const oppositeFive=[...five.slice(0,-1),{
  ...last,open:opposingOpen,high:Math.max(last.high,opposingOpen+0.05),
  low:Math.min(last.low,last.close-0.03)
 }];
 assert.equal(forecastPreBreak(one,oppositeFive,fifteen,one.at(-1).close,now),null,
  'reversal candle must override still-positive lagging EMA');
});
test('PRE_BREAK SHORT obeys symmetric opposite-green 5m guard',()=>{
 const mirror=rows=>rows.map(c=>({
  ...c,open:200-c.open,close:200-c.close,
  high:200-c.low,low:200-c.high
 }));
 const short1=mirror(one),short5=mirror(five),short15=mirror(fifteen);
 const original=forecastPreBreak(short1,short5,short15,short1.at(-1).close,now);
 assert.equal(original?.direction,'SHORT');
 const last=short5.at(-1),opposingOpen=last.close-0.75;
 const oppositeFive=[...short5.slice(0,-1),{
  ...last,open:opposingOpen,low:Math.min(last.low,opposingOpen-0.05),
  high:Math.max(last.high,last.close+0.03)
 }];
 assert.equal(forecastPreBreak(short1,oppositeFive,short15,short1.at(-1).close,now),null);
});
test('strict gate is read-only and preserves 5m confirmed + ntfy routes',()=>{
 const source=readFileSync(new URL('../lib/forecast-watch.mjs',import.meta.url),'utf8');
 const dispatcher=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 assert.match(source,/currentClosedContext\(one,1,now\)/);
 assert.match(source,/currentClosedContext\(five,5,now\)/);
 assert.match(source,/currentClosedContext\(fifteen,15,now\)/);
 assert.match(source,/opposingBody>=PREBREAK_CONTEXT_GUARD\.opposing5mBodyAtr\*atr5/);
 assert.doesNotMatch(source,/placeOrder\(|trade-confirm|\/capi\/v3\/order|fetch\(|process\.env/);
 assert.match(dispatcher,/ntfySend\('confirmed',signals\)/);
 assert.equal(PREBREAK_CONTEXT_GUARD.noOrders,true);
 assert.equal(PREBREAK_CONTEXT_GUARD.unvalidatedAccuracyImpact,true);
});
