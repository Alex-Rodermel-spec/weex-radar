import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 evaluateV110Hypotheses,V110_HYPOTHESIS_POLICY,V110_HYPOTHESIS_IDS
} from '../lib/v110-hypothesis-discovery.mjs';
import {selectV110ReviewProposal,formatV110ReviewProposal} from '../lib/v110-review-notices.mjs';

const DAY=86400000,MIN=60000;
const START=Date.UTC(2026,10,8),NOW=Date.UTC(2026,10,14,0,0);
const samples=({reverseHoldout=false,days=5}={})=>{
 const data=[];
 for(let d=0;d<days;d++)for(let i=0;i<48;i++){
  const id=data.length.toString(16).padStart(32,'0');
  const good=i%2===0,ok=reverseHoldout&&d>=3?!good:good;
  const m=ok?22:-22;
  data.push({id,symbol:['BTCUSDT','XRPUSDT','ETHUSDT'][i%3],
   sentAt:START+d*DAY+i*30*MIN,direction:'LONG',
   strength:good?'STANDARD':'CAUTION',
   preMove5mBps:good?1:22,
   windows:{15:{status:'OBSERVED',moveBps:m},
    30:{status:'OBSERVED',moveBps:m}}});
 }
 return data;
};
test('generator pre-registers direction-specific testable ideas and finds a train-only winner',()=>{
 const out=evaluateV110Hypotheses(samples(),NOW);
 assert.equal(out.status,'SHADOW_HYPOTHESIS_PASSED');
 assert.equal(out.recommendation,'OWNER_REVIEW_FOR_FORWARD_TEST');
 assert.ok(V110_HYPOTHESIS_IDS.includes(out.selectedOnTrainingOnly));
 assert.equal(out.trainDays,3);
 assert.equal(out.holdoutDays,2);
 assert.equal(out.trainN,144);
 assert.equal(out.holdoutN,96);
 assert.equal(out.holdoutBaseline.favorablePct,50);
 assert.equal(out.holdoutCandidate.favorablePct,100);
 assert.equal(out.noLiveChanges,true);
 assert.equal(out.ordersSent,0);
 assert.equal(out.additionalMarketRequests,0);
 assert.equal(out.requiresIndependentForwardTest,true);
 assert.equal(out.ideas.length,6);
 assert.equal(out.ideas.some(x=>x.side==='LONG'&&x.trainPasses),true);
 assert.ok(out.ideas.every(x=>typeof x.hypothesis==='string'));
 const proposal=selectV110ReviewProposal(null,null,out);
 assert.equal(proposal.kind,'DIRECTION_HYPOTHESIS');
 const message=formatV110ReviewProposal(proposal);
 assert.match(message.message,/forward-тест/);
 assert.match(message.message,/ручное одобрение/);
 assert.match(message.message,/№108/);
});
test('reversed holdout rejects exciting but overfit ideas',()=>{
 const out=evaluateV110Hypotheses(samples({reverseHoldout:true}),NOW);
 assert.equal(out.status,'HOLDOUT_REJECTED');
 assert.equal(out.recommendation,'KEEP_108');
 assert.equal(selectV110ReviewProposal(null,null,out),null);
 assert.equal(out.holdoutBaseline.favorablePct,50);
 assert.equal(out.holdoutCandidate.favorablePct,0);
});
test('no distinct future days means no false independent result',()=>{
 const out=evaluateV110Hypotheses(samples({days:4}),NOW);
 assert.equal(out.status,'INSUFFICIENT_DISTINCT_UTC_DAYS');
 assert.equal(out.recommendation,'KEEP_108');
 assert.equal(out.requiredDays,5);
 assert.equal(out.ideas.length,6);
 assert.ok(out.ideas.every(x=>x.state==='PENDING_CHRONOLOGICAL_VALIDATION'));
 assert.equal(out.preliminaryDiagnosticsOnly,true);
 assert.equal(out.descriptiveDirectionSnapshot.LONG.n,192);
 assert.equal(out.descriptiveDirectionSnapshot.SHORT.n,0);
 assert.equal(out.observedShortMinusLongPct,null);
 assert.equal(out.ordersSent,0);
});
test('no sample or invalid outcome never becomes evidence',()=>{
 assert.equal(evaluateV110Hypotheses([],NOW).status,'INSUFFICIENT_DATA');
 const src=samples();
 src[0].windows[15]={status:'PENDING',moveBps:9000};
 src[1].sentAt=NOW+DAY;
 const out=evaluateV110Hypotheses(src,NOW);
 assert.ok(out.eligible<=238);
 assert.equal(out.noLiveChanges,true);
});
test('duplicate IDs, gapped market events and missing pre-move do not manufacture success',()=>{
 const input=samples();
 const withDuplicate=[...input,...input.map(x=>({...x}))];
 const out=evaluateV110Hypotheses(withDuplicate,NOW);
 assert.equal(out.eligible,240);
 assert.equal(out.holdoutN,96);
 const noPre=input.map(x=>({...x,preMove5mBps:null}));
 const review=evaluateV110Hypotheses(noPre,NOW);
 assert.ok(review.ideas.find(x=>x.id==='LONG_SKIP_CHASE').trainCandidate.n===0);
 assert.equal(review.ordersSent,0);
});
test('new lab reads only archived published forecasts and cannot block scanner or spend',()=>{
 const api=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const route=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
 const lab=readFileSync(new URL('../lib/v110-hypothesis-discovery.mjs',import.meta.url),'utf8');
 const cron=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 assert.match(route,/hypothesisDiscovery:evaluateV110Hypotheses\(forecastRows,now\)/);
 assert.match(route,/const ideas=evaluateV110Hypotheses\(forecastMerged\.rows,now\)/);
 assert.match(route,/notifyV110Review/);
 assert.equal(V110_HYPOTHESIS_POLICY.noNewRequests,true);
 assert.equal(V110_HYPOTHESIS_POLICY.noTrading,true);
 assert.equal(V110_HYPOTHESIS_POLICY.forwardTestRequired,true);
 for(const phrase of ['placeOrder','trade-prepare','trade-confirm','push-dispatch',
  'fetch(','NTFY_TOPIC','process.env','@vercel/blob','eval(','Function('])
  assert.ok(!lab.includes(phrase),'Research-only module '+phrase);
 assert.doesNotMatch(cron,/v110-hypothesis-discovery/);
 assert.doesNotMatch(api,/v110-hypothesis-discovery/);
});
