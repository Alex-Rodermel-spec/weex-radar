import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareV110HandsProposal,validateV110HandsPaths,isV110HandsResearchPath} from '../lib/v110-hands.mjs';

const proposal=()=>({
 schema:'v110-research-proposal-v1',policyId:'LONG_SKIP_CAUTION_CHASE',
 direction:'LONG',readiness:'FORWARD_TEST_REQUIRED',
 requiresOwnerApproval:true,affectsLiveSignals:false,affectsOrders:false,canAutoMerge:false,
 sampleGeneratedAt:'2026-11-14T02:00:00Z',
 training:{days:3,n:130},screeningHoldout:{days:2,n:70}
});
test('valid pilot yields only two isolated inert research artifacts',()=>{
 const result=prepareV110HandsProposal(proposal());
 assert.equal(result.status,'DRAFT_RESEARCH_ONLY');
 assert.equal(result.ownerApprovalRequired,true);
 assert.equal(result.liveChangesAllowed,false);
 assert.equal(result.files.length,2);
 assert.equal(validateV110HandsPaths(result.files.map(f=>f.path)),true);
 assert.match(result.files[1].content,/approvedForLive:false/);
 assert.match(result.files[1].content,/excludeAlreadyMoved10bps:true/);
});
test('malformed and unauthorized proposals fail closed',()=>{
 for(const change of [
  {policyId:'LONG_ALLOW_ALL'},{direction:'SHORT'},{readiness:'READY_FOR_LIVE'},
  {requiresOwnerApproval:false},{affectsOrders:true},{affectsLiveSignals:true},
  {canAutoMerge:true},{sampleGeneratedAt:'bad'},
  {training:{days:2,n:130}},{screeningHoldout:{days:1,n:70}},
  {screeningHoldout:{days:2,n:30}}
 ])assert.equal(prepareV110HandsProposal({...proposal(),...change}),null,JSON.stringify(change));
 assert.equal(prepareV110HandsProposal(null),null);
});
test('research path gate rejects live code, secrets, traversal and duplicate files',()=>{
 for(const path of ['api/signals.js','lib/v110-hands.mjs','.env',
  '.github/workflows/deploy.yml','research/v110-proposals/../../api/orders.js',
  'research/v110-proposals/LONG_UNKNOWN.mjs']){
  assert.equal(isV110HandsResearchPath(path),false,path);
 }
 assert.equal(validateV110HandsPaths(['research/v110-proposals/LONG_SKIP_CAUTION.json',
 'research/v110-proposals/LONG_SKIP_CAUTION.json']),false);
 assert.equal(validateV110HandsPaths([]),false);
});
