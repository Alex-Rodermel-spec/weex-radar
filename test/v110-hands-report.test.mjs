import test from 'node:test';
import assert from 'node:assert/strict';
import {buildV110HandsReviewReport} from '../lib/v110-hands-report.mjs';
const windows=move=>Object.fromEntries([1,5,10,15,30].map(h=>[h,{moveBps:move}]));
test('reports LONG and SHORT independently at all five horizons',()=>{
 const rows=[
  {direction:'LONG',strength:'STANDARD',preMove5mBps:2,windows:windows(5),firstFavorableMinute:3,alreadyMovedBeforeAlert:false},
  {direction:'LONG',strength:'CAUTION',preMove5mBps:2,windows:windows(-3),firstFavorableMinute:8,alreadyMovedBeforeAlert:true},
  {direction:'SHORT',strength:'STRONG',preMove5mBps:1,windows:windows(4),firstFavorableMinute:2}
 ];
 const r=buildV110HandsReviewReport(rows,'LONG_SKIP_CAUTION_CHASE');
 assert.equal(r.baseline.LONG.n,2);
 assert.equal(r.candidate.LONG.n,1);
 assert.equal(r.baseline.LONG.horizons[15].favorablePct,50);
 assert.equal(r.candidate.LONG.horizons[15].favorablePct,100);
 assert.equal(r.candidate.SHORT.n,1);
 assert.equal(r.baseline.LONG.lateAlertPct,50);
 assert.equal(r.recommendation,'KEEP_108');
 assert.equal(r.approvedForLive,false);
 for(const h of [1,5,10,15,30])assert.equal(r.candidate.LONG.horizons[h].observed,1);
});
test('unknown pre-move excluded, missing horizons never invented',()=>{
 const r=buildV110HandsReviewReport([
  {direction:'LONG',strength:'STANDARD',windows:{15:{moveBps:5}}}
 ],'LONG_SKIP_CHASE');
 assert.equal(r.candidate.LONG.n,0);
 assert.equal(r.baseline.LONG.horizons[1].favorablePct,null);
 assert.equal(r.baseline.LONG.horizons[15].observed,1);
 assert.equal(r.baseline.LONG.medianFirstFavorableMinute,null);
});
test('invalid input fails closed',()=>{
 assert.equal(buildV110HandsReviewReport(null,'LONG_SKIP_CHASE').status,'INVALID_INPUT');
 assert.equal(buildV110HandsReviewReport([],'UNLISTED').recommendation,'KEEP_108');
});
