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
  for(const key of ['guardedBreakout15m','guardedReentry15m']){
   const study=res.result.shadowBBVolume[key];
   assert.equal(study.mode,'SHADOW_BB_VOLUME_1M');
   assert.equal(study.horizonMinutes,15);
   assert.equal(study.qualityProfile,'CAUTIOUS');
   assert.equal(study.tradeReady,false);
   assert.equal(study.changesLiveSignals,false);
   assert.equal(study.assumedRoundTripCostsBps,22);
  }
  assert.equal(res.headers['X-Content-Type-Options'],'nosniff');
  assert.equal(res.headers['Cache-Control'],'no-store');
  assert.equal(res.result.currentMinute.notATrade,true);
  assert.equal(res.result.currentMinute.fresh,true);
  assert.equal(res.result.currentMinute.observation.breakout.notATrade,true);
  const audit=res.result.recentFiveMinutes;
  assert.equal(audit.kind,'LOOKBACK_CLOSED_1M');
  assert.equal(audit.closedMinuteCount,5);
  assert.equal(audit.notATrade,true);
  assert.equal(audit.fresh,true);
  assert.ok(audit.baseCandidates>=audit.guardedCandidates);
  assert.equal(audit.events.length,audit.baseCandidates);
  assert.ok(audit.events.every(e=>e.notATrade&&
   ['LONG','SHORT'].includes(e.direction)&&
   ['BAND_BREAKOUT','BAND_REENTRY'].includes(e.strategy)&&
   e.closedAt<=res.result.currentMinute.closedAt));
  assert.equal(audit.until,res.result.currentMinute.closedAt);
 }finally{
  globalThis.fetch=originalFetch;
 }
});

test('real one-minute route dispatches a PAPER batch before requiring single symbol',async()=>{
 const original=globalThis.fetch,now=Date.now();
 const names=['BTCUSDT','XRPUSDT','SOLUSDT'],seen=[];
 const one=JSON.stringify(fakeBars('1m',now).slice(-100));
 globalThis.fetch=async url=>{
  const x=String(url);seen.push(x);
  if(x.includes('/market/ticker/bookTicker'))
   return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify([])};
  assert.ok(x.includes('/market/klines?'),'Only read public market candles');
  assert.equal(new URL(x).searchParams.get('interval'),'1m');
  return {ok:true,headers:{get:()=>null},text:async()=>one};
 };
 const res={statusCode:200,result:null,headers:{},
  setHeader(k,v){this.headers[k]=v;return this},
  status(n){this.statusCode=n;return this},
  json(v){this.result=v;return this}};
 try{
  await handleOneMinuteResearch({method:'GET',query:{
   paper:'1',batch:'1',quick:'1',symbols:names.join(',')
  }},res,names);
  assert.equal(res.statusCode,200,JSON.stringify(res.result).slice(0,300));
  assert.equal(res.result.mode,'PAPER_1M_WEEX_BATCH');
  assert.equal(res.result.ordersSent,0);
  assert.equal(res.result.results.length,names.length);
  assert.ok(res.result.results.every(x=>x.status==='ok'&&
   x.data?.mode==='PAPER_1M_WEEX_ONLY'&&
   x.data.ordersSent===0&&x.data.historical90m===null));
  assert.equal(res.headers['Cache-Control'],'no-store');
  assert.ok(seen.length>=3);
 }finally{globalThis.fetch=original}
});
test('PAPER batch routing fails closed for an unsupported member, with no fetch',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('Must never fetch an unsupported pair')};
 const res={statusCode:200,result:null,headers:{},
  setHeader(){return this},status(code){this.statusCode=code;return this},
  json(v){this.result=v;return this}};
 try{
  await handleOneMinuteResearch({method:'GET',query:{
   paper:'1',batch:'1',quick:'1',symbols:'BTCUSDT,FAKEUSDT'
  }},res,['BTCUSDT']);
  assert.equal(res.statusCode,400);
  assert.match(res.result.error,/batch/i);
 }finally{globalThis.fetch=original}
});
