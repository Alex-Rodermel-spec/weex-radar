import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateV110ForecastEvidence as audit} from '../lib/v110-forecast-evidence-audit.mjs';
const MIN=60000, now=Date.parse('2026-11-16T12:00:00Z');
const win=(status='OBSERVED',moveBps=12)=>({status,moveBps:status==='OBSERVED'?moveBps:null});
const record=(i,patch={})=>({
  id:i.toString(16).padStart(32,'0'),symbol:'XRPUSDT',direction:'LONG',
  sentAt:now-(25*60-i*40)*MIN,
  preMove5mBps:3,
  windows:{5:win(),10:win(),15:win(),30:win()},...patch
});
test('reports explicit published denominators, unknown outcomes and small sample suppression',()=>{
  const rows=Array.from({length:25},(_,i)=>record(i+1));
  rows[24].windows={5:win(),10:win(),15:win('NO_DATA'),30:win('PENDING')};
  const r=audit(rows,now);
  assert.equal(r.status,'AGGREGATES_ONLY');
  assert.equal(r.allPublished.alerts,25);
  const h=r.byDirection.LONG.horizons[15];
  assert.deepEqual([h.matured,h.observed,h.noDataAfterMaturity,h.pendingAfterMaturity],
    [25,24,1,0]);
  assert.equal(h.favorable,24);
  assert.equal(h.favorablePctOfObserved,100);
  assert.equal(r.byDirection.SHORT.horizons[15].favorablePctOfObserved,null);
  assert.equal(r.allPublished.horizons[30].unscoredAfterMaturity,1);
  assert.equal(r.allPublished.horizons[15].observedCoveragePct,96);
  assert.equal(r.ordersSent,0);
});
test('immature results cannot be used, and missing does not become wrong',()=>{
  const immature=record(1,{sentAt:now-8*MIN,windows:{5:win(),10:win(),15:win(),30:win()}});
  const mature=record(2,{sentAt:now-60*MIN,windows:{
    5:win('NO_DATA'),10:win('PENDING'),15:win('OBSERVED',NaN),
    30:win('OBSERVED',-2)}});
  const r=audit([immature,mature],now).allPublished;
  assert.equal(r.horizons[5].immature,1);
  assert.equal(r.horizons[5].observed,0);
  assert.equal(r.horizons[5].noDataAfterMaturity,1);
  assert.equal(r.horizons[15].invalidAfterMaturity,1);
  assert.equal(r.horizons[15].adverse,0);
  assert.equal(r.horizons[30].adverse,1);
});
test('deduplicates by alert ID and discloses same-symbol overlap without altering archive',()=>{
  const a=record(1,{sentAt:now-70*MIN});
  const b=record(2,{sentAt:now-60*MIN,preMove5mBps:20});
  const c=record(3,{sentAt:now-50*MIN,direction:'SHORT',preMove5mBps:null});
  const d=record(4,{sentAt:now-45*MIN,symbol:'BTCUSDT'});
  const src=[c,a,b,d,b,{id:'not-an-id'}];
  const original=JSON.stringify(src);
  const r=audit(src,now);
  assert.equal(r.duplicateIds,1);
  assert.equal(r.invalidRows,1);
  assert.equal(r.uniquePublishedAlerts,4);
  assert.equal(r.bySymbolSpacing.NON_OVERLAPPING_30M.alerts,2);
  assert.equal(r.bySymbolSpacing.OVERLAPPING_WITHIN_30M.alerts,2);
  assert.equal(r.byPreAlert5mMove.UNKNOWN.alerts,1);
  assert.equal(r.byPreAlert5mMove.ALREADY_MOVED_AT_LEAST_10BPS.alerts,1);
  assert.equal(JSON.stringify(src),original);
  assert.equal(JSON.stringify(r).includes('XRPUSDT'),false);
});
test('empty and invalid archive produce no fabricated percentages',()=>{
  const a=audit([],now);
  assert.equal(a.allPublished.horizons[30].observedCoveragePct,null);
  assert.equal(a.allPublished.horizons[15].favorablePctOfObserved,null);
  assert.equal(audit(null,now).status,'INVALID_INPUT');
  assert.equal(audit(Array(5001).fill(record(1)),now).status,'INVALID_INPUT');
});
test('research module and integration never touch signal dispatch, orders or private data',()=>{
  const module=readFileSync(new URL('../lib/v110-forecast-evidence-audit.mjs',import.meta.url),'utf8');
  const route=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
  const scanner=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
  assert.match(route,/forecastEvidenceAudit:evaluateV110ForecastEvidence\(forecastRows,now\)/);
  assert.equal(scanner.includes('v110-forecast-evidence-audit'),false);
  for(const forbidden of ['fetch(', 'process.env', 'put(', 'publishNtfy', 'weex-order', 'trade-confirm', '@vercel/blob'])
    assert.equal(module.includes(forbidden),false,forbidden);
});
