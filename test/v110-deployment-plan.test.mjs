import test from 'node:test';
import assert from 'node:assert/strict';
import {buildV110DeploymentPlan as plan} from '../lib/v110-deployment-plan.mjs';
const good=()=>({project:'weex-radar',baselineDeploymentId:'dpl_AAAAAAAAAAAA',candidateDeploymentId:'dpl_BBBBBBBBBBBB',
 gate:{decision:'CANARY_ELIGIBLE',canDeploy:false},
 canary:{state:'PROMOTED',canDeploy:false}});
test('eligible simulated promotion yields only an inert plan',()=>{
 const p=plan(good());assert.equal(p.status,'PLAN_ONLY');
 assert.equal(p.productionChanged,false);
 assert.equal(p.requiresExternalController,true);
 assert.ok(p.operations.every(x=>!['PROMOTE','ROLLBACK','TRADE'].includes(x.kind)));
});
test('unsafe deployment inputs are blocked',()=>{
 for(const patch of [{project:'other'},{baselineDeploymentId:'wrong'},
  {candidateDeploymentId:'dpl_AAAAAAAAAAAA'},
  {gate:{decision:'KEEP_108',canDeploy:false}},
  {canary:{state:'ROLLED_BACK',canDeploy:false}}]){
  const p=plan({...good(),...patch});assert.equal(p.status,'BLOCKED');
  assert.deepEqual(p.operations,[]);
 }
});
