import test from 'node:test';
import assert from 'node:assert/strict';
import {assessStrongLevelRoom,STRONG_LEVEL_POLICY} from '../lib/strong-level-gate.mjs';
import {classifyTwoStageConfirmation} from '../lib/two-stage-confirmation.mjs';
const CLOSE=Date.UTC(2026,10,12,18,10);
function sample(direction='LONG'){
 const isLong=direction==='LONG';
 return {symbol:'XRPUSDT',exchange:'WEEX',direction,status:'ok',level:'STRONG',
  candleCloseTime:CLOSE,livePrice:100,stop:isLong?99:101,
  take:isLong?102:98,closedFiveMinuteMoveBps:20,
  indicators:{volumeRatio:1.5},
  entryQuality:{ok:true,rr:2,nearestLevel:null,roomR:null},
  advisor:{status:'REVIEW'},costReview:{status:'PASS_ESTIMATE'},
  levelReview:{mode:'CLOSED_5M_OBSERVATION',lookback:12,interval:'5m',
   candleCloseTime:CLOSE,support:isLong?98:100.2,
   resistance:isLong?99.7:102,
   breakoutDirection:direction,candleState:isLong?'BREAK_UP':'BREAK_DOWN',
   closeQuality:'SUPPORTED',recentFakeouts:{LONG:null,SHORT:null}}
 };
}
test('supported 5m LONG and SHORT with past 12-candle levels have no obstacle ahead',()=>{
 for(const direction of ['LONG','SHORT']){
  const proof=assessStrongLevelRoom(sample(direction));
  assert.equal(proof.ok,true,direction);
  assert.equal(proof.closest,null);
  assert.equal(proof.roomR,null);
 }
 assert.equal(STRONG_LEVEL_POLICY.minRoomRisk,1.5);
 assert.equal(STRONG_LEVEL_POLICY.lookback5m,12);
 assert.equal(STRONG_LEVEL_POLICY.nearestPivotLookback5m,60);
 assert.equal(STRONG_LEVEL_POLICY.noOrders,true);
});
test('a nearby resistance for LONG or support for SHORT downgrades STRONG only',()=>{
 const long=sample('LONG');long.levelReview.resistance=100.4;
 const short=sample('SHORT');short.levelReview.support=99.6;
 for(const s of [long,short]){
  const proof=assessStrongLevelRoom(s);
  assert.equal(proof.ok,false);
  assert.equal(proof.reason,'LEVEL_NEAR_OPPOSING_OBSTACLE');
  assert.ok(proof.closest.roomR<1.5);
  // Two-stage classifier must NEVER independently upgrade a weak level
  // even if an earlier ordinary notice would be available.
  const downgraded=classifyTwoStageConfirmation(s,[],CLOSE+20_000);
  assert.equal(downgraded.level,'NORMAL');
  assert.equal(downgraded.twoStage.reason,proof.reason);
 }
});
test('mature 60-bar swing pivot is checked after fresh quote before confirming',()=>{
 for(const direction of ['LONG','SHORT']){
  const s=sample(direction);
  s.entryQuality.nearestLevel=direction==='LONG'?100.8:99.2;
  assert.equal(assessStrongLevelRoom(s).reason,'LEVEL_NEAR_OPPOSING_OBSTACLE');
  s.entryQuality.nearestLevel=direction==='LONG'?101.7:98.3;
  assert.equal(assessStrongLevelRoom(s).ok,true);
  s.entryQuality.nearestLevel=null;
  assert.equal(assessStrongLevelRoom(s).ok,true);
 }
});
test('weak break, stale level review, rejected wick, recent false breakout fail closed',()=>{
 const s=sample();
 for(const changes of [
  {closeQuality:'WEAK'}, {candleState:'FAKE_UP',breakoutDirection:null},
  {candleCloseTime:CLOSE-300_000},
  {lookback:6},{support:0},{recentFakeouts:{LONG:{barsAgo:1},SHORT:null}}
 ]){
  const trial={...s,levelReview:{...s.levelReview,...changes}};
  assert.equal(assessStrongLevelRoom(trial).ok,false,JSON.stringify(changes));
 }
 assert.equal(assessStrongLevelRoom({...s,levelReview:null}).reason,'LEVEL_HISTORY_MISSING');
});
test('manual entry quote recheck, stop/TP, and risk are compulsory',()=>{
 const s=sample();
 for(const input of [
  {livePrice:null}, {stop:100}, {take:99.9},
  {entryQuality:{ok:false,nearestLevel:null}},
  {entryQuality:{ok:true,nearestLevel:-1}},
  {stop:99.6,take:100.5}
 ]){
  assert.equal(assessStrongLevelRoom({...s,...input}).ok,false,JSON.stringify(input));
 }
});
test('ordinary early forecasts keep their status and need no strong-level data',()=>{
 const s=sample(); s.level='NORMAL';s.levelReview=null;
 assert.equal(classifyTwoStageConfirmation(s,[],CLOSE+20_000),s);
});
