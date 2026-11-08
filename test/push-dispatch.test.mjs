import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dispatchAudit} from '../api/push-dispatch.mjs';

test('scheduler audit separates cron-job and GitHub without revealing secrets',()=>{
 const a=JSON.parse(dispatchAudit('cron',200,{signals:0,delivered:0,failed:0},100));
 const b=JSON.parse(dispatchAudit('github',200,{signals:1,delivered:1,failed:0,token:'VERY_SECRET'},200));
 assert.deepEqual(a,{source:'cron',http:200,checkedAt:100,signals:0,delivered:0,failed:0,subscribers:null,duplicates:0});
 assert.equal(b.source,'github');
 assert.equal(b.delivered,1);
 assert.doesNotMatch(JSON.stringify(b),/VERY_SECRET/);
 assert.throws(()=>dispatchAudit('untrusted',200,{}),/scheduler/);
});

test('ntfy-only signed dispatch preserves filtering, starts early watch, skips old relays',()=>{
 const code=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 assert.match(code,/ntfySend\('confirmed',signals\)/);
 assert.match(code,/const earlyPromise=safeEarlyPush\(\)/);
 assert.match(code,/const \[early,ntfy\]=await Promise\.all\(\[earlyPromise,ntfyPromise\]\)/);
 assert.match(code,/const source=await authorized\(req\)/);
 assert.match(code,/entry\.ok\?\s*\{\.\.\.signal,livePrice:quote\.price,entryQuality:entry,costReview\}:null/);
 assert.doesNotMatch(code,/webpush|telegramPoll|telegramSend|@vercel\/blob|VAPID_PRIVATE_KEY/);
});
test('audit distinguishes zero phone subscriptions from already-delivered signals',()=>{
 const a=JSON.parse(dispatchAudit('cron',200,{signals:2,subscribers:0,delivered:0,failed:0,duplicates:0},123));
 const b=JSON.parse(dispatchAudit('cron',200,{signals:2,subscribers:1,delivered:0,failed:0,duplicates:2},124));
 assert.equal(a.subscribers,0);
 assert.equal(b.duplicates,2);
 assert.equal(b.subscribers,1);
});

test('push subscription health check does not reinsert an expired browser endpoint',()=>{
 const subscribe=readFileSync(new URL('../api/push-subscribe.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(subscribe,/if\(req\.body\?\.checkOnly===true\)\{/);
 assert.match(subscribe,/const present=r\.blobs\.some/);
 assert.match(ui,/savePushSubscription\(subscription,true\)/);
 assert.match(ui,/await subscription\.unsubscribe\(\)/);
 assert.match(ui,/Notification\.permission==='granted'\)setupPush\(false\)/);
 assert.match(ui,/\['PUSH_HTTP_404','PUSH_HTTP_410'\]/);
 assert.match(ui,/localStorage\.getItem\('weex-push-active'\)/);
});

test('expired push endpoints are deleted rather than counted as active subscriptions',()=>{
 const subscribe=readFileSync(new URL('../api/push-subscribe.mjs',import.meta.url),'utf8');
 assert.match(subscribe,/if\(status===404\|\|status===410\)/);
 assert.match(subscribe,/await del\(path\)/);
});
test('RADAR home page browser script is valid JavaScript',async()=>{
 const {Script}=await import('node:vm');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const match=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(match,'missing main page script');
 assert.doesNotThrow(()=>new Script(match[1],{filename:'index.html'}));
});

test('ntfy sequence IDs deduplicate without depending on Chrome worker receipts',()=>{
 const dispatch=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const ntfy=readFileSync(new URL('../lib/ntfy-alerts.mjs',import.meta.url),'utf8');
 const subscribe=readFileSync(new URL('../api/push-subscribe.mjs',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 assert.match(ntfy,/sequenceForSignal\(kind,s\)/);
 assert.match(ntfy,/previous\.has\(id\)/);
 assert.match(ntfy,/await publishNtfy\(topic/);
 assert.match(dispatch,/deliveryMode:'ntfy-only'/);
 assert.doesNotMatch(dispatch,/subscriberId=key\(subscriber\.endpoint\)/);
 // Archived browser diagnostics still validate signatures when accessed manually.
 assert.match(subscribe,/deliveryId\+'\|'\+id\+'\|test'/);
 assert.match(worker,/subscriberId:msg\.subscriberId,kind:msg\.kind,result/);
});
