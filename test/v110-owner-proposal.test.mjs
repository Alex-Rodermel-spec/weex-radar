import test from 'node:test';
import assert from 'node:assert/strict';
import {buildV110OwnerProposal,V110_PROPOSAL_POLICY_IDS}
 from '../lib/v110-owner-proposal.mjs';

const candidate=()=>({
 generatedAt:Date.UTC(2026,10,15),
 hypothesisDiscovery:{
  mode:'V110_DIRECTIONAL_HYPOTHESIS_SHADOW',
  dataSource:'ONLY_ACTUALLY_PUBLISHED_ENCRYPTED_FORECASTS',
  status:'SHADOW_HYPOTHESIS_PASSED',
  recommendation:'OWNER_REVIEW_FOR_FORWARD_TEST',
  noLiveChanges:true,ordersSent:0,requiresOwnerApproval:true,
  requiresIndependentForwardTest:true,
  eligible:420,trainN:300,holdoutN:120,trainDays:3,holdoutDays:2,
  selectedOnTrainingOnly:'LONG_SKIP_CHASE',
  ideas:[{id:'LONG_SKIP_CHASE',trainPasses:true}],
  holdoutBaseline:{n:80,favorablePct:45,meanBps:1,favorable30mPct:50},
  holdoutCandidate:{n:49,favorablePct:55,meanBps:5,favorable30mPct:51}
 }
});
test('preselected screened candidate yields research-only sanitized PR evidence',()=>{
 const sample=candidate();
 sample.privateTopic='not-for-publication';
 const r=buildV110OwnerProposal(sample);
 assert.equal(r.policyId,'LONG_SKIP_CHASE');
 assert.equal(r.readiness,'FORWARD_TEST_REQUIRED');
 assert.equal(r.requiresOwnerApproval,true);
 assert.equal(r.canAutoMerge,false);
 assert.equal(r.affectsLiveSignals,false);
 assert.equal(r.affectsOrders,false);
 assert.equal(r.screeningHoldout.deltaFavorablePoints,10);
 assert.equal(r.screeningHoldout.deltaMeanBps,4);
 assert.equal(JSON.stringify(r).includes('not-for-publication'),false);
 assert.deepEqual(V110_PROPOSAL_POLICY_IDS.length,6);
});
test('research cannot auto-publish before independent evidence',()=>{
 for(const key of ['status','recommendation','requiresOwnerApproval',
   'requiresIndependentForwardTest','noLiveChanges','trainDays','holdoutDays']){
  const sample=candidate();
  sample.hypothesisDiscovery[key]=key==='status'?'INSUFFICIENT_DISTINCT_UTC_DAYS':
   key==='recommendation'?'KEEP_108':
   key==='trainDays'?2:key==='holdoutDays'?1:false;
  assert.equal(buildV110OwnerProposal(sample),null,key);
 }
});
test('untrusted or weak evidence cannot open a proposal',()=>{
 const changes=[
  v=>{v.selectedOnTrainingOnly='LONG_FREE_MONEY';},
  v=>{v.ideas=[];},
  v=>{v.ordersSent=1;},
  v=>{v.holdoutCandidate.n=10;},
  v=>{v.holdoutCandidate.favorablePct=50;},
  v=>{v.holdoutCandidate.meanBps=3;},
  v=>{v.holdoutCandidate.favorable30mPct=40;},
  v=>{v.holdoutCandidate.n=20;},
  v=>{v.eligible=100;}
 ];
 for(const mutate of changes){
  const sample=candidate();mutate(sample.hypothesisDiscovery);
  assert.equal(buildV110OwnerProposal(sample),null);
 }
});
test('all six proposals have a fixed allowlist, never derived filenames',()=>{
 for(const id of V110_PROPOSAL_POLICY_IDS){
  const sample=candidate();
  sample.hypothesisDiscovery.selectedOnTrainingOnly=id;
  sample.hypothesisDiscovery.ideas=[{id,trainPasses:true}];
  const proposal=buildV110OwnerProposal(sample);
  assert.equal(proposal.policyId,id);
  assert.equal(proposal.direction,id.startsWith('LONG')?'LONG':'SHORT');
 }
});
