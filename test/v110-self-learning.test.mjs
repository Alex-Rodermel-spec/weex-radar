import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateV110Learning,V110_LEARNING_POLICY} from '../lib/v110-self-learning.mjs';
const H=3600000,DAY=86400000;
const NOW=Date.UTC(2026,10,13,2,0,0);
function samples(n=240,{reversedHoldout=false}={}){
 return Array.from({length:n},(_,i)=>{
  const standard=i%2===0;
  const reversed=reversedHoldout&&i>=Math.floor(n*0.7);
  const favored=reversed?!standard:standard;
  const move=favored?20:-20;
  return {id:i.toString(16).padStart(32,'0'),symbol:'BTCUSDT',
   direction:'LONG',strength:standard?'STANDARD':'CAUTION',
   v2Timing:standard?'CLEAR':null,preMove5mBps:standard?0:22,
   sentAt:NOW-(n-i+1)*H,
   windows:{15:{status:'OBSERVED',moveBps:move},
    30:{status:'OBSERVED',moveBps:move}}};
 });
}
test('not enough real closed forecasts -> fail closed, no fabricated model',()=>{
 const r=evaluateV110Learning(samples(30),NOW);
 assert.equal(r.status,'INSUFFICIENT_DATA');
 assert.equal(r.recommendation,'KEEP_108');
 assert.equal(r.ordersSent,0);
});
test('select on chronological training; independent holdout can accept for OWNER REVIEW only',()=>{
 const result=evaluateV110Learning(samples(),NOW);
 assert.equal(result.status,'SHADOW_CANDIDATE_PASSED');
 assert.equal(result.recommendation,'OWNER_REVIEW_REQUIRED');
 assert.equal(result.holdoutBaseline.favorablePct,50);
 assert.equal(result.holdoutCandidate.favorablePct,100);
 assert.ok(result.holdoutCandidate.n>=25);
 assert.ok(result.trainN>result.holdoutN);
 assert.equal(result.liveChanges,0);
 assert.equal(result.requiresOwnerApproval,true);
});
test('regime reversal in UNSEEN holdout rejects model, without auto-retraining on holdout',()=>{
 const result=evaluateV110Learning(samples(240,{reversedHoldout:true}),NOW);
 assert.equal(result.status,'HOLDOUT_REJECTED');
 assert.equal(result.recommendation,'KEEP_108');
 assert.ok(result.holdoutCandidate.favorablePct<result.holdoutBaseline.favorablePct);
});
test('missing or future windows never count as success, duplicates cannot inflate sample',()=>{
 const list=samples(40),bad=list.map(x=>({...x,id:x.id}));
 bad[0].windows={15:{status:'PENDING',moveBps:999},30:{status:'PENDING',moveBps:999}};
 bad[1].sentAt=NOW-10*60000;
 const result=evaluateV110Learning([...list,...bad],NOW);
 assert.ok(result.eligible<=40);
 assert.equal(result.status,'INSUFFICIENT_DATA');
});
test('uses existing encrypted forecast journal and cannot trade or change main',()=>{
 const route=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
 const learner=readFileSync(new URL('../lib/v110-self-learning.mjs',import.meta.url),'utf8');
 assert.match(route,/evaluateV110Learning\(forecastRows,now\)/);
 assert.match(route,/mode==='journal'/);
 assert.match(learner,/OWNER_REVIEW_REQUIRED/);
 assert.equal(V110_LEARNING_POLICY.changesLiveSignals,false);
 assert.equal(V110_LEARNING_POLICY.extraMarketRequests,0);
 for(const s of ['placeOrder','trade-confirm','trade-prepare','push-dispatch',
  'publishNtfy','eval(','Function(','@vercel/blob','NTFY_TOPIC=']){
  assert.ok(!learner.includes(s),s+' must not appear in learning code');
 }
});
