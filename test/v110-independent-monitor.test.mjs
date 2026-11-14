import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateV110IndependentMonitor as monitor} from '../lib/v110-independent-monitor.mjs';
const now=Date.parse('2026-11-14T03:50:00Z');
const rows=(n,positive)=>Array.from({length:n},(_,i)=>({direction:i%2?'LONG':'SHORT',horizonMinutes:5,signedMoveBps:i<positive?2:-2,observedAt:'2026-11-14T03:49:00Z',outcomeKnownAt:'2026-11-14T03:49:30Z',source:'independent-forward'}));
test('equal forward quality is healthy, without trading permission',()=>{const r=monitor({baseline:rows(50,30),candidate:rows(50,30),now});assert.equal(r.status,'HEALTHY');assert.equal(r.canTrade,false);});
test('independent quality regression triggers unsafe',()=>{const r=monitor({baseline:rows(50,35),candidate:rows(50,20),now});assert.equal(r.status,'UNSAFE');assert.equal(r.reason,'DIRECTIONAL_REGRESSION');});
test('missing, fabricated provenance and stale data fail closed',()=>{
 assert.equal(monitor({baseline:[],candidate:[],now}).status,'UNSAFE');
 const fake=rows(50,30).map(r=>({...r,source:'backtest'}));
 assert.equal(monitor({baseline:rows(50,30),candidate:fake,now}).status,'UNSAFE');
 assert.equal(monitor({baseline:rows(50,30),candidate:rows(50,30),now:now+3600000}).reason,'STALE_OUTCOMES');
});
