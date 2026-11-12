import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {forecastLeadWindowAudit,onsetWindow,preAlertStatus} from '../lib/forecast-lead-window-audit.mjs';
import {summarizeForecastArchive} from '../lib/forecast-journal.mjs';

const NOW=Date.UTC(2026,10,12,13,0);
let seq=0;
function row(first,{sentAt=Date.UTC(2026,10,12,6,0),
 side='SHORT',strength='STRONG',pre=null,adverse=null,full=true}={}){
 const preData=pre??{preMove1mBps:0,preMove3mBps:0,
  preMove5mBps:0,preMove15mBps:0};
 return {id:String(++seq).padStart(32,'a'),symbol:'BTCUSDT',direction:side,
  strength,reference:100,v2Timing:'CLEAR',sentAt,
  ...preData,
  firstFavorable10bpsMinute:first,firstAdverse10bpsMinute:adverse,
  windows:{5:{status:'OBSERVED',moveBps:0},
   15:{status:'OBSERVED',moveBps:0},
   20:{status:'OBSERVED',moveBps:0},
   30:full?{status:'OBSERVED',moveBps:5}:{status:'PENDING',moveBps:null}}
 };
}
test('hypothesis uses mutually exclusive 15–19m, does not double-count minute 15',()=>{
 const records=[row(5),row(6),row(9),row(10),row(14),row(15),
  row(19),row(20),row(30),row(null),row(15,{full:false})];
 const f=forecastLeadWindowAudit(records,NOW).forwardValidation;
 assert.equal(f.published,11);
 assert.equal(f.complete30m,10);
 assert.equal(f.incomplete30m,1);
 assert.deepEqual(f.firstCrossingBuckets,{
  '1_TO_5':1,'6_TO_9':2,'10_TO_14':2,'15_TO_19':2,
  '20_TO_30':2,'NEVER_30M':1,'UNVERIFIED':0});
 assert.equal(Object.values(f.firstCrossingBuckets).reduce((a,b)=>a+b,0),10);
 assert.equal(f.target15to19.reached,2);
 assert.equal(f.target15to19.pctAllComplete,20);
 assert.equal(f.target15to19.noPriorExtensionAndNoEarlierAdverse,2);
 assert.equal(onsetWindow({firstFavorable10bpsMinute:14}),'10_TO_14');
 assert.equal(onsetWindow({firstFavorable10bpsMinute:15}),'15_TO_19');
 assert.equal(onsetWindow({firstFavorable10bpsMinute:19}),'15_TO_19');
 assert.equal(onsetWindow({firstFavorable10bpsMinute:20}),'20_TO_30');
});
test('pre-existing trend, missing prehistory and adverse-first cannot be counted clean',()=>{
 const fastExtended=row(16,{pre:{preMove1mBps:12,preMove3mBps:5,
  preMove5mBps:2,preMove15mBps:0}});
 const historyExtended=row(17,{pre:{preMove1mBps:0,preMove3mBps:1,
  preMove5mBps:0,preMove15mBps:14}});
 const unknown=row(18,{pre:{preMove1mBps:null,preMove3mBps:null,
  preMove5mBps:0,preMove15mBps:0}});
 const adverseFirst=row(19,{adverse:2,side:'LONG'});
 const clean=row(15,{adverse:21});
 const f=forecastLeadWindowAudit([
  fastExtended,historyExtended,unknown,adverseFirst,clean
 ],NOW).forwardValidation;
 assert.equal(f.target15to19.reached,5);
 assert.equal(f.target15to19.noPriorExtensionAndNoEarlierAdverse,1);
 assert.equal(f.target15to19.alreadyExtendedBeforeAlert,2);
 assert.equal(f.target15to19.unknownPriorHistory,1);
 assert.equal(f.target15to19.earlierAdverseCrossing,1);
 assert.equal(f.byDirection.LONG.reached15to19,1);
 assert.equal(f.byDirection.SHORT.reached15to19,4);
 assert.equal(preAlertStatus(unknown),'UNKNOWN_PREHISTORY');
 assert.equal(preAlertStatus(fastExtended),'ALREADY_EXTENDED');
 assert.equal(preAlertStatus(clean),'NOT_EXTENDED');
});
test('forward-only cohort prevents historical selection from inflating new evidence',()=>{
 const old=row(17,{sentAt:Date.UTC(2026,10,11,19,0)});
 const fresh=row(17,{strength:'CAUTION'});
 const another=row(16,{side:'LONG'});
 const study=forecastLeadWindowAudit([old,fresh,another],NOW);
 assert.equal(study.historicalExploration.complete30m,1);
 assert.equal(study.forwardValidation.complete30m,2);
 assert.equal(study.forwardValidation.byV3.PASS.reached15to19,1);
 assert.equal(study.forwardValidation.byV3.SKIP.reached15to19,1);
 assert.equal(study.independentlyProven,false);
 assert.equal(study.protocol.ordersSent,0);
 assert.equal(study.protocol.neverChangesSignals,true);
});
test('visible forecast history, archive hook, and no effects on live ntfy or orders',()=>{
 const report=summarizeForecastArchive([],NOW);
 assert.equal(report.windows[30].leadWindowAudit.mode,'READ_ONLY_15_TO_19_HYPOTHESIS');
 const module=readFileSync(new URL('../lib/forecast-lead-window-audit.mjs',import.meta.url),'utf8');
 const journal=readFileSync(new URL('../lib/forecast-journal.mjs',import.meta.url),'utf8');
 const page=readFileSync(new URL('../history.html',import.meta.url),'utf8');
 assert.match(journal,/leadWindowAudit:forecastLeadWindowAudit\(selected,now\)/);
 assert.match(page,/id="forecastLeadSummary"/);
 assert.match(page,/id="forecastLeadBuckets"/);
 assert.match(page,/firstCrossingBuckets/);
 const script=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
 for(const banned of [/placeOrder/,/trade-confirm/,/ntfySend/,/push-dispatch/,
  /fetch\(/,/process\.env/,/api-contract\.weex\.com/])
  assert.doesNotMatch(module,banned);
});
