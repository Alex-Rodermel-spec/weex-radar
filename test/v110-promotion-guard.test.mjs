import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateV110Promotion as check} from '../lib/v110-promotion-guard.mjs';
const valid=()=>({schema:'v110-promotion-v1',ordersChanged:false,secretsChanged:false,
 permissionsChanged:false,changedPaths:['lib/v108-forecast-score.mjs'],
 frozenCandidate:true,independentForwardTest:true,ciPassed:true,replayPassed:true,
 metrics:{n:120,baselineAccuracyPct:51,candidateAccuracyPct:58,
 baselineNetBps:1,candidateNetBps:5,coverageRatio:.9,latencyP95Ms:1200}});
test('qualified candidate is canary eligible but cannot deploy or trade',()=>{
 const r=check(valid());assert.equal(r.decision,'CANARY_ELIGIBLE');
 assert.equal(r.canDeploy,false);assert.equal(r.canTrade,false);
});
test('incomplete proof and unsafe edits always keep V108',()=>{
 const changes=[
  {independentForwardTest:false},{ciPassed:false},{ordersChanged:true},
  {changedPaths:['.github/workflows/deploy.yml']},
  {changedPaths:['lib/v108-forecast-score.mjs','api/orders.mjs']},
  {metrics:{...valid().metrics,n:20}},
  {metrics:{...valid().metrics,candidateNetBps:-1}},
  {metrics:{...valid().metrics,latencyP95Ms:6000}}
 ];
 for(const c of changes){const r=check({...valid(),...c});
  assert.equal(r.decision,'KEEP_108',JSON.stringify(c));
  assert.equal(r.canDeploy,false);
 }
});
