import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {classifyForecastQualityShadow,forecastQualityShadowAudit,
 QUALITY_GATE_PROTOCOL} from '../lib/forecast-quality-gate.mjs';
import {summarizeForecastArchive} from '../lib/forecast-journal.mjs';
const MIN=60000,cut=Date.parse(QUALITY_GATE_PROTOCOL.forwardFrom);
const NOW=Date.parse('2026-11-17T19:00:00Z');
const mk=(i,more={})=>({
 sentAt:cut+i*MIN,
 id:i.toString(16).padStart(32,'0'),
 symbol:['BTCUSDT','ETHUSDT','XRPUSDT'][i%3],
 direction:i%2?'SHORT':'LONG',strength:'STANDARD',v2Timing:'CLEAR',
 preMove15mBps:0,reference:100,
 windows:Object.fromEntries([1,5,10,15,30].map(h=>[h,{
  status:'OBSERVED',moveBps:20
 }])),
 ...more
});
test('shadow gate never reads future candles to decide PASS SKIP UNKNOWN',()=>{
 const a=mk(1);
 assert.equal(classifyForecastQualityShadow(a),'PASS');
 assert.equal(classifyForecastQualityShadow({
  ...a,windows:{5:{status:'OBSERVED',moveBps:-200}}
 }), 'PASS','bad later move must NOT change the pre-alert classification');
 assert.equal(classifyForecastQualityShadow({
  ...a,v2Timing:'LATE'
 }), 'SKIP');
 assert.equal(classifyForecastQualityShadow({
  ...a,preMove15mBps:11
 }), 'SKIP');
 assert.equal(classifyForecastQualityShadow({
  ...a,strength:'CAUTION',preMove15mBps:null,v2Timing:null
 }), 'SKIP');
 assert.equal(classifyForecastQualityShadow({
  ...a,v2Timing:null
 }), 'UNKNOWN');
 assert.equal(classifyForecastQualityShadow({
  ...a,preMove15mBps:null
 }), 'UNKNOWN');
 assert.equal(classifyForecastQualityShadow({
  ...a,v2Timing:'UNKNOWN'
 }), 'UNKNOWN');
});
test('forecast gate separates exploratory past from independent future',()=>{
 const prior=mk(1,{sentAt:cut-MIN,windows:{5:{status:'OBSERVED',moveBps:20}}});
 const later=mk(2,{sentAt:cut+MIN});
 const risky=mk(3,{strength:'CAUTION',windows:{5:{status:'OBSERVED',moveBps:-20}}});
 const missing=mk(4,{v2Timing:null,windows:{5:{status:'NO_DATA'}}});
 const report=forecastQualityShadowAudit([prior,later,risky,missing],NOW);
 assert.equal(report.mode,'READ_ONLY_FORECAST_QUALITY_SHADOW');
 assert.equal(report.exploratory.groups.PASS.total,1);
 assert.equal(report.forward.total,3);
 assert.equal(report.forward.groups.PASS.total,1);
 assert.equal(report.forward.groups.SKIP.total,1);
 assert.equal(report.forward.groups.UNKNOWN.total,1);
 assert.equal(report.forward.groups.BASELINE.at5m.observed,2);
 assert.equal(report.forward.groups.BASELINE.at5m.missing,1);
 assert.equal(report.forward.comparison.status,'COLLECTING');
 assert.equal(report.tradeReady,false);
 assert.equal(report.liveForecastsUnchanged,true);
 const integrated=summarizeForecastArchive([prior,later,risky,missing],NOW);
 assert.equal(integrated.windows[30].qualityShadowGate.forward.total,3);
});
test('never promotes partial future candles or missing outcomes to directional wins',()=>{
 const late=mk(11,{sentAt:NOW-2*MIN,windows:{5:{status:'PENDING'}}});
 const oldNoData=mk(12,{sentAt:NOW-60*MIN,windows:{5:{status:'NO_DATA'}}});
 const correct=mk(13,{sentAt:NOW-60*MIN,windows:{5:{status:'OBSERVED',moveBps:20}}});
 const r=forecastQualityShadowAudit([late,oldNoData,correct],NOW).forward.groups.PASS.at5m;
 assert.equal(r.total,3);
 assert.equal(r.matured,2);
 assert.equal(r.observed,1);
 assert.equal(r.missing,1);
 assert.equal(r.favorable,1);
 assert.equal(r.coveragePct,50);
});
test('50 each, enough 3 shared coins and 80% coverage allow REVIEW_ONLY, never automatic deployment',()=>{
 const rows=[];
 for(let i=0;i<120;i++)rows.push(mk(i+200,{
  strength:'STANDARD',v2Timing:i%2?'LATE':'CLEAR',
  preMove15mBps:i%2?20:0,
  windows:Object.fromEntries([1,5,10,15,30].map(h=>[h,{
   status:'OBSERVED',moveBps:i%2?-20:20
  }]))
 }));
 const r=forecastQualityShadowAudit(rows,NOW).forward;
 assert.equal(r.groups.PASS.at5m.observed,60);
 assert.equal(r.groups.SKIP.at5m.observed,60);
 assert.equal(r.comparison.sharedSymbols,3);
 assert.equal(r.comparison.differencePp,100);
 assert.equal(r.comparison.status,'REVIEW_ONLY');
 assert.equal(r.comparison.passesDescriptiveThreshold,true);
 assert.equal(r.groups.PASS.byDirection.LONG.at5m.observed,60);
 assert.equal(r.groups.SKIP.byDirection.SHORT.at5m.observed,60);
});
test('UI contains shadow-only prospective audit, no trading path and valid JavaScript',()=>{
 const html=readFileSync(new URL('../history.html',import.meta.url),'utf8');
 const journal=readFileSync(new URL('../lib/forecast-journal.mjs',import.meta.url),'utf8');
 const gate=readFileSync(new URL('../lib/forecast-quality-gate.mjs',import.meta.url),'utf8');
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1],{filename:'history.html'}));
 assert.match(html,/id="qualityShadowRows"/);
 assert.match(html,/qualityShadowGate/);
 assert.match(journal,/qualityShadowGate:forecastQualityShadowAudit/);
 for(const s of [html,gate])
  assert.doesNotMatch(s,/\/api\/trade-confirm|\/api\/trade-prepare|WEEX_API_SECRET|placeOrder/);
});
