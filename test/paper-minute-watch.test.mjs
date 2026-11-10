import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {buildPaperMinuteSnapshot,handlePaperMinuteWatch,candidateBookQuote} from '../lib/paper-minute-watch.mjs';
const MINUTE=60000;
function fakeRows(now,count=100){
 const closed=Math.floor((now-3000)/MINUTE)*MINUTE;
 return Array.from({length:count},(_,i)=>{
  const t=closed-(count-i)*MINUTE;
  const open=100+0.1*Math.sin(i/8);
  const close=100+0.1*Math.sin((i+1)/8);
  return [t,open,Math.max(open,close)+0.02,
   Math.min(open,close)-0.02,close,100+i%9];
 });
}
function mkRes(){
 return {statusCode:200,result:null,headers:{},
  setHeader(n,v){this.headers[n]=v;return this},
  status(v){this.statusCode=v;return this},
  json(o){this.result=o;return this}};
}
test('paper snapshot returns closed contiguous historical candles, never an order',()=>{
 const now=Date.UTC(2026,10,10,3,40,10);
 const snap=buildPaperMinuteSnapshot(fakeRows(now),now);
 assert.equal(snap.mode,'PAPER_1M_WEEX_ONLY');
 assert.equal(snap.notATrade,true);
 assert.equal(snap.ordersSent,0);
 assert.equal(snap.tradeReady,false);
 assert.equal(snap.bars.length,100);
 assert.equal(snap.bars.at(-1).time,snap.closedAt-MINUTE);
 assert.ok(snap.bars.every(b=>Number.isFinite(b.high)&&Number.isFinite(b.low)&&
  b.high>=b.close&&b.low<=b.close&&b.high>=b.low));
 assert.equal(snap.tradeReady,false);
 assert.ok(snap.generatedAt>snap.closedAt);
 assert.equal(snap.assumedRoundTripCostsBps,22);
 assert.equal(snap.historical90m.kind,'PAST_CANDLES_ONLY_NOT_PAPER');
 assert.equal(snap.historical90m.notATrade,true);
 assert.equal(snap.historical90m.observedMinutes,80);
 assert.ok(snap.historical90m.rawCandidates>=snap.historical90m.guardedCandidates);
 assert.equal(snap.historical90m.qualityRejected,
  snap.historical90m.rawCandidates-snap.historical90m.guardedCandidates);
 assert.ok(snap.historical90m.lastSignals.length<=10);
 assert.ok(snap.historical90m.lastSignals.every(x=>x.notATrade&&
  x.closedAt<=snap.closedAt));
 const fast=buildPaperMinuteSnapshot(fakeRows(now),now,{quick:true});
 assert.equal(fast.mode,'PAPER_1M_WEEX_ONLY');
 assert.equal(fast.historical90m,null);
 assert.equal(fast.closedAt,snap.closedAt);
 assert.equal(fast.notATrade,true);
 assert.equal(fast.ordersSent,0);
 assert.equal(fast.bars.length,snap.bars.length);
 assert.deepEqual(fast.recent,snap.recent);
 assert.deepEqual(fast.marketWatch,snap.marketWatch);
 assert.equal(snap.marketWatch.notATrade,true);
 assert.ok(['NEAR_BAND','VOLUME_ACTIVITY','MOMENTUM','SQUEEZE','QUIET']
  .includes(snap.marketWatch.kind));
 assert.equal(snap.marketWatch.regime.notATrade,true);
 assert.equal(snap.marketWatch.regime.tradeReady,false);
 assert.equal(snap.marketWatch.regime.available,true);
 assert.ok(Number.isFinite(snap.marketWatch.regime.rsi14));
 assert.ok(Number.isFinite(snap.marketWatch.regime.atr14Bps));
 assert.ok(Number.isFinite(snap.marketWatch.relativeVolume));
 assert.ok(Number.isFinite(snap.marketWatch.oneMinuteRangeBps));
 assert.ok(snap.marketWatch.oneMinuteRangeBps>=0);
 assert.equal(snap.marketWatch.modeledCostBps,22);
 assert.equal(snap.marketWatch.rangeToCostRatio,
  Number((snap.marketWatch.oneMinuteRangeBps/22).toFixed(2)));
 assert.ok(snap.recent.every(e=>e.closedAt<=snap.closedAt&&e.notATrade));
});
test('paper snapshot fails closed on missing minute and stale data',()=>{
 const now=Date.UTC(2026,10,10,3,40,10);
 const bars=fakeRows(now);
 assert.throws(()=>buildPaperMinuteSnapshot(bars.slice(0,30),now));
 const gap=bars.filter((_,i)=>i!==50);
 assert.throws(()=>buildPaperMinuteSnapshot(gap,now),/GAPPED/);
 assert.throws(()=>buildPaperMinuteSnapshot(bars,now+5*MINUTE),/STALE/);
});
test('public WEEX 1m paper endpoint needs valid symbol and no trading auth',async()=>{
 const now=Date.now(),prior=globalThis.fetch,seen=[];
 const bars=fakeRows(now);
 globalThis.fetch=async(url,opts)=>{
  seen.push({url,opts});
  return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify(bars)};
 };
 try{
  const invalid=mkRes();
  await handlePaperMinuteWatch({method:'GET',query:{symbol:'NOUSDT'}},invalid,['XRPUSDT']);
  assert.equal(invalid.statusCode,400);
  assert.equal(seen.length,0);
  const res=mkRes();
  await handlePaperMinuteWatch({method:'GET',query:{symbol:'XRPUSDT'}},res,['XRPUSDT']);
  assert.equal(res.statusCode,200,JSON.stringify(res.result));
  assert.equal(res.result.exchange,'WEEX');
  assert.equal(res.result.symbol,'XRPUSDT');
  assert.equal(res.result.ordersSent,0);
  assert.equal(res.result.tradeReady,false);
  assert.equal(res.result.quoteRequiredForNewPaper,true);
  assert.equal(res.headers['Cache-Control'],'no-store');
  assert.equal(seen.length,1);
  const url=new URL(seen[0].url);
  assert.equal(url.searchParams.get('symbol'),'XRPUSDT');
  assert.equal(url.searchParams.get('interval'),'1m');
  assert.equal(url.searchParams.get('limit'),'100');
  assert.equal(seen[0].opts.cache,'no-store');
 }finally{globalThis.fetch=prior}
});
test('paper page compiles and contains win/loss and five-minute future settlement',()=>{
 const page=readFileSync(new URL('../paper-five.html',import.meta.url),'utf8');
 const scripts=[...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
 assert.equal(scripts.length,1);
 assert.doesNotThrow(()=>new Script(scripts[0][1],{filename:'paper-five.html'}));
 assert.match(page,/COSTS_BPS=22/);
 assert.match(page,/HORIZON=5\*ONE/);
 assert.match(page,/status==='win'/);
 assert.match(page,/status==='loss'/);
 assert.match(page,/localStorage/);
 assert.match(page,/setTimeout/);
 assert.match(page,/AFTER_CLOSE_MS=4500/);
 assert.match(page,/MAX_DETECTION_MS=25000/);
 assert.match(page,/MAX_RESPONSE_AGE_MS=12000/);
 assert.match(page,/PAPER_LEVERAGE=50/);
 assert.match(page,/PAPER_STRESS_BPS=150/);
 assert.match(page,/PAPER_50X_STRESS_V1/);
 assert.match(page,/id="risk-touches-50"/);
 assert.match(page,/id="margin-roi-50"/);
 assert.match(page,/id="hist-90"/);
 assert.match(page,/id="paper-explain"/);
 assert.match(page,/id="history-events-body"/);
 assert.match(page,/historyRows\.sort/);
 assert.match(page,/ИСТОРИЯ · НЕ PAPER-СДЕЛКИ/);
 assert.match(page,/id="skip-quote"/);
 assert.match(page,/id="paper-added"/);
 assert.match(page,/id="history-refresh"/);
 assert.match(page,/id="scan-duration"/);
 assert.match(page,/id="scan-fail"/);
 assert.match(page,/quick=1/);
 assert.match(page,/scanCycle\+\+\*13/);
 assert.match(page,/AbortController/);
 assert.match(page,/PAST_CANDLES_ONLY_NOT_PAPER/);
 assert.match(page,/\$\('once'\)\.onclick=\(\)=>\{if\(!running\)start\(\);else scan\(\)\}/);
 assert.doesNotMatch(page,/setInterval\(/);
 assert.match(page,/notATrade/);
 assert.match(page,/id="watch-count"/);
 assert.match(page,/id="total-net"/);
 assert.match(page,/id="win-rate"/);
 assert.match(page,/marketWatch\.notATrade/);
 assert.match(page,/kind==='NEAR_BAND'/);
 assert.match(page,/kind==='MOMENTUM'/);
 assert.match(page,/kind==='VOLUME_ACTIVITY'/);
 assert.match(page,/diagnostics\.trend/);
});
test('no live order, trade API, account or webhook references in paper data handler',()=>{
 const src=readFileSync(new URL('../lib/paper-minute-watch.mjs',import.meta.url),'utf8');
 for(const re of [/process\.env/,/placeOrder/,/trade-confirm/,/trade-prepare/,
  /ntfySend/,/cron-key/,/x-radar-cron-key/,/Authorization:/i])
  assert.doesNotMatch(src,re);
});

test('public WEEX bookTicker validates a fresh bid/ask and rejects stale or wide spreads',async()=>{
 const now=Date.UTC(2026,10,10,5,15,12),close=now-9000;
 const old=globalThis.fetch,seen=[];
 const reply=(time,bid='100.00',ask='100.08')=>({
  ok:true,headers:{get:()=>null},
  text:async()=>JSON.stringify([{symbol:'XRPUSDT',bidPrice:bid,
   askPrice:ask,time:String(time)}])
 });
 globalThis.fetch=async(url,options)=>{
  seen.push({url,options});
  return reply(now-1000);
 };
 try{
  const q=await candidateBookQuote('XRPUSDT',close,now);
  assert.equal(q.source,'WEEX_PUBLIC_BOOKTICKER');
  assert.equal(q.bid,100);
  assert.equal(q.ask,100.08);
  assert.equal(q.notATrade,true);
  assert.ok(q.spreadBps>0);
  assert.equal(seen.length,1);
  assert.match(seen[0].url,/market\/ticker\/bookTicker\?symbol=XRPUSDT/);
  assert.equal(seen[0].options.cache,'no-store');
  globalThis.fetch=async()=>reply(close-1000);
  await assert.rejects(candidateBookQuote('XRPUSDT',close,now),/STALE_OR_INVALID/);
  globalThis.fetch=async()=>reply(now-1000,'100','102');
  await assert.rejects(candidateBookQuote('XRPUSDT',close,now),/STALE_OR_INVALID/);
 }finally{globalThis.fetch=old}
});
