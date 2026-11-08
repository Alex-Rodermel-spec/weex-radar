import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('ntfy deduplicates per candle and sends at most six fresh signals per scan',()=>{
 const dispatch=read('../api/push-dispatch.mjs'),ntfy=read('../lib/ntfy-alerts.mjs');
 assert.match(dispatch,/ntfySend\('confirmed',signals\)/);
 assert.match(ntfy,/sequenceForSignal\(kind,s\)/);
 assert.match(ntfy,/previous\.has\(id\)/);
 assert.match(ntfy,/\.slice\(0,6\)/);
 assert.match(ntfy,/signal\.candleCloseTime/);
 assert.doesNotMatch(dispatch,/webpush\.sendNotification/);
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

test('legacy Chrome background diagnostics may remain queued but ntfy-only cron never processes them',()=>{
 const dispatch=read('../api/push-dispatch.mjs');
 const subscribe=read('../api/push-subscribe.mjs');
 const worker=read('../sw.js');
 const html=read('../index.html');
 assert.match(subscribe,/queueBackgroundTest===true/);
 assert.match(subscribe,/background-tests\//);
 assert.doesNotMatch(dispatch,/sendDueBackgroundTests\(/);
 assert.match(worker,/background_test/);
 assert.match(html,/id="bg-test"/);
 assert.match(html,/disabled title="Временно выключено/);
 assert.match(html,/NTFY_ONLY_ALERTS=true/);
});
test('ntfy stable sequence IDs prevent duplicate Android alerts without worker receipts',()=>{
 const dispatch=read('../api/push-dispatch.mjs');
 const ntfy=read('../lib/ntfy-alerts.mjs');
 assert.match(ntfy,/recentNtfySequences\(topic\)/);
 assert.match(ntfy,/const id=sequenceForSignal\(kind,s\)/);
 assert.match(ntfy,/previous\.has\(id\)/);
 assert.match(ntfy,/sequenceId:id/);
 assert.doesNotMatch(dispatch,/mayRetrySignal|push-deliveries\//);
});
test('ntfy handles confirmation urgency and expiry while old Chrome receipts remain read-only',()=>{
 const dispatch=read('../api/push-dispatch.mjs');
 const subscribe=read('../api/push-subscribe.mjs');
 const ntfy=read('../lib/ntfy-alerts.mjs');
 const sw=read('../sw.js'),html=read('../index.html');
 assert.match(ntfy,/priority:isEarly\?4:5/);
 assert.match(ntfy,/s\.expiresAt<=stampedAt\+12000/);
 assert.match(ntfy,/fresh\(s\)/);
 assert.match(dispatch,/deliveryMode:'ntfy-only'/);
 assert.match(subscribe,/receipts\/last-signals\//);
 assert.match(sw,/renotify:isSignal&&!isEarly,requireInteraction:isSignal&&!isEarly/);
 assert.match(html,/function showSignalDeliveryHealth\(checked\)/);
 assert.doesNotThrow(()=>new Script(sw,{filename:'sw.js'}));
});
test('legacy Chrome signal tests are opt-in and disconnected; ntfy never submits trades',()=>{
 const dispatcher=read('../api/push-dispatch.mjs');
 const subscribe=read('../api/push-subscribe.mjs');
 const worker=read('../sw.js');
 const html=read('../index.html');
 const ntfy=read('../lib/ntfy-alerts.mjs');
 assert.doesNotMatch(dispatcher,/sendDueBackgroundTests|webpush|trade-confirm/);
 assert.match(subscribe,/mode:req\.body\?\.signalStyle===true/);
 assert.match(worker,/msg\.kind==='signal_test'/);
 assert.match(html,/id="signal-test"/);
 assert.match(html,/scheduleBackgroundPushTest\(true\)/);
 assert.match(html,/const NTFY_ONLY_ALERTS=true/);
 assert.doesNotMatch(ntfy,/trade-confirm|trade-prepare|\/capi\/v3\/order/);
 assert.doesNotThrow(()=>new Script(worker,{filename:'sw.js'}));
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);assert.doesNotThrow(()=>new Script(script[1],{filename:'index.html'}));
});
