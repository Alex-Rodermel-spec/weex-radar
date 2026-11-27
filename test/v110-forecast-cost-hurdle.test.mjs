import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FORECAST_COST_HURDLE,evaluateV110ForecastCostHurdle}
 from '../lib/v110-forecast-cost-hurdle.mjs';

const MIN=60_000,now=Date.UTC(2026,10,27,12,0);
const make=(n,move,overrides={})=>({
 id:n.toString(16).padStart(32,'0'),
 symbol:'BTCUSDT',direction:'LONG',strength:'STANDARD',
 sentAt:now-60*MIN,
 windows:{
  5:{status:'OBSERVED',moveBps:move},
  15:{status:'OBSERVED',moveBps:move}
 },...overrides
});
test('optimistic hurdle uses configured taker/slippage rates on BOTH sides',()=>{
 assert.equal(FORECAST_COST_HURDLE.feeBpsEachSide,8);
 assert.equal(FORECAST_COST_HURDLE.slippageBpsEachSide,3);
 assert.equal(FORECAST_COST_HURDLE.modeledRoundTripBps,22);
 assert.equal(FORECAST_COST_HURDLE.spreadBpsIncluded,0);
 assert.equal(FORECAST_COST_HURDLE.referencePriceIsExecutable,false);
});
test('5m and 15m require closed, matured observations and keep unknowns separate',()=>{
 const rows=Array.from({length:20},(_,i)=>make(i+1,i===0?30:10,{
   symbol:i%2?'ETHUSDT':'BTCUSDT',
   sentAt:now-(60-i)*MIN
 }));
 const result=evaluateV110ForecastCostHurdle(rows,now);
 const five=result.all.horizons[5];
 assert.equal(result.validUnique,20);
 assert.equal(five.observed,20);
 assert.equal(five.aboveHurdleCloseCount,1);
 assert.equal(five.aboveHurdleClosePct,5);
 assert.equal(five.meanSignedCloseMoveBps,11);
 assert.equal(five.meanZeroSpreadBenchmarkBps,-11);
 assert.equal(result.notRealizedPnl,true);
 assert.equal(result.live108Changed,false);
});
test('missing, immature, duplicated and invalid outcomes never become fabricated losses',()=>{
 const rows=Array.from({length:20},(_,i)=>make(i+1,25,{
  symbol:['BTCUSDT','ETHUSDT'][i%2],
  sentAt:now-(25+i)*MIN
 }));
 rows.push({...make(21,99),windows:{5:{status:'NO_DATA'},15:{status:'PENDING'}}});
 rows.push({...make(22,99),sentAt:now-4*MIN});
 rows.push({...make(1,-100),symbol:'BTCUSDT'});
 rows.push(make(23,99,{symbol:'BAD<TOKEN>'}));
 const a=evaluateV110ForecastCostHurdle(rows,now);
 assert.equal(a.duplicateIds,1);
 assert.equal(a.invalidRows,1);
 assert.equal(a.validUnique,22);
 const h=a.all.horizons[5];
 assert.equal(h.matured,21);
 assert.equal(h.immature,1);
 assert.equal(h.observed,20);
 assert.equal(h.noData,1);
 assert.equal(h.aboveHurdleCloseCount,20);
 assert.equal(a.all.horizons[15].pending,1);
 assert.ok(a.sameSymbolSpaced30m.publishedAlerts<a.all.publishedAlerts);
});
test('separate LONG/SHORT and strength cohorts never imply independent backtest',()=>{
 const rows=[
  ...Array.from({length:20},(_,i)=>make(i+1,30,{symbol:'BTCUSDT',strength:'STRONG'})),
  ...Array.from({length:20},(_,i)=>make(i+21,-30,{symbol:'ETHUSDT',direction:'SHORT',strength:'CAUTION'}))
 ];
 const s=evaluateV110ForecastCostHurdle(rows,now);
 assert.equal(s.byDirection.LONG.horizons[5].aboveHurdleClosePct,100);
 assert.equal(s.byDirection.SHORT.horizons[5].aboveHurdleClosePct,0);
 assert.equal(s.byStrength.STRONG.publishedAlerts,20);
 assert.equal(s.byStrength.CAUTION.publishedAlerts,20);
 assert.equal(s.independentValidation,false);
 assert.match(s.warning,/ZERO spread/);
});
test('live code cannot import cost study into signal/push/trading routes',()=>{
 const api=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const paper=readFileSync(new URL('../api/paper-trading.mjs',import.meta.url),'utf8');
 const dispatch=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const route=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
 for(const code of [api,paper,dispatch])
  assert.doesNotMatch(code,/v110-forecast-cost-hurdle/);
 assert.match(route,/forecastCostHurdle:/);
});
