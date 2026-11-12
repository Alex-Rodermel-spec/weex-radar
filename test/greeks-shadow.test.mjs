import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {
 selectAtmPair,greeksBase,readGreeksShadow,handleGreeksShadow
} from '../lib/greeks-shadow.mjs';

const now=Date.UTC(2026,10,12,2,32,0);
const expiry='27NOV26';
function chain(currency='BTC'){
 const price=currency==='BTC'?90000:3000;
 const list=[];
 for(const type of ['C','P']){
  list.push({instrument_name:currency+'-'+expiry+'-'+price+'-'+type,
   underlying_price:price,mark_iv:55,open_interest:40});
  list.push({instrument_name:currency+'-'+expiry+'-'+(price*1.3)+'-'+type,
   underlying_price:price,mark_iv:50,open_interest:60});
 }
 return list;
}
function optionTicker(instrument_name){
 const isCall=instrument_name.endsWith('-C');
 return {instrument_name,state:'open',timestamp:now-2000,
  underlying_price:instrument_name.startsWith('BTC')?90002:3000,
  mark_iv:54.5,open_interest:30,
  greeks:{delta:isCall?.52:-.48,gamma:.00001,vega:8,
   theta:-1.4,rho:isCall?2:-1.8}};
}
function response(){
 return {code:200,body:null,headers:{},
  setHeader(name,value){this.headers[name]=value;return this},
  status(code){this.code=code;return this},
  json(value){this.body=value;return this}};
}
function fakeFetcher(requests,alterTicker=x=>x){
 return async(url,options)=>{
  requests.push([String(url),options]);
  const path=new URL(url);
  if(path.pathname.endsWith('get_book_summary_by_currency')){
   const currency=path.searchParams.get('currency');
   return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({result:chain(currency)})};
  }
  assert.ok(path.pathname.endsWith('/ticker'));
  const ticker=alterTicker(optionTicker(path.searchParams.get('instrument_name')));
  return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({result:ticker})};
 };
}
test('selects matching listed, liquid near-ATM call+put without distant strikes',()=>{
 const pair=selectAtmPair(chain(), 'BTC',now);
 assert.ok(pair);
 assert.equal(pair.C.name,'BTC-27NOV26-90000-C');
 assert.equal(pair.P.name,'BTC-27NOV26-90000-P');
 assert.equal(pair.strike,90000);
 assert.equal(selectAtmPair(chain(), 'ETH',now),null);
 assert.equal(selectAtmPair(chain().filter(x=>x.instrument_name.endsWith('-C')),'BTC',now),null);
});
test('BTC and ETH return REAL per-contract option Greeks only from public Deribit',async()=>{
 for(const symbol of ['BTCUSDT','ETHUSDT']){
  const calls=[];
  const r=await readGreeksShadow(symbol,{now,fetchImpl:fakeFetcher(calls)});
  assert.equal(r.available,true);
  assert.equal(r.symbol,symbol);
  assert.equal(r.source,'DERIBIT_PUBLIC_OPTIONS');
  assert.equal(r.externalToWEEX,true);
  assert.equal(r.notTrade,true);
  assert.equal(r.affectsForecast,false);
  assert.equal(r.affectsNotifications,false);
  assert.equal(r.signalPermission,false);
  assert.equal(r.predictiveProbability,false);
  assert.equal(r.ordersSent,0);
  assert.equal(r.contracts.call.delta,.52);
  assert.equal(r.contracts.put.delta,-.48);
  assert.equal(r.contracts.call.theta,-1.4);
  assert.equal(r.contracts.call.optionType,'CALL');
  assert.equal(r.contracts.put.optionType,'PUT');
  assert.equal(calls.length,3);
  assert.ok(calls.every(([url,args])=>url.startsWith('https://www.deribit.com/api/v2/public/')&&
   args.cache==='no-store'&&url.includes('/public/')));
 }
});
test('unsupported 30 markets never borrow BTC/ETH Greeks or place orders',async()=>{
 const seen=[];
 const out=response();
 await handleGreeksShadow({method:'GET',query:{symbol:'XAUUSDT'}},out,
  {now,fetchImpl:async(...args)=>{seen.push(args);throw Error('should not call')}});
 assert.equal(out.code,200);
 assert.equal(out.body.available,false);
 assert.equal(out.body.externalToWEEX,true);
 assert.equal(out.body.ordersSent,0);
 assert.match(out.body.reason,/NO_VERIFIED/);
 assert.equal(seen.length,0);
 const bad=response();
 await handleGreeksShadow({method:'POST',query:{symbol:'BTCUSDT'}},bad,{now});
 assert.equal(bad.code,405);
 const invalid=response();
 await handleGreeksShadow({method:'GET',query:{symbol:'../oops'}},invalid,{now});
 assert.equal(invalid.code,400);
});
test('stale/invalid or internally inconsistent option Greeks fail closed',async()=>{
 const outdated=x=>({...x,timestamp:now-600_000});
 await assert.rejects(readGreeksShadow('BTCUSDT',{now,fetchImpl:fakeFetcher([],outdated)}),
  /NO_FRESH_MATCHED_OPTION_QUOTES/);
 const badGreeks=x=>({...x,greeks:{...x.greeks,gamma:-100}});
 await assert.rejects(readGreeksShadow('BTCUSDT',{now,fetchImpl:fakeFetcher([],badGreeks)}),
  /NO_FRESH_MATCHED_OPTION_QUOTES/);
 const responseObj=response();
 await handleGreeksShadow({method:'GET',query:{symbol:'BTCUSDT'}},responseObj,{
  now,fetchImpl:async()=>({ok:false})
 });
 assert.equal(responseObj.code,503);
 assert.equal(responseObj.body.available,false);
 assert.equal(responseObj.body.ordersSent,0);
});
test('Greeks Lab remains manual and separate from 32-market WEEX signals, cron and ntfy',()=>{
 const module=readFileSync(new URL('../lib/greeks-shadow.mjs',import.meta.url),'utf8');
 const api=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const forecast=readFileSync(new URL('../forecast.html',import.meta.url),'utf8');
 assert.match(api,/mode==='greeks'/);
 assert.match(api,/return handleGreeksShadow\(req,res\)/);
 assert.match(api,/return handleStandaloneForecast\(req,res,FORECAST_SYMBOLS\)/);
 assert.match(forecast,/id="greeks-load"/);
 assert.match(forecast,/mode=greeks&symbol=/);
 assert.match(forecast,/V3 PASS\/SKIP/);
 const script=forecast.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
 assert.ok(!module.includes('api-contract.weex.com'));
 for(const banned of [/trade-prepare/,/trade-confirm/,/placeOrder/,/WEEX_API_SECRET/,
  /NTFY_TOPIC/,/ntfySend/,/cronSchedule/,/setLeverage/])
  assert.doesNotMatch(module,banned);
 const base=greeksBase('ETHUSDT');
 assert.equal(base.notTrade,true);
 assert.equal(base.affectsForecast,false);
});
