import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildV110OwnerProposal} from '../lib/v110-owner-proposal.mjs';

const workflow=readFileSync('.github/workflows/v110-owner-proposals.yml','utf8');
test('automatic review workflow requires successful trusted main journal',()=>{
 assert.match(workflow,/workflow_run:/);
 assert.match(workflow,/workflow_run\.conclusion == 'success'/);
 assert.match(workflow,/workflow_run\.head_branch == 'main'/);
 assert.match(workflow,/ref: main/);
});
test('automatic review writes only research proposal and opens draft, not deployment',()=>{
 assert.match(workflow,/research\/v110-proposals\/\$policy\.json/);
 assert.match(workflow,/research\/v110-proposals\/\$policy\.mjs/);
 assert.match(workflow,/gh pr create --draft --base main/);
 assert.match(workflow,/screening_report=/);
 assert.match(workflow,/KEEP_108 pending independent forward evidence/);
 assert.doesNotMatch(workflow,/gh pr merge|vercel deploy|weex order/i);
});
test('no qualified research report cannot produce an owner proposal',()=>{
 assert.equal(buildV110OwnerProposal({generatedAt:Date.now(),hypothesisDiscovery:{
  status:'SHADOW_HYPOTHESIS_FAILED',recommendation:'KEEP_108'
 }}),null);
});
