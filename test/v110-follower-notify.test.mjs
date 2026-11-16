import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {profileSymbols,marketForecastProfile} from '../lib/market-forecast-profiles.mjs';
import {summarizeV110CryptoFollowers} from '../lib/v110-crypto-followers-shadow.mjs';
import {
 followerTopic,followerNotice,sendV110FollowerNotices,
 V110_FOLLOWER_NOTICE_POLICY
} from '../lib/v110-follower-notify.mjs';
import {runForecastNotifications,forecastTopic} from '../lib/forecast-ntfy.mjs';
import {_test as marketSafety} from '../api/signals.mjs';

const M=60000,F=5*M,NOW=Date.UTC(2026,10,16,17,40,30);
const cryptos=profileSymbols().filter(s=>
 marketForecastProfile(s)?.group.endsWith('CRYPTO'));
const env={NTFY_TOPIC:'wr-'+('f'.repeat(32)),VERCEL_ENV:'production'};
const snapshot=(symbol,i,side='LONG')=>{
 const close=Math.floor((NOW-1000)/F)*F;
 return {
  symbol,exchange:'WEEX',available:true,alignment:'MIXED_OR_CONFLICT',
  timeframes:[
   {intervalMinutes:1,closedAt:Math.floor((NOW-1000)/M)*M,
    price:1+i*.1,direction:'NEUTRAL'},
   {intervalMinutes:5,closedAt:close,
    lastCandleBodyBps:i<6?(side==='LONG'?18:-18):0,direction:'NEUTRAL'},
   {intervalMinutes:10,closedAt:Math.floor((NOW-1000)/(2*F))*2*F,
    direction:'NEUTRAL'}
  ]
 };
};
const scan=(side='LONG')=>summarizeV110CryptoFollowers(
 cryptos.map((s,i)=>snapshot(s,i,side)),NOW);
