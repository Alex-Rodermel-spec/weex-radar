import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {researchRegime} from '../lib/market-regime-research.mjs';
const MIN=60000,start=Date.UTC(2026,10,10,0,0);
function candles(fn,length=80){
 return Array.from({length},(_,i)=>{
  const close=fn(i),prev=i>0?fn(i-1):close;
  return {time:start+i*MIN,closeTime:start+(i+1)*MIN,
   open:prev,close,high:Math.max(prev,close)+0.02,
   low:Math.min(prev,close)-0.02,volume:100};
 });
}
test('trend, momentum and RSI use closed, chronological OHLCV without suggesting an order',()=>{
 const rows=candles(i=>100+0.06*i);
 const r=researchRegime(rows);
 assert.equal(r.available,true);
 assert.equal(r.trend,'UP');
 assert.ok(r.rsi14>70);
 assert.ok(r.atr14Bps>0);
 assert.equal(r.notATrade,true);
 assert.equal(r.tradeReady,false);
 assert.ok(r.fiveMinuteChangeBps>0);
 assert.equal(r.momentumWatch,true);
 assert.ok(r.tags.includes('FIVE_MINUTE_MOMENTUM'));
 assert.equal(r.mode,'RESEARCH_MARKET_REGIME');
 assert.ok(r.bbWidthBps>=0);
});
test('flat market is cost-pressured and RSI 50, never a profitable trade claim',()=>{
 const r=researchRegime(candles(()=>100));
 assert.equal(r.available,true);
 assert.equal(r.trend,'MIXED');
 assert.equal(r.rsi14,50);
 assert.equal(r.momentumWatch,false);
 assert.equal(r.costPressure,true);
 assert.ok(r.tags.includes('COST_PRESSURE'));
 assert.equal(r.tradeReady,false);
});
test('short, malformed or gapped bars fail closed',()=>{
 const rows=candles(i=>100+i*.02);
 assert.equal(researchRegime(rows.slice(0,50)).available,false);
 const gap=rows.filter((_,i)=>i!==69);
 assert.equal(researchRegime(gap).reason,'INVALID_OR_GAPPED_CANDLES');
 const future=rows.map(x=>({...x}));
 future.at(-1).close=NaN;
 assert.equal(researchRegime(future).available,false);
 assert.equal(researchRegime(rows,{modeledCostBps:0}).available,false);
});
test('regime study does not hold credentials or place orders',()=>{
 const src=readFileSync(new URL('../lib/market-regime-research.mjs',import.meta.url),'utf8');
 for(const re of [/process\.env/,/fetch\(/,/placeOrder/,/trade-confirm/,
 /Authorization:/i,/ntfySend/,/cron-key/])
  assert.doesNotMatch(src,re);
});
