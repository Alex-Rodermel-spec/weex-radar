import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const src=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const dispatcher=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');

async function renderNotification(msg,now=Date.now()){
 const events=new Map(),notifications=[];
 const self={
  addEventListener:(name,cb)=>events.set(name,cb),
  skipWaiting:async()=>{},
  clients:{claim:async()=>{}},
  registration:{showNotification:async(title,options)=>{notifications.push({title,options});}},
 };
 runInNewContext(src,{self,Date:{now:()=>now},fetch:async()=>({ok:true})});
 const waits=[];
 events.get('push')({data:{json:()=>msg},waitUntil:promise=>waits.push(promise)});
 await Promise.all(waits);
 return notifications;
}
function sample(now){
 return {title:'Сигнал SUIUSDT SHORT',body:'WEEX · цена сейчас 0.853450 USDT',
   kind:'signal',sentAt:now-1000,candleCloseTime:now-30000,
   expiresAt:now+120000,symbol:'SUIUSDT',direction:'SHORT'};
}

test('normal confirmed alerts remain clearly labeled',async()=>{
 const now=Date.now(),notices=await renderNotification(sample(now),now);
 assert.equal(notices.length,1);
 assert.equal(notices[0].title,'Сигнал SUIUSDT SHORT');
 assert.doesNotMatch(notices[0].options.body,/задержк|актуальную цену/i);
});
test('delayed alerts warn before the user can consider entry',async()=>{
 const now=Date.now();
 const notices=await renderNotification({...sample(now),sentAt:now-65000,candleCloseTime:now-95000},now);
 assert.equal(notices.length,1);
 assert.match(notices[0].title,/ПОЗДНИЙ СИГНАЛ/);
 assert.match(notices[0].options.body,/Проверь актуальную цену/);
});
test('late delivery by candle age is also flagged even if gateway was quick',async()=>{
 const now=Date.now();
 const notices=await renderNotification({...sample(now),candleCloseTime:now-100000},now);
 assert.equal(notices.length,1);
 assert.match(notices[0].title,/ПОЗДНИЙ СИГНАЛ/);
});
test('expired alerts still stay hidden',async()=>{
 const now=Date.now();
 const notices=await renderNotification({...sample(now),sentAt:now-70000,expiresAt:now-1},now);
 assert.equal(notices.length,0);
});
test('ntfy messages keep candle, sent time and lag; historical Chrome receipts remain visible',()=>{
 const ntfy=readFileSync(new URL('../lib/ntfy-alerts.mjs',import.meta.url),'utf8');
 assert.match(ntfy,/const stampedAt=Date\.now\(\)/);
 assert.match(ntfy,/задержка '\+lagSec\+'с/);
 assert.match(dispatcher,/ntfySend\('confirmed',signals\)/);
 assert.match(page,/Math\.round\(\(s\.workerAt-s\.at\)\/1000\)/);
 assert.match(page,/Доставка запоздала/);
});
