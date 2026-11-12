import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {classifyStrongArrival,strongTimingShadowAudit,STRONG_TIMING_PROTOCOL}
 from '../lib/forecast-strong-timing-shadow.mjs';
import {summarizeForecastArchive} from '../lib/forecast-journal.mjs';

const NOW=Date.UTC(2026,10,12,14,30);
const BEFORE=Date.UTC(2026,10,12,10,30);
const AFTER=Date.UTC(2026,10,12,13,10);
let id=0;
function alert({
 sentAt=BEFORE,strength='STRONG',v2Timing='CLEAR',direction='SHORT',
 preMove1mBps=1,preMove3mBps=2,preMove5mBps=2,preMove15mBps=3,
 symbol='BTCUSDT',move5=-10,move15=10,firstAdverse=null,
 firstFavorable=3
}={}){
 const win=x=>({status:'OBSERVED',moveBps:x});
 return {id:String(++id).padStart(32,'f'),symbol,sentAt,strength,
  v2Timing,direction,preMove1mBps,preMove3mBps,
  preMove5mBps,preMove15mBps,
  firstAdverse10bpsMinute:firstAdverse,
  firstFavorable10bpsMinute:firstFavorable,
  windows:{5:win(move5),15:win(move15),30:win(4)}};
}
test('STRONG with V2 LATE stays potential late even if direction is right',()=>{
 const r=alert({v2Timing:'LATE',move5:12});
 assert.equal(classifyStrongArrival(r),'V2_LATE');
 const study=strongTimingShadowAudit([r],NOW);
 assert.equal(study.historicalExploration.groups.V2_LATE.total,1);
 assert.equal(study.historicalExploration.groups.V2_LATE.at5m.favorablePct,100);
 assert.equal(study.tradeReady,false);
 assert.equal(study.protocol.noLiveSignalsChanged,true);
});
test('V2 CLEAR misses fast 1m and 3m burst, even when 15m move is small',()=>{
 const r=alert({preMove1mBps:12,preMove3mBps:13,
  preMove5mBps:6,preMove15mBps:4,move5:5});
 assert.equal(classifyStrongArrival(r),'V2_CLEAR_FAST_EXTENDED');
 const report=strongTimingShadowAudit([r],NOW).historicalExploration;
 assert.equal(report.groups.V2_CLEAR_FAST_EXTENDED.total,1);
 assert.equal(report.counterfactual.FLAGGED_LATE.total,1);
 assert.equal(report.groups.V2_CLEAR_FAST_EXTENDED.at5m.favorable,1);
 assert.equal(report.comparison.readyForResearchReview,false);
});
test('older 5m/15m move can warn when 1/3m are quiet, but missing 1m must remain unknown',()=>{
 assert.equal(classifyStrongArrival(alert({preMove5mBps:12,
  preMove15mBps:15})),'V2_CLEAR_SLOW_EXTENDED');
 assert.equal(classifyStrongArrival(alert({preMove1mBps:null,
  preMove3mBps:null})),'UNKNOWN_PREHISTORY');
 assert.equal(classifyStrongArrival(alert({v2Timing:null})),
  'UNKNOWN_V2');
 assert.equal(classifyStrongArrival(alert({strength:'CAUTION'})),'NOT_STRONG');
 assert.equal(classifyStrongArrival(alert()),'V2_CLEAR_EARLY_CANDIDATE');
});
test('future results cannot influence the fixed pre-alert classification',()=>{
 const good=alert({move5:22,move15:50,firstAdverse:null,firstFavorable:2});
 const bad={...good,windows:{
  5:{status:'OBSERVED',moveBps:-50},
  15:{status:'OBSERVED',moveBps:-50},
  30:{status:'OBSERVED',moveBps:-50}
 },firstAdverse10bpsMinute:1,firstFavorable10bpsMinute:17};
 assert.equal(classifyStrongArrival(good),'V2_CLEAR_EARLY_CANDIDATE');
 assert.equal(classifyStrongArrival(bad),'V2_CLEAR_EARLY_CANDIDATE');
 assert.equal(strongTimingShadowAudit([good,bad],NOW).historicalExploration.groups
  .V2_CLEAR_EARLY_CANDIDATE.first10bps.adverseFirst,1);
});
test('new prospective cohort cannot claim historical data as independent confirmation',()=>{
 const old=alert({sentAt:BEFORE,move5:12}),
  newNotice=alert({sentAt:AFTER,v2Timing:'LATE',move5:-15});
 const study=strongTimingShadowAudit([old,newNotice],NOW);
 assert.equal(study.historicalExploration.total,1);
 assert.equal(study.prospectiveValidation.total,1);
 assert.equal(study.historicalExploration.groups.V2_CLEAR_EARLY_CANDIDATE.total,1);
 assert.equal(study.prospectiveValidation.groups.V2_LATE.total,1);
 assert.equal(study.prospectiveValidation.comparison.readyForResearchReview,false);
 assert.equal(STRONG_TIMING_PROTOCOL.prospectiveFrom,'2026-11-12T12:00:00.000Z');
});
test('only aggregate read-only archive, UI script compiles, no order/ntfy mutations',()=>{
 const summary=summarizeForecastArchive([],NOW);
 assert.equal(summary.windows[30].strongTimingShadow.mode,
  'READ_ONLY_STRONG_TIMING_COUNTERFACTUAL');
 const mod=readFileSync(new URL('../lib/forecast-strong-timing-shadow.mjs',import.meta.url),'utf8');
 const journal=readFileSync(new URL('../lib/forecast-journal.mjs',import.meta.url),'utf8');
 const html=readFileSync(new URL('../history.html',import.meta.url),'utf8');
 assert.match(journal,/strongTimingShadow:strongTimingShadowAudit\(selected,now\)/);
 assert.match(html,/id="strongArrivalRows"/);
 assert.match(html,/id="strongArrivalSummary"/);
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
 for(const forbidden of [/trade-confirm/,/placeOrder/,/sendOrder/,
  /ntfySend/,/push-dispatch/,/process\.env/,/fetch\(/,/_API_SECRET/])
  assert.doesNotMatch(mod,forbidden);
});
