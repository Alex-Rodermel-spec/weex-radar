import test from 'node:test';
import assert from 'node:assert/strict';
import {auditV110DirectionalDisagreements} from '../lib/v110-disagreement-audit.mjs';
const r=(direction,move)=>({symbol:'XRPUSDT',alertId:'x1',horizonMinutes:5,observedAt:'2026-11-14T01:00:00Z',outcomeKnownAt:'2026-11-14T01:05:00Z',direction,signedMoveBps:move});
test('opposite direction forecasts are audited, not silently discarded',()=>{
 const result=auditV110DirectionalDisagreements({status:'ADAPTED',baseline:[r('LONG',100)],candidate:[r('SHORT',-100)]});
 assert.equal(result.matched,1);assert.equal(result.disagree,1);
 assert.equal(result.baselineCorrectOnDisagreement,1);
 assert.equal(result.candidateCorrectOnDisagreement,0);
 assert.equal(result.approvedForLive,false);
});
test('same direction is agreement, not an improvement',()=>{
 const result=auditV110DirectionalDisagreements({status:'ADAPTED',baseline:[r('LONG',100)],candidate:[r('LONG',100)]});
 assert.equal(result.agree,1);assert.equal(result.disagree,0);
});
test('different market symbols never match',()=>{
 const result=auditV110DirectionalDisagreements({status:'ADAPTED',baseline:[r('LONG',100)],candidate:[{...r('SHORT',-100),symbol:'BTCUSDT'}]});
 assert.equal(result.matched,0);assert.equal(result.approvedForLive,false);
});
test('duplicate candidate observations are marked ambiguous',()=>{
 const result=auditV110DirectionalDisagreements({status:'ADAPTED',baseline:[r('LONG',100)],candidate:[r('SHORT',-100),r('SHORT',-100)]});
 assert.equal(result.matched,0);assert.equal(result.ambiguous,1);
});

test('duplicate baseline observations cannot count the same disagreement twice',()=>{
 const result=auditV110DirectionalDisagreements({status:'ADAPTED',baseline:[r('LONG',100),r('LONG',100)],candidate:[r('SHORT',-100)]});
 assert.equal(result.matched,0);assert.equal(result.disagree,0);
 assert.equal(result.ambiguous,2);assert.equal(result.approvedForLive,false);
});
