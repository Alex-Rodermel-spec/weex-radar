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

test('owner ntfy topic bypasses blocked Blob and deduplicates on Android',async()=>{
 const {ntfySend}=await import('../lib/ntfy-alerts.mjs');
 const previousTopic=process.env.NTFY_TOPIC,previousFetch=globalThis.fetch;
 const topic='WR_Private_'+('a'.repeat(24));
 const sent=[];
 process.env.NTFY_TOPIC=topic;
 globalThis.fetch=async(url,init)=>{sent.push({url,body:JSON.parse(init.body)});return {ok:true,status:200};};
 try{
  assert.equal(checks.configuredTopic(),topic);
  const signal={symbol:'ALGOUSDT',exchange:'WEEX',direction:'LONG',level:'STRONG',
   price:1.0,livePrice:1.01,stop:0.98,take:1.04,
   candleCloseTime:Date.now()-10000,expiresAt:Date.now()+90000};
  const first=await ntfySend('confirmed',[signal]);
  const again=await ntfySend('confirmed',[signal]);
  assert.equal(first.enabled,true);
  assert.equal(first.delivered,1);
  assert.equal(first.failed,0);
  assert.equal(again.delivered,1);
  assert.equal(sent.length,2);
  assert.equal(sent[0].url,'https://ntfy.sh/');
  assert.equal(sent[0].body.topic,topic);
  assert.match(sent[0].body.sequence_id,/^[a-f0-9]{32}$/);
  assert.equal(sent[0].body.sequence_id,sent[1].body.sequence_id);
 }finally{
  globalThis.fetch=previousFetch;
  if(previousTopic===undefined)delete process.env.NTFY_TOPIC;else process.env.NTFY_TOPIC=previousTopic;
 }
});
