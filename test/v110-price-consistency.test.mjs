import test from 'node:test';
import assert from 'node:assert/strict';
import {auditV110PriceConsistency} from '../lib/v110-price-consistency.mjs';
const row=(entryPrice,outcomePrice)=>({symbol:'XRPUSDT',alertId:'a',horizonMinutes:5,observedAt:'2026-11-14T01:00:00Z',evaluatedAt:'2026-11-14T01:05:00Z',entryPrice,outcomePrice});
const audit=(b,c)=>auditV110PriceConsistency({status:'ADAPTED',baseline:b,candidate:c});
test('matching market prices pass regardless of predicted direction',()=>{
 const r=audit([row(100,101)],[{...row(100,101),direction:'SHORT'}]);
 assert.equal(r.consistent,1);assert.equal(r.priceConflicts,0);
});
test('conflicting sampled price is rejected as inconsistent evidence',()=>{
 const r=audit([row(100,101)],[row(100,103)]);
 assert.equal(r.priceConflicts,1);assert.equal(r.consistent,0);
});
test('different markets are never paired',()=>{
 const r=audit([row(100,101)],[{...row(100,101),symbol:'BTCUSDT'}]);
 assert.equal(r.paired,0);
});
test('ambiguous candidate matches cannot inflate price consistency',()=>{
 const r=audit([row(100,101)],[row(100,101),row(100,101)]);
 assert.equal(r.consistent,0);assert.equal(r.ambiguous,1);
});
