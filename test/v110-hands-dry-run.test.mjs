import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareV110HandsProposal,validateV110HandsPaths} from '../lib/v110-hands.mjs';

const proposal=()=>({
 schema:'v110-research-proposal-v1',policyId:'SHORT_SKIP_CAUTION',
 direction:'SHORT',readiness:'FORWARD_TEST_REQUIRED',
 requiresOwnerApproval:true,affectsLiveSignals:false,affectsOrders:false,
 canAutoMerge:false,sampleGeneratedAt:'2026-11-14T02:00:00Z',
 training:{days:3,n:120},screeningHoldout:{days:2,n:50}
});

test('synthetic end-to-end draft preparation stays isolated and owner-gated',()=>{
 const dir=mkdtempSync(join(tmpdir(),'v110-dryrun-'));
 try{
  const p=proposal();
  const prepared=prepareV110HandsProposal(p);
  assert.ok(prepared,'valid synthetic proposal must prepare');
  assert.equal(validateV110HandsPaths(prepared.files.map(f=>f.path)),true);
  assert.deepEqual(prepared.files.map(f=>f.path).sort(),[
   'research/v110-proposals/SHORT_SKIP_CAUTION.json',
   'research/v110-proposals/SHORT_SKIP_CAUTION.mjs'
  ]);
  for(const f of prepared.files){
   const target=join(dir,f.path.replaceAll('/','__'));
   writeFileSync(target,f.content);
   assert.equal(readFileSync(target,'utf8'),f.content);
  }
  const input=join(dir,'input.json');
  writeFileSync(input,JSON.stringify(p));
  const result=spawnSync(process.execPath,['scripts/v110-build-candidate.mjs',input],
   {encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);
  const generated=prepared.files.find(f=>f.path.endsWith('.mjs'));
  assert.equal(result.stdout,generated.content);
  assert.match(result.stdout,/approvedForLive:false/);
  assert.equal(p.requiresOwnerApproval,true);
  assert.equal(p.canAutoMerge,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('synthetic proposal cannot write to live paths',()=>{
 assert.equal(validateV110HandsPaths(['lib/live-strategy.mjs']),false);
 assert.equal(validateV110HandsPaths(['.github/workflows/deploy.yml']),false);
});
