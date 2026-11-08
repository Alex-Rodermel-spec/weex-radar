import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const ntfy=readFileSync(new URL('../lib/ntfy-alerts.mjs',import.meta.url),'utf8');
const subscribe=readFileSync(new URL('../api/push-subscribe.mjs',import.meta.url),'utf8');
const push=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
const early=readFileSync(new URL('../lib/early-push.mjs',import.meta.url),'utf8');
const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const checks=(await import('../lib/ntfy-alerts.mjs'))._test;
const now=Date.now();
test('ntfy topics are strong random private channel names',()=>{
 assert.equal(checks.topicOk('wr-'+'a'.repeat(32)),true);
 for(const topic of ['weex-radar','wr-short','wr-'+'a'.repeat(31),
   'wr-'+'z'.repeat(32),'wr-'+'a'.repeat(33)])assert.equal(checks.topicOk(topic),false);
 assert.equal(checks.subscriberOk('0'.repeat(64)),true);
 assert.equal(checks.subscriberOk('something'),false);
 assert.match(page,/crypto\.getRandomValues\(new Uint8Array\(16\)\)/);
});
test('only unexpired signals can enter optional ntfy delivery',()=>{
 const good={direction:'SHORT',exchange:'WEEX',expiresAt:now+60000,candleCloseTime:now};
 assert.equal(checks.fresh(good),true);
 assert.equal(checks.fresh({...good,exchange:'Bybit'}),true);
 assert.equal(checks.fresh({...good,expiresAt:now-1}),false);
 assert.equal(checks.fresh({...good,direction:'WAIT'}),false);
});
test('ntfy never touches trading/order endpoints',()=>{
 assert.doesNotMatch(ntfy,/\/trade-confirm|\/trade-prepare|\/capi\/v3\/order/);
 assert.match(ntfy,/https:\/\/ntfy\.sh\//);
 assert.match(ntfy,/priority/);
 assert.match(ntfy,/ntfy\/markers\//);
});
test('Chrome fallback remains and ntfy is opt in, with independent delivery',()=>{
 assert.match(subscribe,/ntfySetup===true/);
 assert.match(subscribe,/ntfyTest===true/);
 assert.match(subscribe,/ntfyDisable===true/);
 assert.match(push,/webpush\.sendNotification/);
 assert.match(push,/const ntfyPromise=/);
 assert.match(early,/ntfySend\('early'/);
});
test('ntfy controls are parsed as valid browser JavaScript',()=>{
 const m=page.match(/<script>\s*([\s\S]*?)<\/script>/);
 assert.ok(m);
 assert.doesNotThrow(()=>new Script(m[1]));
});
