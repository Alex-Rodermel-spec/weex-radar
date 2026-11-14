import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,runInNewContext} from 'node:vm';

const html=readFileSync(new URL('../history.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if(!script)throw Error('HISTORY_SCRIPT_MISSING');
const start=script.indexOf('function v110MLDisplay(');
const end=script.indexOf('function renderV110ML(',start);
if(start<0||end<start)throw Error('V110_ML_VIEW_MODEL_MISSING');
const display=runInNewContext(script.slice(start,end)+'\nv110MLDisplay;');

test('shows collecting days as unknown, no imaginary ML success percentages',()=>{
 const a=display({mode:'V110_EMBEDDED_ML_SHADOW',status:'COLLECTING_INDEPENDENT_DAYS',
  eligible:320,distinctDays:3,modelTrained:false});
 assert.match(a.status,/3 дн/);
 assert.match(a.status,/ещё не обучена/);
 assert.equal(a.hit,'—');
 assert.equal(a.samples,'—');
 assert.equal(a.brier,'—');
 assert.equal(display(null).hit,'—');
});
test('shows model vs constant baseline only for a truly trained historical test',()=>{
 const a=display({mode:'V110_EMBEDDED_ML_SHADOW',
  modelTrained:true,status:'HISTORICAL_HOLDOUT_NO_PROVEN_ADVANTAGE',
  trainN:200,holdoutN:100,
  holdoutBaseline:{favorablePct:47},
  holdoutSelected:{n:30,favorablePct:50},
  holdoutBrier:{constantTrainingRate:0.2497,learnedModel:0.2552}});
 assert.equal(a.samples,'200 / 100');
 assert.equal(a.brier,'0.255 против 0.250');
 assert.equal(a.hit,'50% (30) / 47% (100)');
 assert.match(a.status,/нет/);
 const b=display({mode:'V110_EMBEDDED_ML_SHADOW',
  modelTrained:true,status:'HISTORICAL_HOLDOUT_PROMISING_ONLY',
  trainN:200,holdoutN:80,holdoutBaseline:{favorablePct:45},
  holdoutSelected:{n:18,favorablePct:null},
  holdoutBrier:{constantTrainingRate:0.25,learnedModel:0.22}});
 assert.equal(b.hit,'—');
 assert.match(b.status,/НЕ меняется/);
});
test('web UI only renders aggregate ML, no private journal records',()=>{
 assert.doesNotThrow(()=>new Script(script));
 for(const id of ['v110MLStatus','v110MLSamples','v110MLBrier','v110MLHit']){
  assert.ok(html.includes('id="'+id+'"'));
 }
 assert.match(script,/renderV110ML\(report\.mlShadow\)/);
 const render=script.slice(end,script.indexOf('function v110ForwardProgress(',end));
 assert.match(render,/\.textContent=/);
 assert.doesNotMatch(render,/innerHTML|fetch\(|localStorage|sessionStorage/);
});
