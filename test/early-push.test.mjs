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
test('ntfy-only cron preserves 1m scanning independently from 5m and retains safety',()=>{
 const cron=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 const receiver=readFileSync(new URL('../api/push-subscribe.mjs',import.meta.url),'utf8');
 const early=readFileSync(new URL('../lib/early-push.mjs',import.meta.url),'utf8');
 assert.match(cron,/async function safeEarlyPush\(\)/);
 assert.match(cron,/const earlyPromise=safeEarlyPush\(\)/);
 assert.ok(cron.indexOf('const earlyPromise=safeEarlyPush()')<cron.indexOf("const response=await fetch('https://weex-radar.vercel.app/api/signals'"));
 assert.match(cron,/await earlyPromise;\s*console\.error\('Push check failed:'/);
 assert.match(cron,/WEEX_RADAR_EARLY_SCAN_FAILED/);
 assert.match(cron,/ntfySend\('confirmed',signals\)/);
 assert.match(early,/ntfySend\('early',signals\)/);
 assert.doesNotMatch(early,/webpush|telegramSend|@vercel\/blob|trade-confirm|trade-prepare|\/capi\/v3\/order/);
 assert.doesNotMatch(cron,/webpush|telegramSend|telegramPoll|@vercel\/blob/);
 // Retired Chrome worker and setup routes stay intact for rollback/manual tests.
 assert.match(worker,/msg\.kind==='early_watch'/);
 assert.match(receiver,/'early_watch'/);
});
test('updated worker activates early-watch support on existing Chrome',()=>{
 const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 assert.ok(sw.includes("self.addEventListener('install'"));
 assert.ok(sw.includes("self.skipWaiting()"));
 assert.ok(sw.includes("self.clients.claim()"));
 assert.ok(sw.includes("msg.kind==='early_watch'"));
});
test('cron audits each early scan even when the market is quiet',()=>{
 const src=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 assert.ok(src.includes("WEEX_RADAR_EARLY_DISPATCH"));
 assert.equal(src.includes('if(early.earlySignals||early.failed)'),false);
});

test('a slow first market does not hold other early-scan workers behind its batch',async()=>{
 const symbols=Array.from({length:16},(_,i)=>'C'+i);
 let active=0,peak=0;
 const started=[];
 let releaseFirst;
 const firstGate=new Promise(resolve=>{releaseFirst=resolve});
 let trigger;
 const eighthAndNextStarted=new Promise(resolve=>{trigger=resolve});
 const scan=scanEarlyMarkets(symbols,async(symbol)=>{
  active++;
  peak=Math.max(peak,active);
  started.push(symbol);
  if(started.includes('C8'))trigger();
  if(symbol==='C0')await firstGate;
  else await new Promise(resolve=>setTimeout(resolve,2));
  active--;
  return {...good,level:symbol==='C8'?'EARLY_WATCH':'WAIT'};
 });
 // The ninth market should start while market zero is still outstanding.
 await eighthAndNextStarted;
 assert.ok(started.includes('C8'));
 assert.ok(!started.includes('C0_COMPLETE'));
 releaseFirst();
 const signals=await scan;
 assert.ok(peak<=8,'WEEX parallel request cap exceeded');
 assert.equal(started.length,16);
 assert.deepEqual(signals.map(s=>s.symbol),['C8']);
});
