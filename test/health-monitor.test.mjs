import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {HEARTBEAT_MS,STALE_MS,ALERT_COOLDOWN_MS,monitorTopic,
 shouldHeartbeat,snapshotMarkets,assessHeartbeat,monitorDispatch} from '../lib/health-monitor.mjs';

const env={NTFY_TOPIC:'wr-'+'a'.repeat(32),PUSH_CRON_KEY:'B'.repeat(42)};
const healthTopic=monitorTopic(env);
const now=HEARTBEAT_MS*100000+30_000;
const sample={total:16,weex:16,bybit:0,unavailable:0};
const activeEarly={checked:16,failedMarkets:0,ntfy:{failed:0}};
const data=(at,overrides={})=>({v:1,source:'cron',at,bucket:Math.floor(at/HEARTBEAT_MS),
 http:200,five:sample,early:{checked:16,failedMarkets:0},ntfyFailed:false,
 healthy:true,...overrides});
const ndjson=(topic,messages=[])=>messages.map(message=>
 JSON.stringify({event:'message',topic,...message})).join('\n');

test('health topic is non-public derived from existing TWO server secrets',()=>{
 assert.match(healthTopic,/^wr-health-[a-f0-9]{32}$/);
 assert.notEqual(healthTopic,env.NTFY_TOPIC);
 assert.notEqual(monitorTopic({...env,NTFY_TOPIC:'wr-'+'b'.repeat(32)}),healthTopic);
 assert.notEqual(monitorTopic({...env,PUSH_CRON_KEY:'C'.repeat(42)}),healthTopic);
 assert.equal(monitorTopic({}),null);
 assert.equal(HEARTBEAT_MS,900000);
 assert.equal(STALE_MS,35*60000);
 assert.equal(ALERT_COOLDOWN_MS,90*60000);
});

test('market health distinguishes WEEX, backup Bybit, and missing sources',()=>{
 assert.deepEqual(snapshotMarkets([{exchange:'WEEX',status:'ok'},
  {exchange:'Bybit',status:'ok'},{exchange:null,status:'error'}]),
 {total:3,weex:1,bybit:1,unavailable:1});
 assert.equal(assessHeartbeat(null,now).state,'UNKNOWN');
 assert.equal(assessHeartbeat(data(now-1000),now).state,'OK');
 assert.equal(assessHeartbeat(data(now-60000,{healthy:false}),now).state,'DEGRADED');
 assert.equal(assessHeartbeat(data(now-STALE_MS-1),now).state,'STALE');
 assert.equal(assessHeartbeat(data(now+10000),now).state,'UNKNOWN');
});

test('cron writes a quiet 15-minute heartbeat ONLY ONCE per bucket',async()=>{
 assert.equal(shouldHeartbeat(now),true);
 assert.equal(shouldHeartbeat(now+160000),false);
 let sent=[],stored=null;
 const mock=async(url,init)=>{
  if(init.method==='POST'){
   const body=JSON.parse(init.body);sent.push(body);
   stored={time:Math.floor(now/1000),message:body.message,title:body.title};
   return {ok:true};
  }
  assert.match(url,/poll=1&since=latest/);
  return {ok:true,text:async()=>stored?ndjson(healthTopic,[stored]):''};
 };
 const args={source:'cron',http:200,markets:sample,early:activeEarly,
  ntfy:{failed:0},now,fetchImpl:mock,env};
 const first=await monitorDispatch(args);
 const second=await monitorDispatch(args);
 assert.equal(first.action,'recorded');
 assert.equal(second.action,'already-sent');
 assert.equal(sent.length,1);
 assert.equal(sent[0].topic,healthTopic);
 assert.equal(sent[0].priority,1);
 assert.equal(JSON.parse(sent[0].message).healthy,true);
 assert.doesNotMatch(JSON.stringify(sent),new RegExp(env.PUSH_CRON_KEY));
 assert.doesNotMatch(JSON.stringify(sent),new RegExp(env.NTFY_TOPIC));
});

test('zero trading signals do not mark a successful scanner unhealthy',async()=>{
 let posted;
 const mock=async(_,init)=>init.method==='POST'?
  (posted=JSON.parse(init.body),{ok:true}):
  {ok:true,text:async()=>''};
 const status=await monitorDispatch({source:'cron',http:200,markets:sample,
  early:activeEarly,ntfy:{enabled:false,delivered:0,failed:0},
  now,fetchImpl:mock,env});
 assert.equal(status.healthy,true);
 assert.equal(JSON.parse(posted.message).ntfyFailed,false);
});

test('GitHub backup warns ONLY on known stale cron and deduplicates alerts',async()=>{
 const previousFetch=globalThis.fetch;
 const previousTopic=process.env.NTFY_TOPIC;
 process.env.NTFY_TOPIC=env.NTFY_TOPIC;
 const last=data(now-STALE_MS-90000);
 let alert=null,publishes=0;
 const mock=async(url,init)=>{
  if(init.method==='POST'){
   const body=JSON.parse(init.body);assert.equal(body.topic,env.NTFY_TOPIC);
   assert.match(body.title,/CRON НЕ ОТВЕЧАЕТ/);
   publishes++;
   alert={title:body.title,time:Math.floor(now/1000)};
   return {ok:true};
  }
  if(String(url).includes(healthTopic)){
   return {ok:true,text:async()=>ndjson(healthTopic,[{time:Math.floor(last.at/1000),message:JSON.stringify(last)}])};
  }
  return {ok:true,text:async()=>alert?ndjson(env.NTFY_TOPIC,[alert]):''};
 };
 globalThis.fetch=mock;
 try{
  const args={source:'github',http:200,markets:sample,early:activeEarly,
   ntfy:{failed:0},now,fetchImpl:mock,env};
  assert.equal((await monitorDispatch(args)).action,'alert-sent');
  assert.equal((await monitorDispatch(args)).action,'alert-cooldown');
  assert.equal(publishes,1);
  const unknown=async(url)=>({ok:true,text:async()=>''});
  assert.equal((await monitorDispatch({...args,fetchImpl:unknown})).action,'not-enough-evidence');
 }finally{
  globalThis.fetch=previousFetch;
  if(previousTopic===undefined)delete process.env.NTFY_TOPIC;
  else process.env.NTFY_TOPIC=previousTopic;
 }
});

test('only GET diagnostics, no new serverless functions, and no trading route',()=>{
 const signals=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const dispatch=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const health=readFileSync(new URL('../lib/health-route.mjs',import.meta.url),'utf8');
 const early=readFileSync(new URL('../lib/early-push.mjs',import.meta.url),'utf8');
 const page=readFileSync(new URL('../health.html',import.meta.url),'utf8');
 const home=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(signals,/mode==='health'/);
 assert.match(signals,/return handleHealth\(req,res,scanAll\)/);
 assert.match(dispatch,/monitorDispatch\(/);
 assert.match(dispatch,/WEEX_RADAR_HEALTH_CHECK_FAILED/);
 assert.match(health,/method!=='GET'/);
 assert.match(early,/metrics\.failedMarkets=failedMarkets/);
 assert.match(home,/href="\/health\.html"/);
 assert.match(page,/\/api\/signals\?mode=health/);
 const script=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1],{filename:'health.html'}));
 assert.doesNotMatch(health,/trade-confirm|\/capi\/v3\/order|WEEX_API_SECRET|@vercel\/blob/);
});
