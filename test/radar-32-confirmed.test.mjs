import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {_test as radar} from '../api/signals.mjs';

test('32 confirmed 5m/15m markets scan with at most 4 workers and no order endpoints',async()=>{
 const originalFetch=globalThis.fetch;
 const MIN=60_000;
 const rows=duration=>{
  const last=Math.floor((Date.now()-1000)/duration)*duration-duration;
  return Array.from({length:125},(_,i)=>{
   const price=100+Math.sin(i/7)*0.04;
   return [last-(124-i)*duration,price,price+.1,price-.1,price,100];
  });
 };
 const seen=[];let inFlight=0,peak=0;
 globalThis.fetch=async (url)=>{
  const address=String(url);seen.push(address);
  assert.match(address,/^https:\/\/api-contract\.weex\.com\/capi\/v3\/market\/klines\?/);
  inFlight++;peak=Math.max(peak,inFlight);
  await new Promise(resolve=>setTimeout(resolve,2));
  inFlight--;
  const interval=address.includes('interval=5m')?5*MIN:15*MIN;
  return {ok:true,json:async()=>rows(interval)};
 };
 try{
  const scanned=await radar.scanAll();
  assert.equal(scanned.length,32);
  assert.deepEqual(scanned.map(x=>x.symbol),radar.SYMBOLS);
  assert.ok(scanned.every(x=>x.status==='ok'&&x.exchange==='WEEX'));
  assert.equal(seen.length,64,'2 read-only candle fetches per market');
  assert.ok(peak<=8,'four workers x 2 parallel candle requests');
  assert.ok(seen.every(x=>!x.includes('/order')&&!x.includes('/account')));
 }finally{globalThis.fetch=originalFetch}
});

test('real orders remain limited to original 16 even after radar expansion',()=>{
 assert.equal(radar.SYMBOLS.length,32);
 assert.equal(radar.TRADE_SYMBOLS.length,16);
 for(const symbol of radar.FORECAST_SYMBOLS.slice(16)){
  assert.ok(radar.SYMBOLS.includes(symbol));
  assert.ok(!radar.TRADE_SYMBOLS.includes(symbol));
 }
 const confirm=readFileSync(new URL('../api/trade-confirm.mjs',import.meta.url),'utf8');
 const prepare=readFileSync(new URL('../api/trade-prepare.mjs',import.meta.url),'utf8');
 assert.match(confirm,/_test\.TRADE_SYMBOLS\.includes\(plan\.symbol\)/);
 assert.match(prepare,/_test\.TRADE_SYMBOLS\.includes\(symbol\)/);
 const dashboard=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const health=readFileSync(new URL('../lib/health-route.mjs',import.meta.url),'utf8');
 const advisor=readFileSync(new URL('../advisor.html',import.meta.url),'utf8');
 assert.match(dashboard,/Рынок · 32 инструмента/);
 assert.match(health,/markets\.total===32/);
 assert.match(advisor,/data\.symbols\.length!==32/);
});
