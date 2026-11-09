import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {classifyFilterStage,summarizeFilterDiagnostics,STAGES}
 from '../lib/filter-diagnostics.mjs';

const ready={
 candidate:'LONG',hasAlignedTrend:true,
 quality:{ok:true},priceQuality:{ok:true},
 entryQuality:{ok:true},sidewaysGate:{blocked:false},active:true
};

test('read-only classifier reports the FIRST failed gate',()=>{
 assert.equal(classifyFilterStage({...ready,candidate:null,hasAlignedTrend:false}),'trend_mismatch');
 assert.equal(classifyFilterStage({...ready,candidate:null}),'no_breakout');
 assert.equal(classifyFilterStage({...ready,quality:{ok:false},priceQuality:{ok:false}}),'candle_quality');
 assert.equal(classifyFilterStage({...ready,priceQuality:{ok:false},entryQuality:{ok:false}}),'live_price');
 assert.equal(classifyFilterStage({...ready,entryQuality:{ok:false},sidewaysGate:{blocked:true}}),'risk_reward');
 assert.equal(classifyFilterStage({...ready,sidewaysGate:{blocked:true}}),'sideways');
 assert.equal(classifyFilterStage({...ready,active:false}),'expired');
 assert.equal(classifyFilterStage(ready),'ready');
});

test('summary counts one status per market and distinguishes no setup from blocked candidate',()=>{
 const rows=[
  {status:'ok',filterDiagnostic:{stage:'trend_mismatch'}},
  {status:'ok',filterDiagnostic:{stage:'no_breakout'}},
  {status:'ok',filterDiagnostic:{stage:'risk_reward'}},
  {status:'ok',filterDiagnostic:{stage:'live_price'}},
  {status:'ok',filterDiagnostic:{stage:'ready'}},
  {status:'error',filterDiagnostic:{stage:'ready'}},
  {status:'ok'}
 ];
 const x=summarizeFilterDiagnostics(rows);
 assert.equal(x.scanned,7);
 assert.equal(x.noSetup,2);
 assert.equal(x.candidatesBlocked,2);
 assert.equal(x.ready,1);
 assert.equal(x.unavailable,2);
 assert.equal(Object.values(x.counts).reduce((a,b)=>a+b,0),rows.length);
 assert.deepEqual(Object.keys(x.counts),STAGES);
 assert.equal(summarizeFilterDiagnostics(null).scanned,0);
});

test('diagnostics are read-only and share the existing /api/signals health handler',()=>{
 const signal=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const dispatch=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const health=readFileSync(new URL('../lib/health-route.mjs',import.meta.url),'utf8');
 const page=readFileSync(new URL('../health.html',import.meta.url),'utf8');
 assert.match(signal,/filterDiagnostic=\{stage:classifyFilterStage/);
 assert.match(signal,/return \{direction,filterDiagnostic,level:/);
 assert.match(health,/filterDiagnostics:marketResult\.status==='fulfilled'/);
 assert.match(dispatch,/WEEX_RADAR_FILTER_DIAGNOSTICS/);
 assert.match(page,/id="filter-card"/);
 const script=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1],{filename:'health.html'}));
 assert.doesNotMatch(health,/weex-order|trade-confirm|WEEX_API_SECRET|@vercel\/blob/);
});
