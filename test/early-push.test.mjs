import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {watchFresh,scanEarlyMarkets}=(await import('../lib/early-push.mjs'))._test;
const now=Date.now();
const good={level:'EARLY_WATCH',direction:'LONG',exchange:'WEEX',candleCloseTime:now-10000,expiresAt:now+50000};
test('only fresh 1m WEEX watches, never confirmed 5m or expired signals',()=>{
 assert.equal(watchFresh(good,now),true);
 assert.equal(watchFresh({...good,direction:'SHORT'},now),true);
 for(const change of [
  {direction:null},{level:'STRONG'},{exchange:'Bybit'},{expiresAt:now+8000},
  {candleCloseTime:now-50000},{candleCloseTime:now+1000}
 ]) assert.equal(watchFresh({...good,...change},now),false,JSON.stringify(change));
});
test('all 16 WEEX markets are checked in a bounded fan-out; errors fail closed',async()=>{
 const symbols=Array.from({length:16},(_,i)=>'COIN'+i);
 const visited=[];
 const watches=await scanEarlyMarkets(symbols,async symbol=>{
   visited.push(symbol);
   if(symbol==='COIN8')throw Error('temporary feed failure');
   return {...good,level:symbol==='COIN0'?'EARLY_WATCH':'WAIT'};
 });
 assert.equal(visited.length,16);
 assert.equal(watches.length,1);
 assert.equal(watches[0].symbol,'COIN0');
});
test('the existing cron dispatch protects 5m notifications even if the 1m scan fails',()=>{
 const cron=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 const receiver=readFileSync(new URL('../api/push-subscribe.mjs',import.meta.url),'utf8');
 const early=readFileSync(new URL('../lib/early-push.mjs',import.meta.url),'utf8');
 assert.match(cron,/async function safeEarlyPush\(\)/);
 assert.match(cron,/early:await safeEarlyPush\(\)/);
 assert.match(cron,/WEEX_RADAR_EARLY_SCAN_FAILED/);
 assert.match(early,/kind:'early_watch'/);
 assert.match(early,/webpush\.sendNotification/);
 assert.match(early,/early-push-throttle/);
 assert.match(early,/early-push-markers/);
 assert.match(worker,/msg\.kind==='early_watch'/);
 assert.match(worker,/tradingview\\\.html/);
 assert.match(receiver,/'early_watch'/);
 assert.doesNotMatch(early,/trade-confirm|trade-prepare|\/capi\/v3\/order/);
});

test('updated worker activates new early-watch notifications on an existing phone',()=>{
 const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 assert.match(sw,/self\\.addEventListener\\('install'/);
 assert.match(sw,/self\\.skipWaiting\\(\\)/);
 assert.match(sw,/self\\.clients\\.claim\\(\\)/);
 assert.match(sw,/msg\\.kind==='early_watch'/);
});
test('cron audits early scan even when there is no early alert',()=>{
 const code=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 assert.match(code,/WEEX_RADAR_EARLY_DISPATCH/);
 assert.doesNotMatch(code,/if\\(early\\.earlySignals\\|\\|early\\.failed\\)/);
});
