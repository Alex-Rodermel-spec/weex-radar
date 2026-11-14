import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,runInNewContext} from 'node:vm';

const html=readFileSync(new URL('../history.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if(!script)throw Error('HISTORY_SCRIPT_MISSING');
const start=script.indexOf('function v110TimingRows(');
const end=script.indexOf('function renderV110Timing(',start);
if(start<0||end<start)throw Error('V110_TIMING_MODEL_MISSING');
const getRows=runInNewContext(script.slice(start,end)+'\nv110TimingRows;');

test('history V110 timing model shows only aggregate data, with denominator and median guards',()=>{
 const d={status:'OBSERVED_AGGREGATES_ONLY',byDirection:{
  LONG:{firstMove10bps:{
   firstThresholdOrder:{maturedWithObserved30m:30,resolvedFirstCrossings:25,
    firstFavorable:19,firstAdverse:6,firstFavorablePctAmongResolved:76,
    neitherRecordedOrUnknown:4,ambiguousTie:1},
   favorable:{recorded:22,medianMinute:6.5},
   thresholdOrderByPrior5mMove:{
    BELOW_10BPS:{maturedWithObserved30m:20,resolvedFirstCrossings:20,
     firstFavorable:16,firstAdverse:4,firstFavorablePctAmongResolved:80,
     neitherRecordedOrUnknown:0,ambiguousTie:0},
    AT_LEAST_10BPS:{maturedWithObserved30m:5,resolvedFirstCrossings:4,
     firstFavorable:2,firstAdverse:2,firstFavorablePctAmongResolved:50,
     neitherRecordedOrUnknown:1,ambiguousTie:0},
    UNKNOWN:{maturedWithObserved30m:5,resolvedFirstCrossings:1,
     firstFavorable:1,firstAdverse:0,firstFavorablePctAmongResolved:null,
     neitherRecordedOrUnknown:4,ambiguousTie:0}
   },
   thresholdOrderByStrength:{STANDARD:{maturedWithObserved30m:2,
    resolvedFirstCrossings:2,firstFavorable:1,firstAdverse:1,
    firstFavorablePctAmongResolved:50,neitherRecordedOrUnknown:0,
    ambiguousTie:0}}
  }},
  SHORT:{firstMove10bps:{firstThresholdOrder:{maturedWithObserved30m:1,
    resolvedFirstCrossings:1,firstFavorable:1,firstAdverse:0,
    firstFavorablePctAmongResolved:null,neitherRecordedOrUnknown:0,ambiguousTie:0},
    favorable:{recorded:1,medianMinute:null}}}
 }};
 const rows=getRows(d);
 assert.equal(rows.length,14);
 const l=rows.find(r=>r.label==='🟢 LONG');
 assert.equal(l.matured,30);
 assert.equal(l.favorable,19);
 assert.equal(l.adverse,6);
 assert.equal(l.favorablePct,76);
 assert.equal(l.medianMinute,6.5);
 assert.equal(l.unresolved,5);
 const before=rows.find(r=>r.label==='🟢 LONG · Меньше +0,10%');
 assert.equal(before.matured,20);
 assert.equal(before.favorablePct,80);
 const after=rows.find(r=>r.label==='🟢 LONG · Уже ≥+0,10%');
 assert.equal(after.favorable,2);
 assert.equal(after.favorablePct,null); // 4 resolved is below the 20-event guard.
 const unknown=rows.find(r=>r.label==='🟢 LONG · Нет данных ДО');
 assert.equal(unknown.matured,5);
 assert.equal(unknown.favorablePct,null);
 assert.equal(unknown.unresolved,4);
 const s=rows.find(r=>r.label==='🔴 SHORT');
 assert.equal(s.favorablePct,null);
 assert.equal(s.medianMinute,null);
 const small=rows.find(r=>r.label==='🟢 LONG · 🔵 Обычный');
 assert.equal(small.favorable,1);
 assert.equal(small.favorablePct,null);
 const missing=rows.find(r=>r.label==='🔴 SHORT · 🟡 Риск');
 assert.equal(missing.matured,null);
 assert.equal(missing.unresolved,null);
});

test('empty diagnostic payload never manufactures zero sample sizes or favorable rates',()=>{
 const rows=getRows(null);
 assert.equal(rows.length,14);
 assert.ok(rows.every(r=>r.matured===null&&r.favorable===null&&
  r.adverse===null&&r.favorablePct===null&&r.medianMinute===null));
});

test('journal UI script parses and only reads aggregate API with safe text rendering',()=>{
 assert.doesNotThrow(()=>new Script(script));
 for(const id of ['v110TimingStatus','v110TimingRows','v110TimingStrengthRows',
  'v110PriorMoveRows'])
  assert.ok(html.includes('id="'+id+'"'));
 assert.ok(script.includes('renderV110Timing(report.directionDiagnostics)'));
 const ui=script.slice(end,script.indexOf('function display(){',end));
 assert.match(ui,/\.textContent=/);
 assert.doesNotMatch(ui,/innerHTML|fetch\(|localStorage|sessionStorage/);
 assert.match(html,/вне зависимости от выбора 30\/90/);
});
