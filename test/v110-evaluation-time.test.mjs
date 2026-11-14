import test from 'node:test';
import assert from 'node:assert/strict';
import {validateV110EvaluationTimes} from '../lib/v110-evaluation-time.mjs';
const base={horizonMinutes:5,observedAt:'2026-11-14T01:00:00Z',evaluatedAt:'2026-11-14T01:05:00Z',outcomeKnownAt:'2026-11-14T01:05:01Z'};
test('validates sampled price exactly at forecast horizon',()=>{
 const r=validateV110EvaluationTimes([base]);
 assert.equal(r.valid.length,1);assert.equal(r.rejected.length,0);
});
test('rejects late sample even if outcome is known later',()=>{
 const r=validateV110EvaluationTimes([{...base,evaluatedAt:'2026-11-14T01:10:00Z'}]);
 assert.equal(r.valid.length,0);assert.equal(r.rejected.length,1);
});
test('allows delayed publication but not publication before sampling',()=>{
 const r=validateV110EvaluationTimes([{...base,outcomeKnownAt:'2026-11-14T01:30:00Z'},
 {...base,outcomeKnownAt:'2026-11-14T01:04:00Z'}]);
 assert.equal(r.valid.length,1);assert.equal(r.rejected.length,1);
});
test('rejects missing evaluation time and impossible tolerance',()=>{
 assert.equal(validateV110EvaluationTimes([{...base,evaluatedAt:undefined}]).rejected.length,1);
 assert.equal(validateV110EvaluationTimes([base],{toleranceMs:60000}).status,'INVALID_INPUT');
});
