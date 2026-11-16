import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {forecastTopic} from '../lib/forecast-ntfy.mjs';
import {ntfySend} from '../lib/ntfy-alerts.mjs';
import {formatPhoneAlert} from '../lib/alert-presentation.mjs';
import {_test as safety} from '../api/signals.mjs';
import {
 forecastNotificationAllowed,
 PRIMARY_FORECAST_NOTIFICATION_SYMBOLS,
 RESEARCH_ONLY_FORECAST_NOTIFICATION_SYMBOLS
} from '../lib/forecast-notification-universe.mjs';

const now=()=>Date.now();
const candidate=(symbol,side='SHORT')=>({
 symbol,exchange:'WEEX',direction:side,level:'EARLY_WATCH',
 watchType:'PRE_BREAK',
 forecast:{mode:'PRE_BREAK_SCENARIO',direction:side,triggerPrice:99,
  invalidationPrice:101},
 livePrice:100,closePrice:100,
 candleCloseTime:now()-12000,expiresAt:now()+45000
});
async function captured(envValue,fn){
 const original=process.env.NTFY_TOPIC,previousFetch=globalThis.fetch,
  posts=[],reads=[];
 process.env.NTFY_TOPIC=envValue;
 globalThis.fetch=async(url,options={})=>{
  if(options.method!=='POST'){
   reads.push(url);
   return {ok:true,status:200,text:async()=>''};
  }
  const message=JSON.parse(options.body);
  posts.push(message);
  return {ok:true,status:200};
 };
 try{return await fn({posts,reads});}
 finally{
  globalThis.fetch=previousFetch;
  if(original===undefined)delete process.env.NTFY_TOPIC;
  else process.env.NTFY_TOPIC=original;
 }
}
test('32 markets unchanged; crypto16 + metals3 may notify, FX6 + equities7 cannot',()=>{
 assert.equal(safety.FORECAST_SYMBOLS.length,32);
 assert.equal(PRIMARY_FORECAST_NOTIFICATION_SYMBOLS.length,19);
 assert.equal(RESEARCH_ONLY_FORECAST_NOTIFICATION_SYMBOLS.length,13);
 for(const s of ['AMDUSDT','MSFTUSDT','EURUSDT','JPYUSDT','GOOGLUSDT'])
  assert.equal(forecastNotificationAllowed(s),false);
 for(const s of ['BTCUSDT','XRPUSDT','1000SHIBUSDT','XAUUSDT','XAGUSDT'])
  assert.equal(forecastNotificationAllowed(s),true);
});
test('PRE_BREAK 1m forecast from 32 scan sends ONLY eligible crypto/metals to EXISTING Forecast ntfy, not owner Radar',async()=>{
 const primary='wr-'+('a'.repeat(32));
 await captured(primary,async({posts,reads})=>{
  const signals=['AMDUSDT','MSFTUSDT','EURUSDT','BTCUSDT','XAUUSDT']
   .map(s=>candidate(s));
  const r=await ntfySend('early',signals);
  assert.equal(r.delivered,2);
  assert.equal(r.failed,0);
  assert.equal(posts.length,2);
  assert.deepEqual(posts.map(p=>p.title.match(/(?:BTCUSDT|XAUUSDT)/)?.[0]),['BTCUSDT','XAUUSDT']);
  assert.ok(posts.every(p=>p.topic===forecastTopic({NTFY_TOPIC:primary})));
  assert.ok(posts.every(p=>p.topic!==primary));
  assert.ok(reads.every(url=>url.includes(forecastTopic({NTFY_TOPIC:primary}))));
  assert.ok(posts.every(p=>p.message.includes('НЕ ВХОДИ')));
  assert.ok(posts.every(p=>!p.message.includes('WEEX\\nWEEX')));
 });
});
test('all 13 excluded symbols make ZERO forecast notifications, not a fallback to primary Radar',async()=>{
 const primary='wr-'+('b'.repeat(32));
 await captured(primary,async({posts})=>{
  const r=await ntfySend('early',RESEARCH_ONLY_FORECAST_NOTIFICATION_SYMBOLS.map(s=>candidate(s)));
  assert.equal(r.delivered,0);
  assert.equal(posts.length,0);
 });
});
test('confirmed 5m alert continues to use original WEEX Radar topic',async()=>{
 const primary='wr-'+('c'.repeat(32));
 await captured(primary,async({posts,reads})=>{
  const r=await ntfySend('confirmed',[{
   symbol:'BTCUSDT',exchange:'WEEX',direction:'LONG',level:'STRONG',
   livePrice:100,stop:97,take:105,
   candleCloseTime:now()-12000,expiresAt:now()+60000
  }]);
  assert.equal(r.delivered,1);
  assert.equal(posts.length,1);
  assert.equal(posts[0].topic,primary);
  assert.ok(reads.every(x=>x.includes(primary)));
 });
});
test('missing topic cannot send early forecast to Blob/old primary fallback',async()=>{
 const old=process.env.NTFY_TOPIC;
 const fetch0=globalThis.fetch;let calls=0;
 delete process.env.NTFY_TOPIC;
 globalThis.fetch=async()=>{calls++;throw Error('must not contact ntfy')};
 try{
  const r=await ntfySend('early',[candidate('BTCUSDT')]);
  assert.equal(r.enabled,false);
  assert.equal(r.delivered,0);
  assert.equal(calls,0);
 }finally{
  globalThis.fetch=fetch0;
  if(old!==undefined)process.env.NTFY_TOPIC=old;
 }
});
test('fix fully separates early forecast from 5m entry and leaves all32 source scan in place',()=>{
 const early=readFileSync(new URL('../lib/early-push.mjs',import.meta.url),'utf8');
 const main=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const topic=readFileSync(new URL('../lib/ntfy-forecast-topic.mjs',import.meta.url),'utf8');
 const ntfy=readFileSync(new URL('../lib/ntfy-alerts.mjs',import.meta.url),'utf8');
 assert.match(early,/scanEarlyMarkets\(undefined,undefined,metrics\)/);
 assert.match(early,/deliverableForecasts=forecasts\.filter\(x=>forecastNotificationAllowed\(x\.symbol\)\)/);
 assert.match(early,/ntfySend\('early',deliverableForecasts\.slice\(0,2\)\)/);
 assert.match(ntfy,/forecastTopic\(\{NTFY_TOPIC:directTopic\}\)/);
 assert.match(ntfy,/signals\.filter\(x=>forecastNotificationAllowed\(x\?\.symbol\)\)/);
 assert.match(main,/ntfySend\('confirmed',signals\)/);
 assert.match(topic,/weex-radar-forecast-topic-v1/);
 for(const s of [early,ntfy,topic]){
  assert.doesNotMatch(s,/\/capi\/v3\/order|trade-confirm|trade-prepare|WEEX_API_SECRET/);
 }
});
test('early forecast body does not repeat exchange WEEX, but legacy parse marker remains intact',()=>{
 const out=formatPhoneAlert(candidate('AMDUSDT'),{early:true,deadline:'19:02:00'});
 assert.match(out.title,/^🔮 ПРОГНОЗ · AMDUSDT/);
 assert.match(out.message,/WEEX · 📍 Сейчас:/);
 assert.doesNotMatch(out.message,/ПАДЕНИЕ · WEEX\nWEEX/u);
 assert.equal(out.message.split('WEEX').length-1,1);
});
