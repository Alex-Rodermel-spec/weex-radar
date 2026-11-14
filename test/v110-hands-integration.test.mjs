import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function invoke(p){
 const dir=mkdtempSync(join(tmpdir(),'v110-hands-'));
 try{
  const file=join(dir,'proposal.json');
  writeFileSync(file,JSON.stringify(p));
  return spawnSync(process.execPath,['scripts/v110-build-candidate.mjs',file],
   {encoding:'utf8',timeout:5000});
 }finally{rmSync(dir,{recursive:true,force:true});}
}
const valid=()=>({
 schema:'v110-research-proposal-v1',policyId:'LONG_SKIP_CAUTION_CHASE',
 direction:'LONG',readiness:'FORWARD_TEST_REQUIRED',
 requiresOwnerApproval:true,affectsLiveSignals:false,affectsOrders:false,
 canAutoMerge:false,sampleGeneratedAt:'2026-11-14T02:00:00Z',
 training:{days:3,n:120},screeningHoldout:{days:2,n:50}
});
test('candidate builder uses V110 Hands contract and produces inert code',()=>{
 const r=invoke(valid());
 assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/approvedForLive:false/);
 assert.match(r.stdout,/LONG_SKIP_CAUTION_CHASE/);
});
test('candidate builder rejects invalid owner gate and insufficient holdout',()=>{
 for(const p of [{...valid(),requiresOwnerApproval:false},
  {...valid(),screeningHoldout:{days:1,n:50}},
  {...valid(),affectsOrders:true}]){
  const r=invoke(p);
  assert.notEqual(r.status,0);
  assert.equal(r.stdout,'');
 }
});
