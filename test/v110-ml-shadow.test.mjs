import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateV110MLShadow as evaluate,V110_ML_POLICY} from '../lib/v110-ml-shadow.mjs';

const DAY=86_400_000,MIN=60_000,START=Date.UTC(2026,10,1);
const NOW=Date.UTC(2026,10,10);
const observed=b=>({status:'OBSERVED',moveBps:b});
function rows({days=7,reverseHoldout=false,allMissingPre=false}={}){
 const result=[];
 for(let d=0;d<days;d++)for(let i=0;i<48;i++){
  const favorable=i%2===0;
  const good=reverseHoldout&&d>=4?!favorable:favorable;
  result.push({
   id:result.length.toString(16).padStart(32,'0'),
   symbol:['BTCUSDT','ETHUSDT','XRPUSDT'][i%3],
   sentAt:START+d*DAY+i*20*MIN,
   direction:i%4===0?'LONG':'SHORT',
   strength:favorable?'STANDARD':'CAUTION',
   v2Timing:favorable?'CLEAR':null,
   preMove1mBps:allMissingPre?null:favorable?1:22,
   preMove3mBps:allMissingPre?null:favorable?2:34,
   preMove5mBps:allMissingPre?null:favorable?3:54,
   preMove15mBps:allMissingPre?null:favorable?4:96,
   windows:{15:observed(good?24:-24),30:observed(good?19:-19)}
  });
 }
 return result;
}

test('insufficient actual published days do not invent a trained model or advantage',()=>{
 const a=evaluate(rows({days:4}),NOW);
 assert.equal(a.status,'COLLECTING_INDEPENDENT_DAYS');
 assert.equal(a.modelTrained,false);
 assert.equal(a.requiredDays,5);
 assert.equal(a.ordersSent,0);
 assert.equal(a.recommendation,'KEEP_108');
 assert.equal(evaluate([],NOW).status,'COLLECTING_INDEPENDENT_DAYS');
});

test('a real trained regression evaluates later separated UTC days only',()=>{
 const a=evaluate(rows(),NOW);
 const same=evaluate(rows(),NOW);
 assert.equal(a.modelTrained,true);
 assert.equal(a.algorithm,'REGULARIZED_LOGISTIC_REGRESSION');
 assert.equal(a.trainDays,4);
 assert.equal(a.holdoutDays,3);
 assert.equal(a.trainN,192);
 assert.equal(a.holdoutN,142); // Embargo excludes first 30 min on the first holdout day.
 assert.ok(a.holdoutSelected.n>=25);
 assert.equal(a.holdoutSelected.favorablePct,100);
 assert.ok(a.holdoutBrier.learnedModel<a.holdoutBrier.constantTrainingRate);
 assert.equal(a.status,'HISTORICAL_HOLDOUT_PROMISING_ONLY');
 assert.equal(a.validationPassedHistoricalScreen,true);
 assert.equal(a.recommendation,'KEEP_108');
 assert.equal(a.futurePredictionApproved,false);
 assert.equal(a.ordersSent,0);
 assert.equal(a.liveChanges,0);
 assert.equal(a.paidApiCalls,0);
 assert.deepEqual(a,same);
 assert.match(a.trainEndExclusive,/T23:30:00\.000Z$/);
 assert.match(a.holdoutStartInclusive,/T00:30:00\.000Z$/);
});

test('regime reversal on unseen later days rejects overfitted regression',()=>{
 const a=evaluate(rows({reverseHoldout:true}),NOW);
 assert.equal(a.modelTrained,true);
 assert.equal(a.validationPassedHistoricalScreen,false);
 assert.equal(a.status,'HISTORICAL_HOLDOUT_NO_PROVEN_ADVANTAGE');
 assert.equal(a.recommendation,'KEEP_108');
 assert.ok(a.holdoutBrier.learnedModel>a.holdoutBrier.constantTrainingRate);
});

test('duplicates, missing pre-alert inputs and unresolved future outcomes do not leak',()=>{
 const r=rows({allMissingPre:true});
 const dup={...r[0],id:r[0].id,windows:{15:observed(9999),30:observed(9999)}};
 const missing={...r[1],id:'f'.repeat(32),windows:{
  15:{status:'PENDING',moveBps:null},30:observed(9)}};
 const future={...r[2],id:'e'.repeat(32),sentAt:NOW+DAY};
 const out=evaluate([...r,dup,missing,future],NOW);
 assert.equal(out.eligible,r.length);
 assert.equal(out.modelTrained,true);
 assert.equal(out.modelFeatures,13);
 assert.equal(out.ordersSent,0);
 assert.equal(out.futurePredictionApproved,false);
 assert.equal(JSON.stringify(out).includes('BTCUSDT'),false);
 assert.equal(JSON.stringify(out).includes('9999'),false);
});

test('no HTTP, no secrets, no orders, no model API dependency, and journal-only hook',()=>{
 const source=readFileSync(new URL('../lib/v110-ml-shadow.mjs',import.meta.url),'utf8');
 const journal=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
 const cron=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const signals=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 assert.match(journal,/mlShadow:evaluateV110MLShadow\(forecastRows,now\)/);
 assert.doesNotMatch(cron,/v110-ml-shadow/);
 assert.doesNotMatch(signals,/v110-ml-shadow/);
 assert.equal(V110_ML_POLICY.liveEnabled,false);
 assert.equal(V110_ML_POLICY.extraMarketRequests,0);
 assert.equal(V110_ML_POLICY.paidApiCalls,0);
 for(const word of ['fetch(', 'process.env','placeOrder','trade-prepare',
  'trade-confirm','NTFY_TOPIC','OPENAI_API_KEY','AI_GATEWAY_API_KEY',
  'publishNtfy','@vercel/blob','Function(','eval(']){
  assert.ok(!source.includes(word),'forbidden in shadow model: '+word);
 }
});
