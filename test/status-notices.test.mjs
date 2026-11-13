import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {
 statusTopic,releaseRevision,statusOnboarding,decideStatusNotice,
 publishCronStatus,publishStaleStatus,STATUS_NOTICE_POLICY
} from '../lib/status-notices.mjs';
const base={NTFY_TOPIC:'wr-'+'a'.repeat(32),PUSH_CRON_KEY:'Z'.repeat(40),
 VERCEL_ENV:'production',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40)};
const now=Date.UTC(2026,10,13,9),bucket=Math.floor(now/(15*60000));
const heartbeat=(healthy=true,revision='aaaaaaaa')=>({
 at:now,bucket,healthy,revision,
 five:{total:32,weex:healthy?32:30,bybit:0,unavailable:healthy?0:2},
 early:{checked:32,failedMarkets:healthy?0:2}
});
const ndjson=(topic,rows)=>rows.map(x=>JSON.stringify({
 event:'message',topic,time:Math.floor(now/1000),...x
})).join('\n');

test('status topic is separate and keyed to TWO existing server secrets',()=>{
 const topic=statusTopic(base);
 assert.match(topic,/^wr-status-[a-f0-9]{32}$/);
 assert.notEqual(topic,base.NTFY_TOPIC);
 assert.notEqual(topic,statusTopic({...base,PUSH_CRON_KEY:'W'.repeat(40)}));
 assert.equal(statusTopic({}),null);
 assert.equal(releaseRevision(base),'aaaaaaaa');
 assert.equal(releaseRevision({...base,VERCEL_GIT_COMMIT_SHA:'NONE'}),null);
 assert.equal(STATUS_NOTICE_POLICY.noExtraCron,true);
 assert.equal(STATUS_NOTICE_POLICY.noOrders,true);
});

test('status distinguishes initial boot, deploy, degradation, recovery and quiet heartbeat',()=>{
 const good=heartbeat();
 const start=decideStatusNotice(null,good,[],now);
 assert.equal(start.kind,'STARTED');
 assert.match(start.title,/СТАТУС ПОДКЛЮЧЁН/);
 const bootBad=decideStatusNotice(null,heartbeat(false),[],now);
 assert.equal(bootBad.kind,'DEGRADED');
 assert.match(bootBad.title,/ОШИБКАМИ/);
 assert.equal(decideStatusNotice(good,good,[{title:'other'}],now)?.kind,'ALIVE');
 const notHour=now+15*60000;
 assert.equal(decideStatusNotice(good,good,[{title:'other'}],notHour),null);
 const changed=decideStatusNotice(good,heartbeat(true,'bbbbbbbb'),[{title:'other'}],notHour);
 assert.equal(changed.kind,'DEPLOYED');
 assert.equal(decideStatusNotice(good,heartbeat(false),[{title:'other'}],notHour).kind,'DEGRADED');
 assert.equal(decideStatusNotice(heartbeat(false),good,[{title:'other'}],notHour).kind,'RECOVERED');
 assert.equal(decideStatusNotice(good,good,[{title:'🚨 WEEX RADAR · CRON НЕ ОТВЕЧАЕТ'}],notHour).kind,'RECOVERED');
 const alive=decideStatusNotice(good,good,[{title:'other'}],now);
 const already=decideStatusNotice(good,good,[{sequence_id:alive.id,title:alive.title}],now);
 assert.equal(already,null);
});

test('status onboarding sends one private opt-in invitation only after readable history',async()=>{
 const sent=[];
 const fetchImpl=async(url,init)=>{
  if(init.method==='POST'){sent.push(JSON.parse(init.body));return {ok:true}}
  return {ok:true,text:async()=>sent.length?ndjson(base.NTFY_TOPIC,sent.map(s=>({
   title:s.title,sequence_id:s.sequence_id
  }))):''};
 };
 assert.equal(await statusOnboarding(false,base,fetchImpl),true);
 assert.equal(sent.length,1);
 assert.equal(sent[0].topic,base.NTFY_TOPIC);
 assert.match(sent[0].click,/^ntfy:\/\/ntfy.sh\/wr-status-/);
 assert.equal(await statusOnboarding(false,base,fetchImpl),true);
 assert.equal(await statusOnboarding(true,base,fetchImpl),true);
 assert.equal(sent.length,1);
 assert.doesNotMatch(sent[0].title,/LONG|SHORT/);
 assert.equal(sent[0].priority,3);
 await assert.rejects(statusOnboarding(false,base,async()=>{throw Error('relay offline')}));
});

test('separate notification channel is idempotent and preview cannot send',async()=>{
 let posts=[];
 const fetchImpl=async(_,init)=>{
  if(init.method==='POST'){posts.push(JSON.parse(init.body));return {ok:true}}
  return {ok:true,text:async()=>ndjson(statusTopic(base),posts.map(m=>({
   title:m.title,sequence_id:m.sequence_id
  })))};
 };
 const r=await publishCronStatus({previous:null,current:heartbeat(),now,env:base,fetchImpl});
 assert.equal(r.kind,'STARTED');
 assert.equal(posts.length,1);
 assert.equal(posts[0].topic,statusTopic(base));
 assert.equal(posts[0].priority,3);
 const repeat=await publishCronStatus({previous:null,current:heartbeat(),now,env:base,fetchImpl});
 assert.equal(repeat.action,'no-change');
 assert.equal(posts.length,1);
 const preview=await publishCronStatus({previous:null,current:heartbeat(),now,
  env:{...base,VERCEL_ENV:'preview'},fetchImpl});
 assert.equal(preview.action,'disabled');
 assert.equal(posts.length,1);
});

test('GitHub stale backup sends only separate STATUS warnings with 90m cooldown',async()=>{
 let posts=[],staleTime=now-40*60000;
 const fetchImpl=async(_,init)=>{
  if(init.method==='POST'){posts.push(JSON.parse(init.body));return {ok:true}}
  return {ok:true,text:async()=>ndjson(statusTopic(base),posts.map(m=>({
   title:m.title,sequence_id:m.sequence_id
  })))};
 };
 const r=await publishStaleStatus({heartbeat:{at:staleTime},
  now,env:base,fetchImpl});
 assert.equal(r.kind,'CRON_STALE');
 assert.equal(posts.length,1);
 assert.equal(posts[0].topic,statusTopic(base));
 assert.equal((await publishStaleStatus({heartbeat:{at:staleTime},
  now,env:base,fetchImpl})).action,'cooldown');
 assert.equal(posts.length,1);
 assert.equal((await publishStaleStatus({heartbeat:{at:now-5*60000},
  now,env:base,fetchImpl})).action,'not-stale');
 assert.equal(posts.length,1);
});

test('production health page renders version without revealing private status topic',()=>{
 const route=readFileSync(new URL('../lib/health-route.mjs',import.meta.url),'utf8');
 const html=readFileSync(new URL('../health.html',import.meta.url),'utf8');
 const monitor=readFileSync(new URL('../lib/health-monitor.mjs',import.meta.url),'utf8');
 const dispatch=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 assert.match(route,/statusNotifications:/);
 assert.match(html,/id="version-card"/);
 assert.match(html,/setInterval\(/);
 assert.match(monitor,/publishCronStatus/);
 assert.match(monitor,/publishStaleStatus/);
 assert.doesNotMatch(dispatch,/statusTopic|releaseRevision|statusOnboarding/);
 assert.doesNotMatch(route,/topic:statusTopic\(\)/);
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
});
