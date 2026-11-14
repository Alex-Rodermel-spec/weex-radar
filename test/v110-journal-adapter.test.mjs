import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptV110ForecastJournal as adapt} from '../lib/v110-journal-adapter.mjs';
const now=Date.parse('2026-11-14T04:00:00Z');
const row=(model,id,direction='LONG')=>({model,alertId:id,direction,horizonMinutes:5,entryPrice:100,outcomePrice:101,
 observedAt:'2026-11-14T03:45:00Z',outcomeKnownAt:'2026-11-14T03:50:00Z',source:'independent-forward'});
test('independent journal rows become directional outcomes',()=>{
 const r=adapt([row('V108','a'),row('V110','b','SHORT')],{now});
 assert.equal(r.readyForMonitoring,true);assert.ok(Math.abs(r.baseline[0].signedMoveBps-100)<1e-8);
 assert.ok(Math.abs(r.candidate[0].signedMoveBps+100)<1e-8);
});
test('duplicate, unverified and future outcomes are excluded',()=>{
 const future={...row('V110','future'),outcomeKnownAt:'2026-11-15T03:50:00Z'};
 const r=adapt([row('V108','a'),row('V108','a'),{...row('V110','fake'),source:'backtest'},future],{now});
 assert.equal(r.baseline.length,1);assert.equal(r.candidate.length,0);assert.equal(r.skipped,3);
 assert.equal(r.readyForMonitoring,false);
});
