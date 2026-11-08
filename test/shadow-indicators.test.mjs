import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {adx,rollingVwap,shadowIndicators} from '../lib/shadow-indicators.mjs';
const MIN=300000;
function sample(delta=0.25,vol=100){
 return Array.from({length:80},(_,i)=>{
  const close=100+i*delta;
  return {time:i*MIN,closeTime:(i+1)*MIN,open:close-delta,
   high:close+0.5,low:close-0.5,close,volume:vol};
 });
}
test('Wilder ADX observes a strongly directional sequence without forecasting',()=>{
 const up=adx(sample());
 assert.ok(up.adx>=99.9);
 assert.ok(up.plusDI>0);
 assert.equal(up.minusDI,0);
 const down=adx(sample(-0.25));
 assert.ok(down.adx>=99.9);
 assert.ok(down.minusDI>0);
 assert.equal(down.plusDI,0);
});
test('flat candles have no directional movement; zero volumes cancel VWAP',()=>{
 const flat=sample(0);
 const result=adx(flat);
 assert.equal(result.adx,0);
 assert.equal(result.plusDI,0);
 assert.equal(result.minusDI,0);
 assert.equal(rollingVwap(sample(0.2,0)),null);
 assert.equal(shadowIndicators(sample(0.2,0)).available,false);
});
test('rolling VWAP uses typical price and candle volume of last 20 only',()=>{
 const bars=sample(0);
 bars[79]={...bars[79],high:105,low:95,close:100,volume:900};
 const expected=(19*100*100+900*100)/(1900+900);
 assert.ok(Math.abs(rollingVwap(bars)-expected)<1e-9);
 assert.equal(shadowIndicators(bars).mode,'SHADOW_INDICATORS');
 assert.equal(shadowIndicators(bars).timeframe,'5m');
 assert.equal(shadowIndicators(bars).available,true);
});
test('invalid bars and insufficient data cannot produce reassuring fake indicator values',()=>{
 assert.equal(adx([]),null);
 assert.equal(adx(sample().slice(0,25)),null);
 assert.equal(rollingVwap(sample().slice(0,10)),null);
 const corrupted=sample();corrupted[42].high=corrupted[42].low-1;
 assert.equal(shadowIndicators(corrupted).available,false);
});
test('supplementary indicator values are read only and never affect trade eligibility',()=>{
 const scanner=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const shadow=readFileSync(new URL('../lib/shadow-indicators.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(scanner,/const contextOnly=shadowIndicators\(five\)/);
 assert.match(scanner,/shadowIndicators:contextOnly/);
 assert.match(scanner,/const tentative=candidate&&quality\.ok&&priceQuality\.ok&&entryQuality\?\.ok&&/);
 assert.doesNotMatch(shadow,/fetch\(|process\.env|\/capi\/v3\/order|trade-confirm|placeOrder/);
 assert.match(ui,/не влияет на сигналы/);
 const script=ui.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
});
