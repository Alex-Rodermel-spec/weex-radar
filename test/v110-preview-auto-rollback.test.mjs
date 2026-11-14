import test from 'node:test';
import assert from 'node:assert/strict';
import {runV110PreviewRollback as run} from '../lib/v110-preview-auto-rollback.mjs';
const alias='v110-switch-lab-stilvoll-bullet.vercel.app',baselineId='dpl_AAAAAAAAAAAA',candidateId='dpl_BBBBBBBBBBBB';
const fixture=()=>{let active=candidateId;const calls=[];
 return {args:{alias,baselineId,candidateId,telemetry:{fresh:false,healthy:true,qualityNonRegressing:true},
 adapter:{getAliasDeploymentId:async()=>active,assignAlias:async({deploymentId})=>{calls.push(deploymentId);active=deploymentId;}}},calls};};
test('stale telemetry automatically restores and verifies preview baseline',async()=>{
 const f=fixture(),r=await run(f.args);
 assert.equal(r.status,'RESTORED');assert.deepEqual(f.calls,[baselineId]);assert.equal(r.productionChanged,false);
});
test('healthy candidate is untouched',async()=>{
 const f=fixture();f.args.telemetry={fresh:true,healthy:true,qualityNonRegressing:true};
 assert.equal((await run(f.args)).status,'HEALTHY');assert.deepEqual(f.calls,[]);
});
test('production alias or wrong pinned candidate is blocked',async()=>{
 for(const patch of [{alias:'weex-radar.vercel.app'},{candidateId:'dpl_CCCCCCCCCCCC'}]){
  const f=fixture();const r=await run({...f.args,...patch});
  assert.equal(r.status,'BLOCKED');assert.deepEqual(f.calls,[]);
 }
});
test('failed alias verification cannot report success',async()=>{
 const f=fixture();f.args.adapter.getAliasDeploymentId=async()=>candidateId;
 const r=await run(f.args);assert.equal(r.status,'RESTORE_UNVERIFIED');
});
