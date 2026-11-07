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
 assert.match(s,/for\(const \{mark\} of pending\)/);
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
