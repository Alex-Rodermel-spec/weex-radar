import test from 'node:test';
import assert from 'node:assert/strict';
const {normalizeRows,rsi,ema,atr,getAnalysis}=(await import('../api/signals.mjs'))._test;
const step=300000;
function sample(count=125,period=step){
 const end=Math.floor((Date.now()-1000)/period)*period-period;
 return Array.from({length:count},(_,i)=>{
  const t=end-(count-1-i)*period,p=100+i*.18;
  return [t,String(p),String(p+.12),String(p-.12),String(p+.07),'100'];
 });
}
test('closed candles sorted',()=>{const x=normalizeRows(sample().reverse(),'5m');assert.equal(x.length,125);assert.ok(x[0].time<x.at(-1).time)});
test('unclosed candle excluded',()=>{const a=sample();a.push([Math.floor(Date.now()/step)*step,'123','124','122','123','200']);assert.equal(normalizeRows(a,'5m').length,125)});
test('indicators valid',()=>{const bars=normalizeRows(sample(),'5m');assert.ok(Number.isFinite(rsi(bars.map(x=>x.close))));assert.ok(Number.isFinite(ema(bars.map(x=>x.close),50)));assert.ok(Number.isFinite(atr(bars)))});
test('no breakout means WAIT',()=>{const five=normalizeRows(sample(),'5m'),fifteen=normalizeRows(sample(125,900000),'15m');assert.equal(getAnalysis(five,fifteen).level,'WAIT')});
test('stale candles rejected',()=>{const a=sample().map(r=>[r[0]-86400000,...r.slice(1)]);assert.throws(()=>normalizeRows(a,'5m'),/Stale/)});
