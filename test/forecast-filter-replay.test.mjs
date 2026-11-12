import test from 'node:test';
import assert from 'node:assert/strict';
import {completedForecastBars} from '../lib/standalone-forecast.mjs';
import {replayFilterOutcomes,handleForecastFilterReplay,FILTER_REPLAY_POLICY}
 from '../lib/forecast-filter-replay.mjs';
const MIN=60_000,FIVE=5*MIN;
const now=Date.UTC(2026,10,12,16,37,30);
function raw(step){
 const end=Math.floor(now/step)*step;
 return Array.from({length:125},(_,i)=>{
  const time=end-(125-i)*step;
  const close=100-(125-i-1)*step/MIN*.012;
  const open=close-.004;
  return [time,open,close+.018,open-.018,close,150+i%5];
 });
}
function res(){
 return {code:0,body:null,headers:{},setHeader(k,v){this.headers[k]=v;return this},
  status(v){this.code=v;return this},json(v){this.body=v;return this}};
}
test('closed WEEX 1m and 5m replay: matched future 5/15/30m assessments for four variants',()=>{
 const one=completedForecastBars(raw(MIN),MIN,now);
 const five=completedForecastBars(raw(FIVE),FIVE,now);
 assert.equal(one.length,125);
 assert.equal(five.length,125);
 const q=replayFilterOutcomes(one,five,{symbol:'BTCUSDT',now});
 assert.equal(q.available,true);
 assert.equal(q.group,'MAJOR_CRYPTO');
 assert.ok(q.snapshots>0&&q.snapshots<=10);
 assert.equal(q.ordersSent,0);
 assert.equal(q.noLookahead,true);
 for(const k of ['live','emaRsi','emaBollinger','fiveMinutePriority']){
  const m=q.models[k];
  assert.equal(m.totalSnapshots,q.snapshots);
  assert.equal(m.at30m.observed,m.candidates);
  assert.ok(m.at5m.favorablePct===null||m.at5m.favorablePct>=0);
  assert.equal(m.at15m.observed,m.candidates);
  assert.ok(m.firstFavorable10bps.reached<=m.candidates);
 }
 assert.equal(FILTER_REPLAY_POLICY.maxMarketRequestsPerCall,2);
 assert.equal(FILTER_REPLAY_POLICY.ordersSent,0);
});
test('incomplete or unsupported history cannot produce fictional backtest wins',()=>{
 const one=completedForecastBars(raw(MIN),MIN,now);
 const five=completedForecastBars(raw(FIVE),FIVE,now);
 assert.equal(replayFilterOutcomes(one.slice(-50),five,{symbol:'BTCUSDT',now}).available,false);
 assert.equal(replayFilterOutcomes(one,five,{symbol:'NOTAREALMARKET',now}).available,false);
});
test('route is GET-only, validates WEEX symbol, fetches only two public candle intervals',async()=>{
 const requests=[];
 const fetchImpl=async url=>{
  requests.push(String(url));
  return {ok:true,headers:{get:()=>null},
   text:async()=>JSON.stringify(raw(url.includes('interval=1m')?MIN:FIVE))};
 };
 const response=res();
 await handleForecastFilterReplay({method:'GET',query:{symbol:'XAUUSDT'}},
  response,['XAUUSDT'],{fetchImpl,now});
 assert.equal(response.code,200,JSON.stringify(response.body).slice(0,300));
 assert.equal(response.body.group,'METALS');
 assert.equal(response.body.available,true);
 assert.equal(response.body.ordersSent,0);
 assert.equal(response.headers['Cache-Control'],'no-store');
 assert.equal(requests.length,2);
 assert.ok(requests.every(x=>x.startsWith('https://api-contract.weex.com/')&&
  x.includes('/market/klines?')&&x.includes('limit=125')));
 const deny=res();
 await handleForecastFilterReplay({method:'GET',query:{symbol:'INVALID'}},
  deny,['XAUUSDT'],{fetchImpl,now});
 assert.equal(deny.code,400);
 assert.equal(requests.length,2);
 const post=res();
 await handleForecastFilterReplay({method:'POST',query:{symbol:'XAUUSDT'}},
  post,['XAUUSDT'],{fetchImpl,now});
 assert.equal(post.code,405);
 assert.equal(requests.length,2);
});
