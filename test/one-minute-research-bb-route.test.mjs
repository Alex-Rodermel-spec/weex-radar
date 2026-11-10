import test from 'node:test';
import assert from 'node:assert/strict';
import {handleOneMinuteResearch} from '../lib/one-minute-entry-research-route.mjs';

const M=60_000;
const duration={ '1m':M, '5m':5*M, '15m':15*M };
const counts={ '1m':1000, '5m':350, '15m':150 };

function fakeBars(interval,now){
 const step=duration[interval],count=counts[interval];
 const lastClose=Math.floor((now-2000)/step)*step;
 return Array.from({length:count},(_,i)=>{
  const time=lastClose-(count-i)*step;
  const price=100+0.15*Math.sin(time/M/29)+0.12*Math.cos(time/M/103);
  const close=price+0.005*Math.sin(time/M/7);
  return [time,price,Math.max(price,close)+0.08,
   Math.min(price,close)-0.08,close,100+(i%7)*5];
 });
}

test('read-only research route includes separate 5m/10m BB+volume studies',async()=>{
 const originalFetch=globalThis.fetch;
 const now=Date.now();
 const seen=[];
 globalThis.fetch=async url=>{
  const interval=new URL(url).searchParams.get('interval');
  assert.ok(duration[interval],'Unexpected interval');
  seen.push(interval);
  const body=JSON.stringify(fakeBars(interval,now));
  return {ok:true,headers:{get:()=>null},text:async()=>body};
 };
 const res={
  statusCode:200,headers:{},result:null,
  setHeader(k,v){this.headers[k]=v;return this},
  status(n){this.statusCode=n;return this},
  json(obj){this.result=obj;return this}
 };
 try{
  await handleOneMinuteResearch({method:'GET',query:{symbol:'BTCUSDT'}},res,['BTCUSDT']);
  assert.equal(res.statusCode,200,JSON.stringify(res.result));
  assert.deepEqual(seen.sort(),['15m','1m','5m']);
  assert.equal(res.result.mode,'RESEARCH_ONLY_ONE_MINUTE');
  assert.equal(res.result.ordersSent,0);
  assert.equal(res.result.liveActivation,false);
  for(const key of ['horizon5m','horizon10m','reentry5m','reentry10m']){
   const study=res.result.shadowBBVolume[key];
   assert.equal(study.mode,'SHADOW_BB_VOLUME_1M');
   assert.equal(study.tradeReady,false);
   assert.equal(study.changesLiveSignals,false);
   assert.equal(study.assumedRoundTripCostsBps,22);
  }
  assert.equal(res.result.shadowBBVolume.horizon5m.horizonMinutes,5);
  assert.equal(res.result.shadowBBVolume.horizon10m.horizonMinutes,10);
  assert.equal(res.result.shadowBBVolume.reentry5m.strategy,'BAND_REENTRY');
  assert.equal(res.result.shadowBBVolume.reentry10m.strategy,'BAND_REENTRY');
  assert.ok(Object.hasOwn(res.result.shadowBBVolume.reentry5m,'byPeriod'));
  assert.equal(res.result.shadowBBVolume.reentry10m.horizonMinutes,10);
  assert.equal(res.headers['X-Content-Type-Options'],'nosniff');
 }finally{
  globalThis.fetch=originalFetch;
 }
});
