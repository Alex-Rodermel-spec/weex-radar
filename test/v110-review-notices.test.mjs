import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 V110_REVIEW_NOTICE_POLICY,selectV110ReviewProposal,
 formatV110ReviewProposal,notifyV110Review
} from '../lib/v110-review-notices.mjs';
import {statusTopic} from '../lib/status-notices.mjs';

const env={NTFY_TOPIC:'wr-'+'a'.repeat(32),
 PUSH_CRON_KEY:'D'.repeat(40),VERCEL_ENV:'production'};
const shadow={
 status:'SHADOW_CANDIDATE_PASSED',recommendation:'OWNER_REVIEW_REQUIRED',
 readyForLivePromotion:false,chosenOnTrainingOnly:'AVOID_CAUTION',
 trainN:180,holdoutN:70,
 holdoutBaseline:{favorablePct:45,meanBps:1},
 holdoutCandidate:{n:38,favorablePct:54,meanBps:6}
};
const depth={
 status:'DEPTH_SHADOW_CANDIDATE_PASSED',recommendation:'OWNER_REVIEW_REQUIRED',
 forwardUntouchedHoldoutRequired:true,selectedPolicy:'DIRECTIONAL_PRESSURE_GE_12',
 eligible:250,trainN:175,holdoutN:75,
 baselineHoldout:{favorable15mPct:43,mean15mBps:0},
 candidateHoldout:{n:32,favorable15mPct:51,mean15mBps:3}
};
test('strong internal candidate is proposed for prospective testing, never live auto-promotion',()=>{
 const p=selectV110ReviewProposal(shadow,null);
 assert.equal(p.kind,'FORECAST_SHADOW');
 assert.equal(p.candidateN,38);
 assert.equal(p.candidatePct,54);
 const notice=formatV110ReviewProposal(p);
 assert.match(notice.title,/КАНДИДАТ НА ПРОВЕРКУ/);
 assert.match(notice.message,/НЕ доказанная прибыль/);
 assert.match(notice.message,/ручное одобрение/);
 assert.match(notice.message,/№108.*НЕ изменены/);
 assert.equal(V110_REVIEW_NOTICE_POLICY.noAutomaticLiveChanges,true);
 assert.equal(V110_REVIEW_NOTICE_POLICY.noOrders,true);
});
test('failed/weak/negative samples never notify as improvement',()=>{
 for(const change of [
  {status:'NO_TRAINING_IMPROVEMENT'},
  {recommendation:'KEEP_108'},
  {readyForLivePromotion:true},
  {holdoutN:10},
  {holdoutCandidate:{n:8,favorablePct:64,meanBps:6}},
  {holdoutCandidate:{n:38,favorablePct:49,meanBps:6}},
  {holdoutCandidate:{n:38,favorablePct:54,meanBps:-1}},
  {chosenOnTrainingOnly:'NOT_A_FILTER'}
 ]){
  assert.equal(selectV110ReviewProposal({...shadow,...change},null),null);
 }
 assert.equal(selectV110ReviewProposal(null,{...depth,
  status:'INSUFFICIENT_PAIRED_DEPTH'}),null);
 assert.equal(selectV110ReviewProposal(null,depth)?.kind,'DEPTH_SHADOW');
});
test('only the existing private STATUS topic is used, not LONG/SHORT or FORECAST',async()=>{
 const posts=[],seen=[];
 const fetchImpl=async(url,options)=>{
  seen.push([url,options.method||'GET']);
  if(options.method==='POST'){
   posts.push(JSON.parse(options.body));return {ok:true};
  }
  return {ok:true,text:async()=>posts.map(x=>JSON.stringify({
   event:'message',topic:statusTopic(env),time:1794547200,
   sequence_id:x.sequence_id})).join('\n')};
 };
 const first=await notifyV110Review({learning:shadow,env,fetchImpl});
 assert.equal(first.action,'sent');
 assert.equal(posts.length,1);
 assert.equal(posts[0].topic,statusTopic(env));
 assert.notEqual(posts[0].topic,env.NTFY_TOPIC);
 assert.equal(posts[0].click,'https://weex-radar.vercel.app/forecast.html');
 assert.equal(posts[0].priority,3);
 assert.equal((await notifyV110Review({learning:shadow,env,fetchImpl})).action,
  'already-notified');
 assert.equal(posts.length,1);
 assert.equal(seen.filter(x=>x[1]==='POST').length,1);
});
test('no qualified candidate, no secrets or preview means no network',async()=>{
 const nope=async()=>{throw Error('SHOULD_NOT_FETCH')};
 assert.equal((await notifyV110Review({learning:{
  status:'NO_TRAINING_IMPROVEMENT',recommendation:'KEEP_108'
 },env,fetchImpl:nope})).action,'no-qualified-candidate');
 assert.equal((await notifyV110Review({learning:shadow,
  env:{...env,VERCEL_ENV:'preview'},fetchImpl:nope})).action,'disabled-preview');
 assert.equal((await notifyV110Review({learning:shadow,env:{},
  fetchImpl:nope})).action,'disabled-preview');
 await assert.rejects(notifyV110Review({learning:shadow,env,fetchImpl:async()=>({
  ok:false})}),/REVIEW_HISTORY_UNAVAILABLE/);
});
test('journal re-checks prior encrypted cohort and isolates alerts from persistence',()=>{
 const route=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
 const notice=readFileSync(new URL('../lib/v110-review-notices.mjs',import.meta.url),'utf8');
 assert.match(route,/notifyV110Review/);
 assert.match(route,/previousShadow\.recommendation!=='OWNER_REVIEW_REQUIRED'/);
 assert.match(route,/previousDepth\.recommendation!=='OWNER_REVIEW_REQUIRED'/);
 assert.match(route,/catch\(e\)\{\s*console\.warn\('WEEX_RADAR_V110_REVIEW_UNAVAILABLE/);
 assert.match(route,/encryptJournal\(/);
 assert.doesNotMatch(notice,/placeOrder|trade-confirm|trade-prepare|NTFY_TOPIC\s*=|PUSH_CRON_KEY\s*=/);
 assert.doesNotMatch(notice,/github\.com\/.*\/pulls\//);
});
