import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {completedForecastBars,forecastTenMinuteBars,buildStandaloneForecast,
 handleStandaloneForecast} from '../lib/standalone-forecast.mjs';
const MIN=60000,FIVE=5*MIN,TEN=10*MIN;
const now=Date.UTC(2026,10,10,9,42,30);
function raw(dur,trend=1,n=125){
 const end=Math.floor(now/dur)*dur;
 return Array.from({length:n},(_,i)=>{
  const price=trend>0?100+i*.08:140-i*.08;
  const open=price-trend*.025,close=price;
  return [end-(n-i)*dur,open,Math.max(open,close)+.04,
   Math.min(open,close)-.04,close,100+(i%7)];
 });
}
function response(){
 return {code:200,body:null,headers:{},
  setHeader(k,v){this.headers[k]=v;return this},
  status(code){this.code=code;return this},
  json(body){this.body=body;return this}};
}
test('forecasts on 1m 5m and completed 10m are independent, not orders',()=>{
 const one=completedForecastBars(raw(MIN),MIN,now);
 const five=completedForecastBars(raw(FIVE),FIVE,now);
 assert.equal(one.length,125);
 assert.equal(five.length,125);
 const ten=forecastTenMinuteBars(five,now);
 assert.equal(ten.length,62);
 assert.ok(ten.every(x=>x.time%TEN===0&&x.closeTime-x.time===TEN));
 const d=buildStandaloneForecast(one,five,now);
 assert.equal(d.available,true);
 assert.equal(d.mode,'STANDALONE_WEEX_FORECAST_1_5_10');
 assert.equal(d.notTrade,true);
 assert.equal(d.ordersSent,0);
 assert.equal(d.signalPermission,false);
 assert.deepEqual(d.timeframes.map(x=>x.intervalMinutes),[1,5,10]);
 assert.ok(d.timeframes.every(x=>x.direction==='LONG_BIAS'));
 assert.equal(d.combinedDirection,'LONG_BIAS');
 assert.equal(d.alignment,'THREE_TIMEFRAME_ALIGNMENT');
 assert.ok(d.timeframes[0].rsi14>70);
 assert.ok(d.timeframes.every(x=>x.bollinger20.upper>=x.bollinger20.lower));
 assert.equal(d.primaryContext.actualLiquidityUnknown,true);
 assert.equal(d.primaryContext.orderBookChecked,false);
});
test('downtrend independently yields SHORT bias; no trading levels',()=>{
 const d=buildStandaloneForecast(
  completedForecastBars(raw(MIN,-1),MIN,now),
  completedForecastBars(raw(FIVE,-1),FIVE,now),now);
 assert.equal(d.available,true);
 assert.deepEqual(d.timeframes.map(x=>x.direction),
  ['SHORT_BIAS','SHORT_BIAS','SHORT_BIAS']);
 assert.equal(d.combinedDirection,'SHORT_BIAS');
 assert.ok(!('stop' in d)&&!('take' in d)&&!('leverage' in d));
});
test('unfinished or gapped 1m/5m candles cannot be scored, no lookahead',()=>{
 const list=raw(MIN);
 list.push([Math.floor(now/MIN)*MIN,100,101,99,100.5,110]);
 const complete=completedForecastBars(list,MIN,now);
 assert.equal(complete.length,125);
 const withGap=raw(FIVE).filter((_,i)=>i!==15);
 assert.equal(completedForecastBars(withGap,FIVE,now).length,0);
 const one=completedForecastBars(raw(MIN),MIN,now);
 const five=completedForecastBars(raw(FIVE),FIVE,now);
 assert.equal(buildStandaloneForecast(one,five.slice(-45),now).available,false);
 const old=buildStandaloneForecast(one,five,now+30*MIN);
 assert.equal(old.available,false);
});
test('read-only public endpoint accepts supported WEEX symbol and no account access',async()=>{
 let calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push([String(url),options]);
  return {ok:true,headers:{get:()=>null},
   text:async()=>JSON.stringify(raw(url.includes('interval=1m')?MIN:FIVE))};
 };
 const out=response();
 await handleStandaloneForecast({method:'GET',query:{symbol:'XRPUSDT'}},
  out,['XRPUSDT'],{fetchImpl,now});
 assert.equal(out.code,200,JSON.stringify(out.body).slice(0,400));
 assert.equal(out.headers['Cache-Control'],'no-store');
 assert.equal(out.body.symbol,'XRPUSDT');
 assert.equal(out.body.exchange,'WEEX');
 assert.equal(out.body.timeframes.length,3);
 assert.equal(out.body.ordersSent,0);
 assert.equal(calls.length,2);
 assert.ok(calls.every(x=>x[0].includes('/market/klines?')&&
  x[1].cache==='no-store'));
});
test('unsupported markets, POST, stale 5m and malformed data fail closed',async()=>{
 const denied=response();
 await handleStandaloneForecast({method:'GET',query:{symbol:'FAKEUSDT'}},
  denied,['BTCUSDT'],{fetchImpl:async()=>{throw Error('No network allowed')},now});
 assert.equal(denied.code,400);
 const post=response();
 await handleStandaloneForecast({method:'POST',query:{symbol:'BTCUSDT'}},
  post,['BTCUSDT'],{now});
 assert.equal(post.code,405);
 const stale=response();
 await handleStandaloneForecast({method:'GET',query:{symbol:'BTCUSDT'}},
  stale,['BTCUSDT'],{now,fetchImpl:async()=>({
   ok:true,headers:{get:()=>null},text:async()=>JSON.stringify([])
  })});
 assert.equal(stale.code,503);
 assert.equal(stale.body.ordersSent,0);
 assert.equal(stale.body.available,false);
});
test('forecasts UI is separate, readable and does not mutate trading/push system',()=>{
 const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const health=readFileSync(new URL('../health.html',import.meta.url),'utf8');
 const page=readFileSync(new URL('../forecast.html',import.meta.url),'utf8');
 const api=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const source=readFileSync(new URL('../lib/standalone-forecast.mjs',import.meta.url),'utf8');
 assert.match(index,/href="\/forecast.html"/);
 assert.match(health,/href="\/forecast.html"/);
 assert.match(api,/mode==='forecast'/);
 assert.match(page,/id="rows"/);
 assert.match(page,/id="long"/);
 assert.match(page,/id="short"/);
 assert.match(page,/id="mixed"/);
 assert.match(page,/mode=forecast&symbol=/);
 assert.match(page,/intervalMinutes\)\.join\(','\)!=='1,5,10'/);
 const script=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
 for(const forbidden of [/process\.env/,/Authorization:/i,/placeOrder/,/trade-confirm/,
  /trade-prepare/,/ntfySend/,/WEEX_API_SECRET/,/capi\/v3\/order/]){
  assert.doesNotMatch(source,forbidden);
 }
});