const emptyHistory=async()=>({ok:true,status:200,text:async()=>''});
const opts=(publish,fetchImpl=emptyHistory)=>({
 env,now:NOW,clock:()=>NOW,fetchImpl,publish
});
test('follower gets independent private derived ntfy topic, different from primary/forecast',()=>{
 const topic=followerTopic(env);
 assert.match(topic,/^wr-[a-f0-9]{32}$/);
 assert.notEqual(topic,env.NTFY_TOPIC);
 assert.notEqual(topic,forecastTopic(env));
 assert.notEqual(followerTopic({...env,NTFY_TOPIC:'wr-'+('a'.repeat(32))}),topic);
 assert.equal(followerTopic({VERCEL_ENV:'production'}),null);
 assert.equal(V110_FOLLOWER_NOTICE_POLICY.minLeaders,6);
 assert.equal(V110_FOLLOWER_NOTICE_POLICY.maxMessagesPer30Minutes,1);
 assert.equal(V110_FOLLOWER_NOTICE_POLICY.holdoutEdgeProven,false);
 assert.equal(V110_FOLLOWER_NOTICE_POLICY.noOrders,true);
});
test('6 leaders + quiet crypto produce ONE clearly labeled separate research watch',async()=>{
 const notices=[],candidates=scan('LONG').candidates;
 const r=await sendV110FollowerNotices(candidates,opts(async(t,m)=>{
  notices.push({topic:t,...m});
 }));
 assert.equal(candidates.length,10);
 assert.equal(r.eligible,10);
 assert.equal(r.delivered,1);
 assert.equal(r.ordersSent,0);
 assert.equal(notices.length,1);
 assert.equal(notices[0].topic,followerTopic(env));
 assert.match(notices[0].title,/ВОЗМОЖНАЯ ДОГОНЯЮЩАЯ.*LONG\?/u);
 assert.match(notices[0].message,/НЕ СИГНАЛ ВХОДА/);
 assert.match(notices[0].message,/через 5 \/ 10 \/ 15 минут/);
 assert.match(notices[0].message,/6 криптовалют/);
 assert.doesNotMatch(notices[0].message,/\b(?:SL|TP|плечо|КУПИТЬ)\b/);
 assert.equal(notices[0].priority,3);
 assert.match(notices[0].sequenceId,/^[a-f0-9]{32}$/);
 assert.equal(followerNotice(candidates[0]).sequenceId,notices[0].sequenceId);
});
test('SHORT direction clearly marked, no false confirmed entry',async()=>{
 const messages=[];
 const r=await sendV110FollowerNotices(scan('SHORT').candidates,opts(async(t,m)=>{
  messages.push(m);
 }));
 assert.equal(r.delivered,1);
 assert.match(messages[0].title,/🟥 SHORT\?/);
 assert.match(messages[0].message,/двигались вниз/);
 assert.match(messages[0].message,/НЕ СИГНАЛ ВХОДА/);
});
test('ntfy history enforces max one hypothesis in 30m and prevents retried alerts',async()=>{
 const first=scan().candidates;
 const id=followerNotice(first[0]).sequenceId,topic=followerTopic(env);
 let publishes=0;
 const recentlySent=async()=>({ok:true,status:200,text:async()=>JSON.stringify({
  event:'message',topic,sequence_id:id,time:Math.floor(NOW/1000)
 })+'\n'});
 const r=await sendV110FollowerNotices(first,opts(async()=>{publishes++},recentlySent));
 assert.equal(r.delivered,0);
 assert.equal(r.cooldown,1);
 assert.equal(publishes,0);
});
test('history unavailable or too large fails CLOSED and does not send',async()=>{
 const candidates=scan().candidates;
 for(const get of [async()=>{throw Error('offline')},
  async()=>({ok:false,status:503}),
  async()=>({ok:true,status:200,text:async()=>'*'.repeat(120001)})]){
  let sent=0;
  const r=await sendV110FollowerNotices(candidates,opts(async()=>{sent++},get));
  assert.equal(r.delivered,0);
  assert.equal(r.failed,1);
  assert.equal(sent,0);
 }
});
test('preview, missing owner topic, fewer leaders, old or mismatched candidates send NOTHING',async()=>{
 const candidates=scan().candidates;
 let sent=0,fetches=0;
 const reader=async()=>{fetches++;return {ok:true,text:async()=>''}};
 const publisher=async()=>{sent++};
 const preview=await sendV110FollowerNotices(candidates,{
  ...opts(publisher,reader),env:{...env,VERCEL_ENV:'preview'}
 });
 assert.equal(preview.enabled,false);
 assert.equal(fetches,0);
 const insufficient=summarizeV110CryptoFollowers(
  cryptos.map((s,i)=>({...snapshot(s,i),
   timeframes:[snapshot(s,i).timeframes[0],
    {...snapshot(s,i).timeframes[1],lastCandleBodyBps:i<5?18:0},
    snapshot(s,i).timeframes[2]]})),NOW).candidates;
 assert.equal(insufficient.length,0);
 const empty=await sendV110FollowerNotices(insufficient,opts(publisher,reader));
 assert.equal(empty.delivered,0);
 const old=await sendV110FollowerNotices(candidates,{
  ...opts(publisher,reader),now:NOW+10*M,clock:()=>NOW+10*M
 });
 assert.equal(old.delivered,0);
 const corrupt=await sendV110FollowerNotices(
  [{...candidates[0],leaderCount:0}],opts(publisher,reader));
 assert.equal(corrupt.delivered,0);
 assert.equal(fetches,0);
 assert.equal(sent,0);
});
test('one existing 16-crypto 10m scan remains research-only; follower topic is independent',async()=>{
 const snapshots=cryptos.map((s,i)=>snapshot(s,i));
 const map=new Map(snapshots.map(s=>[s.symbol,s]));
 const sent=[];
 const r=await runForecastNotifications({
  env,now:NOW,clock:()=>NOW,
  symbols:marketSafety.FORECAST_SYMBOLS,
  reader:async symbol=>map.get(symbol)||null,
  fetchImpl:emptyHistory,
  publish:async(topic,message)=>{sent.push({topic,...message})},
  depthCapture:async()=>null
 });
 assert.equal(r.scanned,32);
 assert.equal(r.leaderFollowerResearch.status,'HYPOTHESES_FROZEN');
 assert.equal(r.leaderFollowerResearch.candidateCount,10);
 assert.equal(r.followerNotices.delivered,1);
 assert.equal(r.delivered,0,'regular forecast flow did not falsely treat a lagger as 3TF aligned');
 const followerSent=sent.filter(x=>x.topic===followerTopic(env));
 const ownerInvites=sent.filter(x=>x.topic===env.NTFY_TOPIC);
 assert.equal(followerSent.length,1);
 assert.equal(ownerInvites.length,1,'one-tap invitation is distinct from research watch');
 assert.equal(followerSent[0].topic,followerTopic(env));
 assert.notEqual(followerSent[0].topic,forecastTopic(env));
 assert.notEqual(followerSent[0].topic,env.NTFY_TOPIC);
 assert.equal(r.ordersSent,0);
});
test('source and opt-in page preserve all trade paths and expose no server secrets',()=>{
 const source=readFileSync(new URL('../lib/v110-follower-notify.mjs',import.meta.url),'utf8');
 const workflow=readFileSync(new URL('../.github/workflows/push-notifications.yml',import.meta.url),'utf8');
 const dispatcher=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const page=readFileSync(new URL('../forecast.html',import.meta.url),'utf8');
 const script=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);assert.doesNotThrow(()=>new Script(script[1]));
 assert.match(page,/id="subscribe-follower"/);
 assert.match(page,/id="follower-base-topic"/);
 assert.match(page,/weex-radar-follower-topic-v1/);
 assert.match(page,/НЕ сигнал входа/);
 assert.match(dispatcher,/ntfySend\('confirmed',signals\)/);
 assert.match(workflow,/cron: '2-59\/5 \* \* \* \*'/);
 for(const forbidden of ['placeOrder(', 'trade-confirm', 'trade-prepare',
  '/capi/v3/order','WEEX_API_SECRET','@vercel/blob']){
  assert.equal(source.includes(forbidden),false,forbidden);
 }
});
