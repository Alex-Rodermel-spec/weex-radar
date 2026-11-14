import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,runInNewContext} from 'node:vm';
const html=readFileSync(new URL('../history.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if(!script)throw Error('HISTORY_SCRIPT_MISSING');
const start=script.indexOf('function two5mDisplay('),end=script.indexOf('function renderV110Two5m(',start);
if(start<0||end<start)throw Error('V110_2X5M_VIEW_MODEL_MISSING');
const display=runInNewContext(script.slice(start,end)+'\ntwo5mDisplay;');

test('history JS parses, 2 fully closed 5m panel renders only aggregates',()=>{
 assert.doesNotThrow(()=>new Script(script));
 for(const id of ['two5mStatus','two5mSample','two5mBoth','two5mDelay','two5mDirections'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(script,/renderV110Two5m\(report\.twoClosed5mShadow\)/);
 assert.ok(!script.slice(start,end).includes('fetch('));
});
test('unknown small or missing samples stay unknown, never advertise precision',()=>{
 assert.equal(display(null).both,'—');
 const d=display({mode:'V110_TWO_FULLY_CLOSED_5M_SHADOW',
  status:'COLLECTING_CLOSED_5M_WINDOWS',matured:10,distinctUtcDays:1,
  complete:{n:10,bothAndNetPositivePct:90,medianMinutesToSecondFullClose:12},
  byDirection:{LONG:{n:8,firstFull5mFavorablePct:100,secondFull5mFavorablePct:100,
   bothAndNetPositivePct:100},SHORT:{n:2,firstFull5mFavorablePct:50}}});
 assert.equal(d.sample,'10');assert.equal(d.both,'—');
 assert.equal(d.directions[0][2],'—');
 assert.match(d.status,/недостаточна/);
});
test('matured descriptive cohort shows both LONG and SHORT, explicitly not live',()=>{
 const a=display({mode:'V110_TWO_FULLY_CLOSED_5M_SHADOW',
  status:'DESCRIPTIVE_SAMPLE_AVAILABLE',distinctUtcDays:5,matured:200,
  complete:{n:200,bothAndNetPositivePct:31.5,medianMinutesToSecondFullClose:12.5},
  byDirection:{LONG:{n:120,firstFull5mFavorablePct:55,secondFull5mFavorablePct:42,
   bothAndNetPositivePct:32},SHORT:{n:80,firstFull5mFavorablePct:50,
   secondFull5mFavorablePct:48,bothAndNetPositivePct:31}}});
 assert.equal(a.both,'31.5%');
 assert.equal(a.delay,'12.5 мин');
 assert.equal(a.directions.length,2);
 assert.equal(a.directions[0][0],'📈 LONG');
 assert.equal(a.directions[1][0],'📉 SHORT');
 assert.match(a.status,/№108 НЕ изменён/);
});
