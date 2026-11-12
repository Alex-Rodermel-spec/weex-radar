import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {normalizeForecastMinutes,evaluatePublishedForecast,
 normalizeForecastArchiveRow,mergeForecastArchive,summarizeForecastArchive
} from '../lib/forecast-journal.mjs';
import {fastArrivalStatus,forecastTimingAudit} from '../lib/forecast-timing-audit.mjs';

const MIN=60000;
const at=Date.UTC(2026,10,12,6,0,12);
const now=at+40*MIN;
const forecast={id:'c'.repeat(32),symbol:'BTCUSDT',direction:'SHORT',
 strength:'STRONG',v2Timing:'CLEAR',sentAt:at,reference:100};
function fakeBars({fastBurst=true}={}){
 const boundary=Math.floor(at/MIN)*MIN;
 // Latest 1m bar closed before publication, and 16 older fully closed
 // candles. The old 15m movement is <=0.1%, though the LAST 1–3m
 // movement is >0.1%; so V2's 15m-only test can miss this exact pattern.
 const before=Array.from({length:16},(_,i)=>{
  const close=fastBurst?(i<12?99.9:100.28-(i-12)*.065):99.98;
  return [boundary-(16-i)*MIN,close,close+.05,close-.05,close,100];
 });
 const start=boundary+MIN;
 const after=Array.from({length:34},(_,i)=>{
  const close=99.8-i*.001;
  return [start+i*MIN,close,close+.05,close-.05,close,100];
 });
 return [...before,...after];
}
test('repeated signal may be RIGHT on direction but too late; V2 CLEAR can miss a 1–3m burst',()=>{
 const result=evaluatePublishedForecast(forecast,
  normalizeForecastMinutes(fakeBars(),now),now);
 assert.ok(result.preMove1mBps>=10);
 assert.ok(result.preMove3mBps>=10);
 assert.ok(result.preMove15mBps<10);
 assert.equal(fastArrivalStatus(result),'ALREADY_EXTENDED');
 assert.equal(result.windows[5].status,'OBSERVED');
 assert.ok(result.windows[5].moveBps>0);
 const study=forecastTimingAudit([result],now);
 assert.equal(study.forward.total,1);
 assert.equal(study.forward.v2Clear.alreadyExtended.total,1);
 assert.equal(study.forward.v2Clear.notExtended.total,0);
 assert.equal(study.forward.v3Pass.alreadyExtended.total,1,
  'Old V3 PASS may have missed a shorter late acceleration');
 assert.equal(study.forward.v2Clear.readyForResearchReview,false);
 assert.equal(study.protocol.ordersSent,0);
});
test('1m/3m prior metrics use closed candles BEFORE message, not outcome leakage',()=>{
 const futurePriceSpy=fakeBars();
 const partial=evaluatePublishedForecast(forecast,
  normalizeForecastMinutes(futurePriceSpy,at+2*MIN+1000),at+2*MIN+1000);
 const full=evaluatePublishedForecast(forecast,
  normalizeForecastMinutes(futurePriceSpy,now),now);
 assert.equal(partial.preMove1mBps,full.preMove1mBps);
 assert.equal(partial.preMove3mBps,full.preMove3mBps);
 assert.equal(partial.windows[30].status,'PENDING');
 assert.equal(full.windows[30].status,'OBSERVED');
 const gaps=fakeBars().filter((_,i)=>i!==14);
 const gap=evaluatePublishedForecast(forecast,
  normalizeForecastMinutes(gaps,now),now);
 assert.equal(gap.preMove1mBps,null);
 assert.equal(fastArrivalStatus(gap),'ALREADY_EXTENDED',
  'A complete 3m window can still report evidence of past extension');
});
test('old encrypted archive fields remain UNKNOWN and are backfilled without erasing measured outcomes',()=>{
 const complete=evaluatePublishedForecast(forecast,
  normalizeForecastMinutes(fakeBars(),now),now);
 const old={...complete};
 delete old.preMove1mBps;delete old.preMove3mBps;
 const legacy=normalizeForecastArchiveRow(old,now);
 assert.equal(legacy.preMove1mBps,null);
 assert.equal(legacy.preMove3mBps,null);
 assert.equal(fastArrivalStatus(legacy),'UNKNOWN');
 const study=forecastTimingAudit([legacy],now);
 assert.equal(study.forward.v2Clear.unknown.total,1);
 assert.equal(study.forward.v2Clear.alreadyExtended.total,0);
 const repaired=mergeForecastArchive([legacy],[complete],now);
 assert.equal(repaired.rows[0].preMove1mBps,complete.preMove1mBps);
 assert.equal(repaired.rows[0].preMove3mBps,complete.preMove3mBps);
 assert.equal(repaired.rows[0].windows[5].moveBps,legacy.windows[5].moveBps);
 const report=summarizeForecastArchive(repaired.rows,now).windows[30].timingAudit;
 assert.equal(report.forward.all.prior[1].observed,1);
 assert.equal(report.forward.all.prior[3].observed,1);
});
test('unknown prior 1m and 3m remains separate; no invented successes',()=>{
 const r={...forecast,windows:{
   5:{status:'NO_DATA',moveBps:null},
   15:{status:'PENDING',moveBps:null}
 },preMove1mBps:null,preMove3mBps:null,preMove5mBps:null,preMove15mBps:null};
 const study=forecastTimingAudit([r],now);
 assert.equal(study.forward.unknownFast.total,1);
 assert.equal(study.forward.v2Clear.alreadyExtended.total,0);
 assert.equal(study.forward.all.at5m.observed,0);
 assert.equal(study.forward.all.at5m.noData,1);
 assert.equal(study.forward.v2Clear.notExtended.total,0);
});
test('read-only timeline panel isolates phone, cron, forecast generation and all order permissions',()=>{
 const src=readFileSync(new URL('../lib/forecast-timing-audit.mjs',import.meta.url),'utf8');
 const journal=readFileSync(new URL('../lib/forecast-journal.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../history.html',import.meta.url),'utf8');
 assert.match(journal,/preMove1mBps:priorMomentum\(forecast,map,1\)/);
 assert.match(journal,/preMove3mBps:priorMomentum\(forecast,map,3\)/);
 assert.match(journal,/timingAudit:forecastTimingAudit\(selected,now\)/);
 assert.match(ui,/id="fastTimingPrior"/);
 assert.match(ui,/id="fastTimingGroups"/);
 assert.match(ui,/id="fastTimingSummary"/);
 const script=ui.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
 for(const banned of [/trade-confirm/,/placeOrder/,/\/order/,/WEEX_API_SECRET/,
   /ntfySend/,/push-dispatch/,/process\.env/,/fetch\(/])
  assert.doesNotMatch(src,banned);
});
