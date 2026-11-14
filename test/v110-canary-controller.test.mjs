import test from 'node:test';
import assert from 'node:assert/strict';
import {stepV110Canary as step} from '../lib/v110-canary-controller.mjs';
const start={type:'START',gateDecision:'CANARY_ELIGIBLE',monitoringReady:true,rollbackReady:true,baselinePinned:true};
const observe={type:'OBSERVE',telemetryFresh:true,errorsOk:true,rollbackReady:true,baselinePinned:true,samples:200,deltaAccuracyPct:2,deltaNetBps:1};
test('simulated canary advances only with sufficient evidence',()=>{
 const a=step({state:'IDLE'},start);
 assert.equal(a.state,'CANARY');assert.equal(a.trafficPct,5);
 assert.equal(a.canDeploy,false);
 const b=step(a,{...observe,samples:100});
 assert.equal(b.state,'CANARY');
 const c=step(b,observe);
 assert.equal(c.state,'PROMOTED');assert.equal(c.canDeploy,false);
 assert.equal(c.canTrade,false);
});
test('missing or degraded telemetry latches rollback',()=>{
 const a=step({state:'IDLE'},start);
 for(const e of [null,{...observe,telemetryFresh:false},
  {...observe,deltaNetBps:-1},{...observe,errorsOk:false}]){
  const r=step(a,e);assert.equal(r.state,'ROLLED_BACK');
  assert.equal(r.trafficPct,0);assert.equal(r.canDeploy,false);
  assert.equal(step(r,start).state,'ROLLED_BACK');
 }
});
test('unqualified proposal never enters canary',()=>{
 const r=step({state:'IDLE'},{...start,gateDecision:'KEEP_108'});
 assert.equal(r.state,'IDLE');assert.equal(r.trafficPct,0);
});
