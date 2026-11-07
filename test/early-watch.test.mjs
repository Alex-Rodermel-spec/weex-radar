import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {closed,scanEarly}=(await import('../lib/early-watch.mjs'))._test;
const MS=60_000,MS15=900_000;
function candles(count,step,now,drift=0.01){
 const lastStart=Math.floor((now-2000)/step)*step-step;
 return Array.from({length:count},(_,i)=>{
  const base=100+i*drift,t=lastStart-(count-1-i)*step;
  return [t,base,base+0.15,base-0.15,base+0.01,100];
 });
}
test('one-minute feed only accepts completed sorted candles',()=>{
 const now=Date.now(),rows=candles(125,MS,now);
 const parsed=closed([...rows].reverse(),MS,now);
 assert.equal(parsed.length,125);
 assert.ok(parsed.at(-1).closeTime<now);
 assert.ok(parsed[0].time<parsed.at(-1).time);
 assert.equal(closed([...rows,[Math.floor(now/MS)*MS,100,101,99,100,100]],MS,now).length,125);
});
test('rejects invalid or stale WEEX one-minute candles',()=>{
 const now=Date.now(),rows=candles(125,MS,now);
 assert.throws(()=>closed(rows.map(r=>[r[0]-86400000,...r.slice(1)]),MS,now),/Stale/);
 assert.throws(()=>closed(rows.slice(0,20),MS,now),/Too few/);
});
test('no breakout stays WAIT and is not a trade recommendation',()=>{
 const now=Date.now();
 const one=closed(candles(125,MS,now),MS,now);
 const fifteen=closed(candles(125,MS15,now),MS15,now);
 const watch=scanEarly(one,fifteen,now);
 assert.equal(watch.level,'WAIT');
 assert.equal(watch.direction,null);
 assert.equal(watch.expiresAt,null);
});
test('one-minute signal expires after one minute, regardless of historical candle',()=>{
 const now=Date.now(),one=closed(candles(125,MS,now),MS,now),fifteen=closed(candles(125,MS15,now),MS15,now);
 const watch=scanEarly(one,fifteen,one.at(-1).closeTime+61_000);
 assert.equal(watch.direction,null);
 assert.match(watch.reason,/устарел/);
});
test('early-watch source is read-only and independent from trading and push dispatch',()=>{
 const source=readFileSync(new URL('../lib/early-watch.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\/capi\/v3\/order|trade-confirm|trade-prepare|push-dispatch|webpush|secrets/);
 assert.match(source,/WEEX.*1m|fetchCandles\(symbol,'1m'\)/);
 assert.match(source,/fetchCurrentQuote\(symbol,'WEEX'\)/);
 assert.match(source,/level='EARLY_WATCH'/);
 assert.match(source,/direction:null/);
});

test('existing signals serverless route handles early mode without extra function',()=>{
 const code=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const chart=readFileSync(new URL('../tradingview.html',import.meta.url),'utf8');
 assert.match(code,/req\.query\?\.mode==='early'/);
 assert.match(code,/import\('\.\.\/lib\/early-watch\.mjs'\)/);
 assert.match(chart,/\/api\/signals\?mode=early&symbol=/);
});
