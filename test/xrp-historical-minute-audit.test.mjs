import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleXrpHistoricalMinuteAudit} from '../lib/xrp-historical-minute-audit.mjs';

const START=Date.UTC(2026,10,8,0,0),MINUTE=60_000;
function mkRes(){
 return {headers:{},statusCode:200,result:null,
  setHeader(k,v){this.headers[k]=v;return this},
  status(n){this.statusCode=n;return this},
  json(v){this.result=v;return this}};
}
function page(url){
 const q=new URL(url).searchParams;
 assert.equal(q.get('symbol'),'XRPUSDT');
 assert.equal(q.get('interval'),'1m');
 assert.equal(q.get('priceType'),'LAST');
 assert.equal(q.get('limit'),'100');
 const start=Number(q.get('startTime')),end=Number(q.get('endTime'));
 assert.ok(start>=START&&start<START+600*MINUTE);
 assert.equal(end-start,99*MINUTE);
 return Array.from({length:100},(_,i)=>{
  const n=(start-START)/MINUTE+i;
  const close=100+.27*Math.sin(n/6)+.08*Math.sin(n/17);
  const open=100+.27*Math.sin((n-1)/6)+.08*Math.sin((n-1)/17);
  return [start+i*MINUTE,String(open),
   String(Math.max(close,open)+.04),String(Math.min(close,open)-.04),
   String(close),String(75+n%30),start+(i+1)*MINUTE];
 });
}
test('fixed XRP historical reader only downloads six bounded pages and computes 5m shadow scores',async()=>{
 const prior=globalThis.fetch,calls=[];
 globalThis.fetch=async url=>{
  calls.push(url);
  return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify(page(url))};
 };
 const res=mkRes();
 try{
  await handleXrpHistoricalMinuteAudit({method:'GET',query:{symbol:'XRPUSDT',history:'1'}},res);
  assert.equal(res.statusCode,200,JSON.stringify(res.result));
  assert.equal(calls.length,6);
  assert.equal(res.result.mode,'HISTORICAL_XRP_SHADOW');
  assert.equal(res.result.symbol,'XRPUSDT');
  assert.equal(res.result.bars,600);
  assert.equal(res.result.gaps,0);
  assert.equal(res.result.ordersSent,0);
  assert.equal(res.result.tradeReady,false);
  assert.equal(res.result.changesLiveSignals,false);
  for(const id of ['breakout5m','breakoutCautious5m','reentry5m','reentryCautious5m']){
   const x=res.result.strategies[id];
   assert.equal(x.tradeReady,false);
   assert.equal(x.changesLiveSignals,false);
   assert.equal(x.assumedRoundTripCostsBps,22);
   assert.equal(x.horizonMinutes,5);
   assert.ok(x.researchGate);
  }
 }finally{globalThis.fetch=prior}
});
test('historical reader fails closed on wrong market and out-of-range history',async()=>{
 const invalid=mkRes();
 await handleXrpHistoricalMinuteAudit({method:'GET',query:{symbol:'BTCUSDT',history:'1'}},invalid);
 assert.equal(invalid.statusCode,400);
 const prior=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,headers:{get:()=>null},text:async()=>JSON.stringify([
  [Date.UTC(2026,10,9),100,101,99,100,10]
 ])});
 try{
  const bad=mkRes();
  await handleXrpHistoricalMinuteAudit({method:'GET',query:{symbol:'XRPUSDT',history:'1'}},bad);
  assert.equal(bad.statusCode,503);
  assert.match(bad.result.error,/unavailable/);
 }finally{globalThis.fetch=prior}
});
test('fixed historical audit has no secret, order, account or push access',()=>{
 const code=readFileSync(new URL('../lib/xrp-historical-minute-audit.mjs',import.meta.url),'utf8');
 for(const re of [/process\.env/,/placeOrder/,/trade-confirm/,/trade-prepare/,
  /ntfySend/,/cron-key/,/api-key/i,/Bearer /i]){
  assert.doesNotMatch(code,re);
 }
});
