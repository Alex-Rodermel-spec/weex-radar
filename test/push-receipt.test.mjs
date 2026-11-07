import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('batches concurrent market signals into one notification to avoid spam',()=>{
 const s=read('../api/push-dispatch.mjs');
 assert.match(s,/const pending=\[\]/);
 assert.match(s,/const selected=pending\.map/);
 assert.match(s,/await webpush\.sendNotification\(subscriber/);
 assert.match(s,/for\(const \{mark,retry\} of pending\)/);
 assert.match(s,/deliveryProof=createHmac\('sha256'/);
});
test('push worker acknowledges invocation without pretending Android displayed it',()=>{
 const sw=read('../sw.js'),subscribe=read('../api/push-subscribe.mjs');
 assert.match(sw,/await self\.registration\.showNotification/);
 assert.match(sw,/fetch\('\/api\/push-subscribe'/);
 assert.match(subscribe,/createHmac\('sha256'/);
 assert.match(subscribe,/WEEX_RADAR_PUSH_WORKER/);
 assert.doesNotThrow(()=>new Script(sw,{filename:'sw.js'}));
});
test('interactive push checks also carry a worker receipt token',()=>{
 const s=read('../api/push-subscribe.mjs'),html=read('../index.html');
 assert.match(s,/deliveryId=randomBytes\(16\)/);
 assert.match(s,/WEEX_RADAR_TEST_GATEWAY/);
 assert.match(html,/function showPushHealth\(checked\)/);
 assert.match(html,/Баннер и звук Android отдельно не подтверждены/);
});

test('background push test is queued, sent through cron and acknowledged independently of a page',()=>{
 const dispatch=read('../api/push-dispatch.mjs');
 const subscribe=read('../api/push-subscribe.mjs');
 const worker=read('../sw.js');
 const html=read('../index.html');
 assert.match(subscribe,/queueBackgroundTest===true/);
 assert.match(subscribe,/background-tests\//);
 assert.match(dispatch,/async function sendDueBackgroundTests/);
 assert.match(dispatch,/background-test-locks\//);
 assert.match(dispatch,/kind=signalStyle\?'signal_test':'background_test'/);
 assert.match(dispatch,/sendDueBackgroundTests\(\)/);
 assert.match(worker,/background_test/);
 assert.match(html,/id="bg-test"/);
 assert.match(html,/scheduleBackgroundPushTest/);
 assert.match(html,/pageshow/);
});

test('signals without worker receipt are retried at most once before expiry',()=>{
 const dispatch=read('../api/push-dispatch.mjs');
 const subscribe=read('../api/push-subscribe.mjs');
 assert.match(dispatch,/async function mayRetrySignal\(mark,signal\)/);
 assert.match(dispatch,/now-sent\.firstSentAt<55000/);
 assert.match(dispatch,/signal\.expiresAt<now\+30000/);
 assert.match(dispatch,/signalReceiptPath\(mark\)/);
 assert.match(dispatch,/allowOverwrite:false/);
 assert.match(dispatch,/if\(await mayRetrySignal\(mark,signal\)\)/);
 assert.match(dispatch,/pending\.push\(\{signal,mark,retry:true\}\)/);
 assert.match(dispatch,/push-deliveries\//);
 assert.match(subscribe,/kind==='signal'/);
 assert.match(subscribe,/batch\.marks/);
 assert.match(subscribe,/receipts\/signals\//);
});

test('signal notification priority, expiry and separately signed live signal receipt diagnostics',()=>{
 const dispatch=read('../api/push-dispatch.mjs');
 const subscribe=read('../api/push-subscribe.mjs');
 const sw=read('../sw.js');
 const html=read('../index.html');
 assert.match(sw,/renotify:isSignal&&!isEarly,requireInteraction:isSignal&&!isEarly/);
 assert.match(sw,/isSignal&&Number\.isFinite\(expiration\).*result='expired'/);
 assert.match(subscribe,/receipts\/last-signals\//);
 assert.match(subscribe,/signalDelivery/);
 assert.match(dispatch,/signal-status\//);
 assert.match(html,/id="signal-delivery"/);
 assert.match(html,/function showSignalDeliveryHealth\(checked\)/);
 assert.match(html,/Chrome не подтвердил получение/);
 assert.doesNotThrow(()=>new Script(sw,{filename:'sw.js'}));
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1],{filename:'index.html'}));
});

test('signal-style closed-browser test mimics real alerts but is explicitly not a trade',()=>{
 const dispatcher=read('../api/push-dispatch.mjs');
 const subscribe=read('../api/push-subscribe.mjs');
 const worker=read('../sw.js');
 const html=read('../index.html');
 assert.match(dispatcher,/ТЕСТ LONG BTCUSDT — НЕ СДЕЛКА/);
 assert.match(dispatcher,/kind=signalStyle\?'signal_test':'background_test'/);
 assert.match(dispatcher,/url:'\/'/);
 assert.match(subscribe,/mode:req\.body\?\.signalStyle===true/);
 assert.match(worker,/msg\.kind==='signal_test'/);
 assert.match(html,/id="signal-test"/);
 assert.match(html,/scheduleBackgroundPushTest\(true\)/);
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1],{filename:'index.html'}));
 assert.doesNotThrow(()=>new Script(worker,{filename:'sw.js'}));
});
