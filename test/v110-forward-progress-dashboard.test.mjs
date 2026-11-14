import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,runInNewContext} from 'node:vm';

const html=readFileSync(new URL('../history.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if(!script)throw Error('HISTORY_SCRIPT_MISSING');
const start=script.indexOf('function v110ForwardProgress(');
const end=script.indexOf('function renderV110ForwardProgress(',start);
if(start<0||end<=start)throw Error('V110_FORWARD_PROGRESS_MISSING');
const view=runInNewContext(script.slice(start,end)+'\nv110ForwardProgress;');

function report(){
 return {
  forwardStudy:{
   status:'COLLECTING_FIXED_WINDOW',futureWindowComplete:false,
   policy:{startUTC:'2026-11-14T04:40:00Z',endExclusiveUTC:'2026-11-18T04:40:00Z',
    minBaselineN:75,minCandidateN:35,minDistinctUTCdays:2},
   baseline:{n:26,favorable15mPct:100},candidate:{n:11,favorable15mPct:100},
   days:1,coveragePct:42.3,favorableLiftPct:12
  },
  longStandardForward:{
   status:'COLLECTING_FIXED_WINDOW',futureWindowComplete:false,
   policy:{startUTC:'2026-11-14T06:00:00Z',endExclusiveUTC:'2026-11-18T06:00:00Z',
    minEarly:35,minLate:20,minDistinctDays:2},
   early:{n:12,favorable15mPct:100},late:{n:3,favorable15mPct:0},
   distinctDays:1,differencePct:100
  }
 };
}

test('two forward studies report actual sample counts and exact policy windows without interim winners',()=>{
 const rows=view(report());
 assert.equal(rows.length,2);
 assert.match(rows[0].name,/LONG/);
 assert.match(rows[0].period,/2026-11-14 04:40 UTC/);
 assert.match(rows[0].period,/2026-11-18 04:40 UTC/);
 assert.match(rows[1].period,/2026-11-14 06:00 UTC/);
 assert.match(rows[0].progress,/26 \/ 75/);
 assert.match(rows[0].progress,/11 \/ 35/);
 assert.match(rows[1].progress,/12 \/ 35/);
 assert.match(rows[1].progress,/3 \/ 20/);
 assert.match(rows[0].status,/результат скрыт/);
 assert.match(rows[1].status,/результат скрыт/);
 for(const row of rows){
  assert.doesNotMatch(row.status,/100%|12%|подтвердилось|Прошёл исследовательский порог/);
 }
});

test('misleading premature PASS is kept hidden until the fixed window completes',()=>{
 const input=report();
 input.forwardStudy.status='FORWARD_PRICE_AND_COST_PROXY_PASSED';
 input.longStandardForward.status='TIMING_EFFECT_REPLICATED_REVIEW_ONLY';
 let rows=view(input);
 assert.match(rows[0].status,/результат скрыт/);
 assert.match(rows[1].status,/результат скрыт/);
 input.forwardStudy.futureWindowComplete=true;
 input.longStandardForward.futureWindowComplete=true;
 rows=view(input);
 assert.match(rows[0].status,/только ручная проверка/);
 assert.match(rows[1].status,/только ручная проверка/);
 assert.doesNotMatch(rows[0].status,/внедрено|автоторговля/);
});

test('insufficient and rejected prospective evidence explicitly keeps V108',()=>{
 const input=report();
 input.forwardStudy.futureWindowComplete=true;
 input.forwardStudy.status='INSUFFICIENT_FUTURE_SAMPLE';
 input.longStandardForward.futureWindowComplete=true;
 input.longStandardForward.status='TIMING_EFFECT_NOT_REPLICATED';
 const rows=view(input);
 assert.match(rows[0].status,/KEEP_108/);
 assert.match(rows[1].status,/KEEP_108/);
});

test('missing or invalid aggregates are not misreported as zero measured events',()=>{
 const absent=view({});
 assert.equal(absent.length,2);
 assert.match(absent[0].progress,/недоступна/);
 assert.match(absent[1].progress,/недоступна/);
 assert.match(absent[0].status,/KEEP_108/);
 assert.match(absent[0].period,/—/);
 assert.doesNotMatch(absent[0].progress,/0 \/ 75/);
 const broken=report();
 broken.forwardStudy.baseline={n:-3};
 broken.forwardStudy.candidate={n:'500'};
 assert.match(view(broken)[0].progress,/недоступна/);
});

test('journal script parses, reads only existing aggregates and renders safe text',()=>{
 assert.doesNotThrow(()=>new Script(script));
 for(const id of ['v110ForwardRows','v110ForwardStatus'])
  assert.ok(html.includes('id="'+id+'"'));
 assert.ok(script.includes('renderV110ForwardProgress(report)'));
 const render=script.slice(end,script.indexOf('function display(){',end));
 assert.match(render,/textContent/);
 assert.doesNotMatch(render,/innerHTML|fetch\(|localStorage|sessionStorage/);
 assert.doesNotMatch(script.slice(start,end),/fetch\(|process\.env|new XMLHttpRequest/);
});
