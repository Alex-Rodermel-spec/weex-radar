import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {forecastHypothesisAudit,FORECAST_STUDY_PROTOCOL as protocol}
 from '../lib/forecast-hypotheses.mjs';
import {summarizeForecastArchive} from '../lib/forecast-journal.mjs';

const MIN=60000;
const NOW=Date.UTC(2026,10,15,9,0);
const CUT=Date.parse(protocol.forwardFrom);
const mk=(i,overrides={})=>({
 id:String(i).padStart(32,'a'),
 symbol:['BTCUSDT','ETHUSDT','XRPUSDT'][i%3],
 sentAt:CUT+MIN*(i+2),
 direction:i%2===0?'SHORT':'LONG',
 strength:i%2===0?'STRONG':'STANDARD',
 reference:100,
 preMove15mBps:i%2===0?20:0,
 windows:Object.fromEntries([1,5,10,15,30].map(h=>[h,{status:'OBSERVED',moveBps:i%2===0?25:-15}])),
 ...overrides
});
test('preregistered forecast study uses an independent future cohort',()=>{
 const before=mk(1,{sentAt:CUT-10*MIN,direction:'LONG'});
 const after=mk(2);
 const result=forecastHypothesisAudit([before,after],NOW);
 assert.equal(result.protocol.primaryHorizonMinutes,15);
 assert.equal(result.protocol.priorMovementThresholdBps,10);
 assert.equal(result.exploratory.total,1);
 assert.equal(result.forward.total,1);
 assert.equal(result.exploratory.shortVsLong[15].left.observed,0);
 assert.equal(result.forward.shortVsLong[15].left.observed,1);
 assert.equal(result.forward.shortVsLong[15].status,'COLLECTING');
});
test('coverage is based on matured rows, no missing result is scored as a loss',()=>{
 const early=mk(5,{direction:'SHORT'});
 const noData=mk(7,{direction:'SHORT',windows:{5:{status:'NO_DATA'},
  10:{status:'NO_DATA'},15:{status:'NO_DATA'}}});
 const pending=mk(10,{direction:'SHORT',sentAt:NOW-3*MIN,
  windows:{5:{status:'PENDING'},10:{status:'PENDING'},15:{status:'PENDING'}}});
 const r=forecastHypothesisAudit([early,noData,pending],NOW).forward.shortVsLong;
 assert.equal(r[15].left.total,2);
 assert.equal(r[15].left.observed,1);
 assert.equal(r[15].left.missing,1);
 assert.equal(r[15].left.coveragePct,50);
 assert.equal(r[15].left.favorablePct,0); // mk(5) has a genuine adverse close.
 assert.equal(r[5].left.total,2);
 assert.equal(r[15].status,'COLLECTING');
});
test('fair comparison needs 50 measured per side and three shared coins',()=>{
 const rows=[];
 for(let i=0;i<100;i++){
  const coin=['BTCUSDT','ETHUSDT','XRPUSDT'][i%3];
  rows.push(mk(i+100,{
   symbol:coin,direction:i%2===0?'SHORT':'LONG',
   sentAt:CUT+i*MIN,
   windows:Object.fromEntries([1,5,10,15,30].map(h=>
    [h,{status:'OBSERVED',moveBps:i%2===0?40:-40}]))
  }));
 }
 const compare=forecastHypothesisAudit(rows,NOW).forward.shortVsLong[15];
 assert.equal(compare.left.observed,50);
 assert.equal(compare.right.observed,50);
 assert.equal(compare.sharedSymbols,3);
 assert.equal(compare.stratifiedDifferencePp,100);
 assert.equal(compare.differencePp,100);
 assert.equal(compare.readyForReview,true);
 assert.equal(compare.passesDescriptiveThreshold,true);
 assert.equal(compare.status,'REVIEW_ONLY'); // NEVER "proven" or "profitable"
 // A fourth coin present only on the winning side must not inflate shared coins.
 const extra=mk(999,{direction:'SHORT',symbol:'HYPEUSDT'});
 const compareExtra=forecastHypothesisAudit([...rows,extra],NOW).forward.shortVsLong[15];
 assert.equal(compareExtra.sharedSymbols,3);
});
test('timeliness distinguishes already-moved signals from actual 15m outcomes',()=>{
 const rows=[
  mk(4,{strength:'STRONG',preMove15mBps:25}),
  mk(5,{strength:'STANDARD',preMove15mBps:0}),
  mk(6,{strength:'STANDARD',preMove15mBps:null}),
 ];
 const r=forecastHypothesisAudit(rows,NOW).forward;
 assert.equal(r.standardEarlierThanStrong.left.observed,1);
 assert.equal(r.standardEarlierThanStrong.left.missing,1);
 assert.equal(r.standardEarlierThanStrong.right.latePct,100);
 assert.equal(r.standardEarlierThanStrong.strongMinusStandardLatePp,100);
 assert.equal(r.earlyVsLate[15].left.observed,1);
 assert.equal(r.earlyVsLate[15].right.observed,1);
 assert.equal(r.missingPriorMovement,1);
});
test('separating LONG and SHORT exposes timing effects hidden by pooled accuracy',()=>{
 const windows=move=>Object.fromEntries([1,5,10,15,30].map(h=>
  [h,{status:'OBSERVED',moveBps:move}]));
 const rows=[
  mk(100,{direction:'LONG',strength:'STANDARD',
   preMove15mBps:0,windows:windows(20)}),
  mk(101,{direction:'LONG',strength:'STANDARD',
   preMove15mBps:15,windows:windows(-20)}),
  mk(102,{direction:'SHORT',strength:'STANDARD',
   preMove15mBps:0,windows:windows(-20)}),
  mk(103,{direction:'SHORT',strength:'STANDARD',
   preMove15mBps:15,windows:windows(20)}),
  mk(104,{direction:'LONG',strength:'STANDARD',
   preMove15mBps:null,windows:windows(20)})
 ];
 const a=forecastHypothesisAudit(rows,NOW).forward;
 assert.equal(a.earlyVsLate[15].differencePp,0,
  'pooled result hides which direction is helped by early signals');
 assert.equal(a.timingByDirection.LONG[15].differencePp,100);
 assert.equal(a.timingByDirection.SHORT[15].differencePp,-100);
 assert.equal(a.timingByDirection.LONG.earlyTotal,1);
 assert.equal(a.timingByDirection.LONG.lateTotal,1);
 assert.equal(a.timingByDirection.LONG.missingPriorMovement,1);
 assert.equal(a.timingByDirection.LONG[15].status,'COLLECTING');
 assert.equal(a.timingByDirection.SHORT[15].status,'COLLECTING');
 const report=summarizeForecastArchive(rows,NOW).windows[30].hypothesisAudit.forward;
 assert.equal(report.timingByDirection.SHORT[15].differencePp,-100);
 assert.doesNotMatch(JSON.stringify(report.timingByDirection),
  /"id"|"sentAt"|"reference"|"price"/);
});
test('direction-specific timing excludes unmatured and unknown price outcomes',()=>{
 const rows=[
  mk(112,{direction:'LONG',preMove15mBps:0,
   sentAt:NOW-2*MIN,windows:{5:{status:'PENDING'},15:{status:'PENDING'}}}),
  mk(113,{direction:'LONG',preMove15mBps:15,
   windows:{5:{status:'NO_DATA'},15:{status:'NO_DATA'}}}),
  mk(114,{direction:'LONG',preMove15mBps:0,
   windows:{5:{status:'OBSERVED',moveBps:17},15:{status:'OBSERVED',moveBps:9}}})
 ];
 const c=forecastHypothesisAudit(rows,NOW).forward.timingByDirection.LONG[15];
 assert.equal(c.left.total,1);
 assert.equal(c.left.observed,1);
 assert.equal(c.right.total,1);
 assert.equal(c.right.observed,0);
 assert.equal(c.right.coveragePct,0);
 assert.equal(c.differencePp,null);
 assert.equal(c.readyForReview,false);
});

test('journal exposes only aggregate hypothesis comparisons and browser script is valid',()=>{
 const report=summarizeForecastArchive([mk(4),mk(5)],NOW);
 const audit=report.windows[30].hypothesisAudit;
 assert.equal(audit.forward.total,2);
 const serialized=JSON.stringify(audit);
 assert.doesNotMatch(serialized,/"id"|"sequence_id"|"reference"|"sentAt"|"price"/);
 assert.doesNotMatch(serialized,/NTFY_TOPIC|PUSH_CRON_KEY/);
 const html=readFileSync(new URL('../history.html',import.meta.url),'utf8');
 assert.match(html,/id="forecastHypotheses"/);
 assert.match(html,/Ранние LONG против запоздалых LONG/);
 assert.match(html,/Ранние SHORT против запоздалых SHORT/);
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);assert.doesNotThrow(()=>new Script(script[1]));
 const source=readFileSync(new URL('../lib/forecast-hypotheses.mjs',import.meta.url),'utf8');
 for(const forbidden of [/trade-confirm/,/placeOrder/,/capi\/v3\/order/,/ntfy\.sh/,/fetch\(/]){
  assert.doesNotMatch(source,forbidden);
 }
});
