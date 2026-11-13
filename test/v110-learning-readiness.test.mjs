import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeLearningReadiness,handleLearningReadiness,READINESS_POLICY}
 from '../lib/v110-learning-readiness.mjs';
const fixture={state:'READY',persistent:true,encryptedAtRest:true,
 generatedAt:1794534273789,archivedSignals:85,earlyStudy:{archivedEarly:101},
 forecastStudy:{archivedForecasts:558,
  windows:{'1':{total:273},'90':{
   at15m:{observed:551,favorable:237,adverse:296,flat:18},
   at30m:{observed:548}}}}};
test('public production aggregates can be viewed but never treated as training rows',()=>{
 const x=summarizeLearningReadiness(fixture);
 assert.equal(x.archive.forecastTotal,558);
 assert.equal(x.archive.at15Observed,551);
 assert.equal(x.training.eligibleAfterDedup,null);
 assert.equal(x.training.realModelTestCompleted,false);
 assert.equal(x.training.recommendation,'KEEP_108');
 assert.equal(x.safeguards.ordersSent,0);
});
test('public report never relays raw private fields or source cookies',async()=>{
 const data={...fixture,secret:'NEVER_SHOW',forecastStudy:{
  ...fixture.forecastStudy,rows:[{symbol:'BTCUSDT',price:123,token:'SECRET'}]}};
 const res={statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;},
  status(n){this.statusCode=n;return this;},json(x){this.payload=x;return this;}};
 const mock=async()=>({ok:true,headers:{get:()=>null},
  text:async()=>JSON.stringify(data)});
 await handleLearningReadiness({method:'GET'},res,{fetchImpl:mock});
 assert.equal(res.statusCode,200);
 assert.ok(!JSON.stringify(res.payload).includes('NEVER_SHOW'));
 assert.ok(!JSON.stringify(res.payload).includes('SECRET'));
 assert.equal(READINESS_POLICY.automaticModelTraining,false);
});
test('missing aggregate or malformed counts fail closed',()=>{
 assert.throws(()=>summarizeLearningReadiness({state:'READY'}));
 assert.throws(()=>summarizeLearningReadiness({...fixture,forecastStudy:{
  archivedForecasts:5,windows:{'90':{at15m:{observed:50},at30m:{observed:50}}}}}));
});
test('preflight route is entirely separate from production, trading and delivery',()=>{
 const route=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const code=readFileSync(new URL('../lib/v110-learning-readiness.mjs',import.meta.url),'utf8');
 assert.match(route,/mode==='learning-status'/);
 for(const dangerous of ['placeOrder','trade-confirm','trade-prepare',
 'publishNtfy','NTFY_TOPIC','PUSH_CRON_KEY','/capi/v3/order']){
  assert.ok(!code.includes(dangerous),'must not depend on '+dangerous);
 }
});

test('first real-archive warning filter is screening only, not autonomous training',()=>{
 const full={...fixture,forecastStudy:{...fixture.forecastStudy,windows:{
  ...fixture.forecastStudy.windows,
  '90':{...fixture.forecastStudy.windows['90'],byStrength:{
   STRONG:{at15m:{observed:55,favorable:23}},
   STANDARD:{at15m:{observed:299,favorable:130}},
   CAUTION:{at15m:{observed:197,favorable:84}}}}}}};
 const report=summarizeLearningReadiness(full).aggregateScreening.archived90d;
 assert.equal(report.baseline.observed,551);
 assert.equal(report.baseline.ratePct,43);
 assert.equal(report.kept.observed,354);
 assert.equal(report.kept.ratePct,43.2);
 assert.equal(report.estimatedLiftPoints,0.2);
 assert.equal(report.status,'NO_MEANINGFUL_AGGREGATE_LIFT');
 assert.equal(report.safeToPromote,false);
 assert.equal(report.realModelTestCompleted,false);
});
test('inconsistent strength counts fail closed, never promote',()=>{
 const sample={...fixture,forecastStudy:{...fixture.forecastStudy,windows:{
  ...fixture.forecastStudy.windows,'90':{...fixture.forecastStudy.windows['90'],
  byStrength:{STRONG:{at15m:{observed:999,favorable:999}}}}}}};
 const report=summarizeLearningReadiness(sample).aggregateScreening.archived90d;
 assert.equal(report.status,'MISSING_CONSISTENT_AGGREGATES');
 assert.equal(report.realModelTestCompleted,false);
});
