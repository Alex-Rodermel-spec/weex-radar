import test from 'node:test';
import assert from 'node:assert/strict';
import {buildV110CandidateModule} from '../lib/v110-candidate-template.mjs';
import {V110_PROPOSAL_POLICY_IDS} from '../lib/v110-owner-proposal.mjs';
const load=async policy=>import('data:text/javascript,'+
 encodeURIComponent(buildV110CandidateModule(policy)));

test('all six generated policy candidates are inert and fixed-allowlist',async()=>{
 for(const id of V110_PROPOSAL_POLICY_IDS){
  const code=buildV110CandidateModule(id);
  assert.ok(code.includes('approvedForLive:false'));
  for(const bad of ['fetch(', 'process.env', 'placeOrder',
    'WEEX_TRADING_ENABLED', 'NTFY_TOPIC', 'import ', 'require('])
   assert.equal(code.includes(bad),false,`${id}: ${bad}`);
  const m=await load(id);
  assert.equal(m.CANDIDATE.id,id);
  assert.equal(m.CANDIDATE.side,id.startsWith('LONG_')?'LONG':'SHORT');
  assert.equal(m.CANDIDATE.status,'FORWARD_TEST_REQUIRED');
  assert.equal(m.CANDIDATE.approvedForLive,false);
 }
 assert.equal(buildV110CandidateModule('LONG_EVERYTHING_GOES'),null);
});
test('LONG caution gate rejects caution but not normal, never reverses direction',async()=>{
 const m=await load('LONG_SKIP_CAUTION');
 assert.equal(m.researchDecision({direction:'LONG',strength:'CAUTION'}),'EXCLUDE');
 assert.equal(m.researchDecision({direction:'LONG',strength:'STANDARD'}),'ELIGIBLE_FOR_RESEARCH');
 assert.equal(m.researchDecision({direction:'SHORT',strength:'CAUTION'}),'NOT_APPLICABLE');
});
test('SHORT chase gate fails closed on unknown pre-alert movement',async()=>{
 const m=await load('SHORT_SKIP_CHASE');
 assert.equal(m.researchDecision({direction:'SHORT',strength:'STANDARD',
  preMove5mBps:null}),'UNKNOWN');
 assert.equal(m.researchDecision({direction:'SHORT',strength:'STANDARD',
  preMove5mBps:10}),'EXCLUDE');
 assert.equal(m.researchDecision({direction:'SHORT',strength:'STANDARD',
  preMove5mBps:9.99}),'ELIGIBLE_FOR_RESEARCH');
});
test('combined gate requires both risk and pre-alert movement checks',async()=>{
 const m=await load('LONG_SKIP_CAUTION_CHASE');
 assert.equal(m.CANDIDATE.excludeCaution,true);
 assert.equal(m.CANDIDATE.excludeAlreadyMoved10bps,true);
 assert.equal(m.researchDecision({direction:'LONG',strength:'CAUTION',
  preMove5mBps:2}),'EXCLUDE');
 assert.equal(m.researchDecision({direction:'LONG',strength:'STANDARD',
  preMove5mBps:11}),'EXCLUDE');
 assert.equal(m.researchDecision({direction:'LONG',strength:'STANDARD',
  preMove5mBps:null}),'UNKNOWN');
 assert.equal(m.researchDecision({direction:'LONG',strength:'STANDARD',
  preMove5mBps:2}),'ELIGIBLE_FOR_RESEARCH');
});
