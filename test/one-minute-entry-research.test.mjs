import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {
 normalizeOneMinute,evaluateOneMinuteDiscovery,replayOneMinute,ONE_MINUTE_RESEARCH
} from '../lib/one-minute-entry-research.mjs';
import {handleOneMinuteResearch} from '../lib/one-minute-entry-research-route.mjs';

const MIN=60_000,FIVE=300_000,FIFTEEN=900_000;
const ST=Date.parse('2026-11-08T00:00:00.000Z');
function rows(n,dt,start,power,up=true){
 return Array.from({length:n},(_,i)=>{
  const close=100+(up?1:-1)*i*power;
  return {time:start+i*dt,closeTime:start+(i+1)*dt,
   open:close-.004,high:close+.02,low:close-.02,
   close,volume:100};
 });
}
function minuteFixture(dir='LONG'){
 const up=dir==='LONG',s=up?1:-1;
 const arr=Array.from({length:125},(_,i)=>{
  const px=100+s*(i*.001+.04*Math.sin(i*.8));
  return {time:ST+i*MIN,closeTime:ST+(i+1)*MIN,
   open:px-s*.004,high:px+.015,low:px-.015,close:px,volume:100}
 });
 const prior=arr.slice(-13,-1);
 const trigger=arr.at(-1),prev=arr.at(-2);
 const level=up?Math.max(...prior.map(x=>x.high)):
  Math.min(...prior.map(x=>x.low));
 const close=level+s*.005;
 Object.assign(trigger,{open:prev.close,close,
  high:Math.max(prev.close,close)+.003,low:Math.min(prev.close,close)-.003,
  volume:190});
 return arr;
}
const five=rows(100,FIVE,ST-100*FIVE,.035,true),
 fifteen=rows(100,FIFTEEN,ST-100*FIFTEEN,.07,true);
test('one-minute candidate requires a new closed breakout and independent 5m AND 15m aligned context',()=>{
 const long=evaluateOneMinuteDiscovery(minuteFixture(),five,fifteen);
 assert.equal(long.stage,'FOUND');
 assert.equal(long.direction,'LONG');
 assert.ok(long.atr5>0);
 const bad=evaluateOneMinuteDiscovery(minuteFixture(),five,
  rows(100,FIFTEEN,ST-100*FIFTEEN,.07,false));
 assert.equal(bad.stage,'TREND_MISMATCH');
 const no=evaluateOneMinuteDiscovery(minuteFixture().map(x=>({...x,volume:0})),five,fifteen);
 assert.equal(no.stage,'LOW_VOLUME');
 const gap=minuteFixture();gap[95].time+=MIN;
 assert.equal(evaluateOneMinuteDiscovery(gap,five,fifteen).stage,'INSUFFICIENT_CLOSED_DATA');
 const futureContext=five.map(x=>({...x,time:x.time+24*60*MIN,closeTime:x.closeTime+24*60*MIN}));
 assert.equal(evaluateOneMinuteDiscovery(minuteFixture(),futureContext,fifteen).stage,'FUTURE_CONTEXT');
});
test('closed minute normalization rejects future and damaged candles',()=>{
 const now=ST+200*MIN+30_000;
 const raw=[
  [ST,100,101,99,100.5,40],
  [ST+MIN,100,99,101,100,40],
  [ST+2*MIN,100,101,99,100.5,-1],
  [ST+199*MIN,100,101,99,100.5,40],
  [ST+200*MIN,100,101,99,100.5,40]
 ];
 const normalized=normalizeOneMinute(raw,now);
 assert.equal(normalized.length,2);
 assert.equal(normalized[0].time,ST);
 assert.equal(normalized[1].time,ST+199*MIN);
 assert.throws(()=>normalizeOneMinute({},now),/BAD_1M/);
});
test('historical replay uses only 1m trigger and PREVIOUSLY closed 5m/15m candles',()=>{
 const start=ST+30*60*MIN;
 const mins=Array.from({length:360},(_,i)=>{
  const px=101+i*.003+.1*Math.sin(i*.52);
  return {time:start+i*MIN,closeTime:start+(i+1)*MIN,
   open:px-.002,high:px+.03,low:px-.03,close:px,volume:i%13===0?180:100}
 });
 const manyFive=rows(160,FIVE,start-120*FIVE,.025,true);
 const manyFifteen=rows(160,FIFTEEN,start-130*FIFTEEN,.045,true);
 const res=replayOneMinute(mins,manyFive,manyFifteen);
 assert.equal(res.mode,'RESEARCH_ONLY_ONE_MINUTE');
 assert.equal(res.ordersSent,0);
 assert.equal(res.liveActivation,false);
 assert.ok(res.coverage.checked>0);
 assert.equal(res.filter.triggered,res.filter.stages.FOUND||0);
 assert.ok(res.results.setups<=res.filter.triggered);
 assert.equal(res.results.setups,res.results.TP+res.results.SL+
  res.results.TIMEOUT+res.results.AMBIGUOUS);
 assert.equal(ONE_MINUTE_RESEARCH.minNetRR,1.3);
});
test('read-only research cannot modify real orders, cron, confirmed alerts or 5m trade eligibility',()=>{
 const scan=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const route=readFileSync(new URL('../lib/one-minute-entry-research-route.mjs',import.meta.url),'utf8');
 const research=readFileSync(new URL('../lib/one-minute-entry-research.mjs',import.meta.url),'utf8');
 const dispatcher=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const trade=readFileSync(new URL('../api/trade-prepare.mjs',import.meta.url),'utf8');
 assert.match(scan,/mode==='one-minute-research'/);
 assert.match(scan,/const longBreak=last.close>upper/);
 assert.match(trade,/_test.scanSymbol\(symbol\)/);
 assert.match(dispatcher,/ntfySend\('confirmed',signals\)/);
 assert.doesNotMatch(research+route,/weex\.placeOrder|trade-confirm|trade-prepare|PUSH_CRON_KEY|NTFY_TOPIC|@vercel\/blob/);
});
test('research endpoint is limited to single supported coin and HTTP GET',async()=>{
 const res={statusCode:0,payload:null,
  setHeader(){},status(n){this.statusCode=n;return this},
  json(v){this.payload=v;return this}};
 await handleOneMinuteResearch({method:'POST',query:{symbol:'XRPUSDT'}},res,['XRPUSDT']);
 assert.equal(res.statusCode,405);
 await handleOneMinuteResearch({method:'GET',query:{symbol:'BAD'}},res,['XRPUSDT']);
 assert.equal(res.statusCode,400);
});
test('interactive 1m research dashboard JavaScript parses and does not expose account secrets',()=>{
 const h=readFileSync(new URL('../one-minute-research.html',import.meta.url),'utf8');
 const script=h.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
 assert.match(h,/mode=one-minute-research/);
 assert.doesNotMatch(h,/\/api\/trade-confirm|\/api\/trade-prepare|WEEX_API_SECRET/);
});
