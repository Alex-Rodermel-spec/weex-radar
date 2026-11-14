import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateV110FixedForwardStudy,V110_FORWARD_POLICY}
 from '../lib/v110-forward-study.mjs';
const DAY=86400000,MIN=60000;
const START=Date.parse(V110_FORWARD_POLICY.startUTC);
const END=Date.parse(V110_FORWARD_POLICY.endExclusiveUTC);
const NOW=END+45*MIN;
function records(reverse=false){
 const rows=[];
 for(let d=0;d<4;d++)for(let i=0;i<48;i++){
  const included=i%2===0;
  const good=reverse?!included:included;
  const m=good?45:-45;
  rows.push({
   id:rows.length.toString(16).padStart(32,'0'),
   symbol:['BTCUSDT','XRPUSDT','ETHUSDT'][i%3],
   sentAt:START+d*DAY+i*30*MIN,
   direction:'LONG',strength:included?'STANDARD':'CAUTION',
   preMove5mBps:included?1:15,
   windows:{15:{status:'OBSERVED',moveBps:m},
    30:{status:'OBSERVED',moveBps:m}}
  });
 }
 return rows;
}
test('fixed preregistered future study does not recommend live deployment',()=>{
 const v=evaluateV110FixedForwardStudy(records(),NOW);
 assert.equal(v.status,'FORWARD_PRICE_AND_COST_PROXY_PASSED');
 assert.equal(v.modeledCosts.candidateNormalNetBpsProxy,23);
 assert.equal(v.modeledCosts.candidateStressNetBpsProxy,13);
 assert.equal(v.baseline.n,192);
 assert.equal(v.candidate.n,96);
 // Four rolling 24-hour periods may cross five distinct UTC calendar dates.
 assert.equal(v.days,new Set(records().map(r=>new Date(r.sentAt).toISOString().slice(0,10))).size);
 assert.equal(v.candidate.favorable15mPct,100);
 assert.equal(v.baseline.favorable15mPct,50);
 assert.equal(v.noLiveChanges,true);
 assert.equal(v.ordersSent,0);
 assert.equal(v.approvedForLive,false);
 assert.equal(v.recommendation,'OWNER_REVIEW_EXECUTION_EVIDENCE_STILL_REQUIRED');
});
test('losing prospectively fixed policy is rejected rather than retuned',()=>{
 const v=evaluateV110FixedForwardStudy(records(true),NOW);
 assert.equal(v.status,'FORWARD_SCREEN_REJECTED');
 assert.equal(v.recommendation,'KEEP_108');
 assert.equal(v.approvedForLive,false);
});
test('positive directional results still FAIL modeled fee/slippage stress',()=>{
 const x=records().map(r=>({
  ...r,windows:{15:{status:'OBSERVED',moveBps:r.strength==='STANDARD'?22:-22},
   30:{status:'OBSERVED',moveBps:r.strength==='STANDARD'?22:-22}}
 }));
 const study=evaluateV110FixedForwardStudy(x,NOW);
 assert.equal(study.favorableLiftPct,50);
 assert.equal(study.status,'FORWARD_COST_PROXY_REJECTED');
 assert.equal(study.recommendation,'KEEP_108');
 assert.equal(study.modeledCosts.modeledRoundTripBps,22);
 assert.equal(study.modeledCosts.modeledStressRoundTripBps,32);
 assert.equal(study.modeledCosts.candidateNormalNetBpsProxy,0);
 assert.equal(study.modeledCosts.candidateStressNetBpsProxy,-10);
 assert.equal(study.approvedForLive,false);
});
test('do not claim a pass on partial days or early favorable results',()=>{
 assert.equal(evaluateV110FixedForwardStudy(records(),START-MIN).status,'NOT_STARTED');
 const premature=evaluateV110FixedForwardStudy(records(),END-MIN);
 assert.equal(premature.status,'COLLECTING_FIXED_WINDOW');
 assert.equal(premature.futureWindowComplete,false);
 const pending=evaluateV110FixedForwardStudy(records(),END+20*MIN);
 assert.equal(pending.status,'COLLECTING_FIXED_WINDOW');
});
test('exclude training records, duplicated observations, unobserved outcomes and unknown pre-move',()=>{
 const src=records();
 const older={...src[0],id:'f'.repeat(32),sentAt:START-DAY};
 const duplicate={...src[0]};
 const pending={...src[2],id:'e'.repeat(32),
   windows:{15:{status:'PENDING',moveBps:22},30:{status:'OBSERVED',moveBps:22}}};
 const extra=evaluateV110FixedForwardStudy([...src,older,duplicate,pending],NOW);
 assert.equal(extra.baseline.n,192);
 const unknown=src.map(x=>x.strength==='STANDARD'?{...x,preMove5mBps:null}:x);
 const noChase=evaluateV110FixedForwardStudy(unknown,NOW);
 assert.equal(noChase.candidate.n,0);
 assert.equal(noChase.status,'INSUFFICIENT_FUTURE_SAMPLE');
});
test('no extra market requests, secret access or references from live scanner',()=>{
 const lib=readFileSync(new URL('../lib/v110-forward-study.mjs',import.meta.url),'utf8');
 const scan=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const push=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const route=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
 assert.equal(V110_FORWARD_POLICY.noNewMarketRequests,true);
 assert.equal(V110_FORWARD_POLICY.noOrders,true);
 assert.equal(V110_FORWARD_POLICY.humanApprovalRequired,true);
 for(const forbidden of ['process.env','fetch(','placeOrder','WEEX_TRADING_ENABLED',
 'NTFY_TOPIC','@vercel/blob','trade-prepare','trade-confirm','eval('])
  assert.equal(lib.includes(forbidden),false,forbidden);
 assert.equal(scan.includes('v110-forward-study'),false);
 assert.equal(push.includes('v110-forward-study'),false);
 assert.ok(route.includes('forwardStudy:evaluateV110FixedForwardStudy(forecastRows,now)'));
 assert.ok(route.includes("from './v110-forward-study.mjs'"));
});
