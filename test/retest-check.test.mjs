import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {evaluateRetest,evaluateRetestBoth,MIN_BREAKOUT_VOLUME,
 TOUCH_TOLERANCE_ATR} from '../lib/retest-check.mjs';
import {_test as scanner} from '../api/signals.mjs';

function fixture(direction='LONG',mode='CONFIRMED'){
 const long=direction==='LONG';
 const arr=Array.from({length:64},(_,i)=>({
  time:1_000_000+i*300_000,closeTime:1_000_000+(i+1)*300_000,
  open:100,high:100.12,low:99.88,close:100,volume:100
 }));
 const b=arr[60];
 if(long){
  Object.assign(b,{open:100.02,high:100.28,low:100.00,close:100.22,volume:170});
 }else{
  Object.assign(b,{open:99.98,high:100.00,low:99.72,close:99.78,volume:170});
 }
 for(const i of [61,62]){
  Object.assign(arr[i],long?{open:100.20,high:100.26,low:100.18,close:100.21}:
   {open:99.80,high:99.82,low:99.74,close:99.79});
 }
 const last=arr[63];
 Object.assign(last,long?{open:100.19,high:100.25,low:100.14,close:100.22}:
  {open:99.80,high:99.86,low:99.71,close:99.78});
 if(mode==='FAILED'){
  Object.assign(last,long?{open:100.16,high:100.21,low:100.03,close:100.06}:
   {open:99.84,high:99.98,low:99.78,close:99.94});
 }else if(mode==='TESTING'){
  Object.assign(last,long?{open:100.16,high:100.20,low:100.10,close:100.13}:
   {open:99.84,high:99.90,low:99.78,close:99.87});
 }else if(mode==='DEEP_WICK'){
  Object.assign(last,long?{open:100.18,high:100.27,low:100.01,close:100.22}:
   {open:99.83,high:99.99,low:99.70,close:99.78});
 }
 return arr;
}

test('5m breakout, later touch and hold are confirmed symmetrically for LONG and SHORT',()=>{
 for(const direction of ['LONG','SHORT']){
  const rows=fixture(direction);
  const res=evaluateRetest(rows,.25,direction);
  assert.equal(res.mode,'OBSERVE_5M');
  assert.equal(res.status,'CONFIRMED');
  assert.equal(res.direction,direction);
  assert.equal(res.level,direction==='LONG'?100.12:99.88);
  assert.equal(res.retestAt,rows.at(-1).closeTime);
  assert.equal(res.confirmedAt,rows.at(-1).closeTime);
  assert.equal(res.breakoutAt,rows[60].closeTime);
  assert.equal(res.ageBars,3);
  assert.equal(res.fresh,true);
  assert.ok(res.breakoutVolumeRatio>=MIN_BREAKOUT_VOLUME);
 }
});

test('breakout candle does NOT count as its own retest; no lookahead',()=>{
 for(const direction of ['LONG','SHORT']){
  const rows=fixture(direction);
  const onlyBreak=rows.slice(0,61);
  const res=evaluateRetest(onlyBreak,.25,direction);
  assert.equal(res.status,'WAITING');
  assert.equal(res.retestAt,null);
  assert.equal(res.confirmedAt,null);
  const before=rows.slice(0,60);
  assert.equal(evaluateRetest(before,.25,direction),null);
  assert.equal(evaluateRetest(rows.slice(0,63),.25,direction).status,'WAITING');
 }
});

test('failed retest, half-finished retest and dangerous deep wick are never counted as confirmed',()=>{
 for(const dir of ['LONG','SHORT']){
  for(const mode of ['FAILED','DEEP_WICK']){
   const res=evaluateRetest(fixture(dir,mode),.25,dir);
   assert.equal(res.status,'FAILED');
   assert.equal(res.confirmedAt,null);
   assert.equal(res.fresh,true);
   assert.ok(res.failedAt>res.breakoutAt);
  }
  const testing=evaluateRetest(fixture(dir,'TESTING'),.25,dir);
  assert.equal(testing.status,'TESTING');
  assert.equal(testing.confirmedAt,null);
  assert.ok(testing.retestAt>testing.breakoutAt);
 }
});

test('volume filter and candle validation stop invented confirmation',()=>{
 for(const dir of ['LONG','SHORT']){
  const weak=fixture(dir);
  weak[60].volume=100;
  assert.equal(evaluateRetest(weak,.25,dir),null);
  const missing=fixture(dir);delete missing[61].closeTime;
  assert.equal(evaluateRetest(missing,.25,dir),null);
  const invalid=fixture(dir);invalid[63].high=invalid[63].low-1;
  assert.equal(evaluateRetest(invalid,.25,dir),null);
 }
 assert.equal(evaluateRetest([],0.25,'LONG'),null);
 assert.equal(evaluateRetest(fixture('LONG'),NaN,'LONG'),null);
 assert.equal(evaluateRetest(fixture('LONG'),.25,'BUY'),null);
 assert.equal(TOUCH_TOLERANCE_ATR,0.18);
});

test('retest is from the same exchange and separately flags 15m trend alignment',()=>{
 const r=evaluateRetestBoth(fixture('LONG'),.25,'SHORT');
 assert.equal(r.LONG.status,'CONFIRMED');
 assert.equal(r.LONG.trendAligned,false);
 assert.equal(r.SHORT,null);
 const allowed=evaluateRetestBoth(fixture('LONG'),.25,'LONG');
 assert.equal(allowed.LONG.trendAligned,true);
});

test('5m scanner evaluates retest even when its existing LONG/SHORT breakout entry is WAIT',()=>{
 const five=fixture('LONG');
 const fifteen=Array.from({length:65},(_,i)=>({
  time:1_000_000+i*900_000,closeTime:1_000_000+(i+1)*900_000,
  open:100,high:100.12,low:99.88,close:100,volume:100
 }));
 const baseline=scanner.getAnalysis(five,fifteen,100.22);
 assert.ok(baseline.retest);
 assert.equal(baseline.retest.LONG.status,'CONFIRMED');
 assert.equal(baseline.direction,null);
});

test('existing 1m watch and 5m gating remain unchanged, retest is observation only',()=>{
 const signals=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const early=readFileSync(new URL('../lib/early-watch.mjs',import.meta.url),'utf8');
 const dispatcher=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const ntfy=readFileSync(new URL('../lib/ntfy-alerts.mjs',import.meta.url),'utf8');
 const site=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(signals,/evaluateRetestBoth\(five,volatility,aligned15\)/);
 assert.match(signals,/entryQuality\?\.ok&&\s*!sidewaysGate\?\.blocked\?candidate:null/);
 assert.doesNotMatch(signals,/retest\?\.|retest\.status.*\?candidate:null/);
 assert.doesNotMatch(dispatcher,/evaluateRetestBoth|retest-check/);
 assert.doesNotMatch(early,/evaluateRetestBoth|retest-check/);
 assert.match(ntfy,/5м РЕТЕСТ: ЕЩЁ НЕ ПОДТВЕРЖДЁН/);
 assert.match(site,/id="retest-container"/);
 const inline=site.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(inline);
 assert.doesNotThrow(()=>new Script(inline[1]));
 assert.doesNotMatch(signals,/\/capi\/v3\/order|trade-confirm/);
});
