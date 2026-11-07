import test from 'node:test';
import assert from 'node:assert/strict';
const {SYMBOLS,normalizeRows,rsi,ema,atr,getAnalysis,breakoutQuality,currentPriceQuality,fetchCurrentQuote}=(await import('../api/signals.mjs'))._test;
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

test('16 unique WEEX radar markets retain existing coins and add 5 established futures',()=>{
 assert.equal(SYMBOLS.length,16);
 assert.equal(new Set(SYMBOLS).size,16);
 for(const symbol of ['ZECUSDT','1000PEPEUSDT','HYPEUSDT','BNBUSDT','ADAUSDT','LINKUSDT','SUIUSDT','AVAXUSDT'])
   assert.ok(SYMBOLS.includes(symbol));
});

test('fresh quote blocks long/short after reversal and after chasing a spike',()=>{
 assert.equal(currentPriceQuality('LONG',100,0.2,99.8).ok,false);
 assert.equal(currentPriceQuality('LONG',100,0.2,100.5).ok,false);
 assert.equal(currentPriceQuality('LONG',100,0.2,100.04).ok,true);
 assert.equal(currentPriceQuality('SHORT',100,0.2,100.2).ok,false);
 assert.equal(currentPriceQuality('SHORT',100,0.2,99.6).ok,false);
 assert.equal(currentPriceQuality('SHORT',100,0.2,99.96).ok,true);
 assert.equal(currentPriceQuality('LONG',100,0.2,null).ok,false);
});
test('anti-chase rejects exhausted breakout and candle with late bearish wick',()=>{
 const good={open:100,close:100.18,high:100.22,low:99.95};
 assert.equal(breakoutQuality('LONG',good,100.1,99.8,100.02,0.2).ok,true);
 assert.equal(breakoutQuality('LONG',{...good,high:100.55},100.1,99.8,100.02,0.2).ok,false);
 assert.equal(breakoutQuality('LONG',{...good,close:100.45,high:100.46},100.1,99.8,100.02,0.2).ok,false);
});
test('WEEX and Bybit fresh futures quotes are validated independently',async()=>{
 const now=Date.now(),mock=payload=>async()=>({ok:true,json:async()=>payload});
 const weex=await fetchCurrentQuote('ALGOUSDT','WEEX',mock([{symbol:'ALGOUSDT',bidPrice:'0.09490',askPrice:'0.09492',time:now}]),now);
 assert.equal(weex.price,0.09491);
 const bybit=await fetchCurrentQuote('ALGOUSDT','Bybit',mock({retCode:0,time:now,result:{list:[{symbol:'ALGOUSDT',bid1Price:'0.09490',ask1Price:'0.09492'}]}}),now);
 assert.equal(bybit.price,0.09491);
 await assert.rejects(fetchCurrentQuote('ALGOUSDT','WEEX',mock([{symbol:'ALGOUSDT',bidPrice:'0.09490',askPrice:'0.09492',time:now-90000}]),now),/stale/);
 await assert.rejects(fetchCurrentQuote('ALGOUSDT','WEEX',mock([{symbol:'BTCUSDT',bidPrice:'0.09490',askPrice:'0.09492',time:now}]),now),/Invalid/);
 await assert.rejects(fetchCurrentQuote('ALGOUSDT','WEEX',mock([{symbol:'ALGOUSDT',bidPrice:'0.09490',askPrice:'0.09600',time:now}]),now),/wide-spread/);
});
