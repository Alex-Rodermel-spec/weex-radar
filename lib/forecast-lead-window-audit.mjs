// Independent READ-ONLY validation of the "15–19 minute lead" hypothesis.
// "First +10 bps" means first 1m close at least 0.10% in forecast direction
// AFTER ntfy publication. It is not the beginning of a price move, trade entry,
// or statistically demonstrated edge. Uses existing AES-GCM journal ONLY.
import {classifyForecastQualityShadow,QUALITY_GATE_PROTOCOL} from './forecast-quality-gate.mjs';

export const LEAD_PROTOCOL=Object.freeze({
 version:'2026-11-12-15to19-independent-audit-v1',
 forwardFrom:QUALITY_GATE_PROTOCOL.forwardFrom,
 thresholdBps:10,
 targetMinuteFrom:15,targetMinuteThrough:19,
 measuredHorizonMinutes:30,
 priorWindowsMinutes:[1,3,5,15],
 minimumObservedPerV3Group:50,
 minimumSharedSymbols:3,
 minimumPerSymbolPerV3Group:5,
 neverChangesSignals:true,
 notATrade:true,ordersSent:0
});
const ROUND=x=>Math.round(x*10)/10;
const FINITE=x=>typeof x==='number'&&Number.isFinite(x);
const PRIOR=['preMove1mBps','preMove3mBps','preMove5mBps','preMove15mBps'];
export function preAlertStatus(row){
 const values=PRIOR.map(k=>row?.[k]);
 if(values.some(v=>FINITE(v)&&v>=LEAD_PROTOCOL.thresholdBps))return 'ALREADY_EXTENDED';
 if(values.some(v=>!FINITE(v)))return 'UNKNOWN_PREHISTORY';
 return 'NOT_EXTENDED';
}
export function onsetWindow(row){
 const minute=row?.firstFavorable10bpsMinute;
 if(minute===null||minute===undefined)return 'NEVER_30M';
 if(!Number.isInteger(minute)||minute<1||minute>30)return 'UNVERIFIED';
 if(minute<=5)return '1_TO_5';
 if(minute<=9)return '6_TO_9';
 if(minute<=14)return '10_TO_14';
 if(minute<=19)return '15_TO_19';
 return '20_TO_30';
}
function report(rows){
 const matured=rows.filter(x=>x?.windows?.[30]?.status==='OBSERVED'&&
  FINITE(x.windows[30].moveBps));
 const counts={};
 for(const key of ['1_TO_5','6_TO_9','10_TO_14','15_TO_19','20_TO_30','NEVER_30M','UNVERIFIED'])
  counts[key]=0;
 for(const r of matured)counts[onsetWindow(r)]++;
 const target=matured.filter(r=>onsetWindow(r)==='15_TO_19');
 const clean=target.filter(r=>preAlertStatus(r)==='NOT_EXTENDED'&&
  // Disallow a first >=0.10% reversal BEFORE the first +0.10% print.
  (r.firstAdverse10bpsMinute===null||
   r.firstAdverse10bpsMinute===undefined||
   Number.isInteger(r.firstAdverse10bpsMinute)&&
    r.firstAdverse10bpsMinute>r.firstFavorable10bpsMinute));
 const preExtended=target.filter(r=>preAlertStatus(r)==='ALREADY_EXTENDED');
 const preUnknown=target.filter(r=>preAlertStatus(r)==='UNKNOWN_PREHISTORY');
 const adverseFirst=target.filter(r=>Number.isInteger(r.firstAdverse10bpsMinute)&&
  r.firstAdverse10bpsMinute<=r.firstFavorable10bpsMinute);
 const byDirection=Object.fromEntries(['LONG','SHORT'].map(direction=>{
  const d=matured.filter(r=>r.direction===direction);
  const subset=target.filter(r=>r.direction===direction);
  return [direction,{complete30m:d.length,reached15to19:subset.length,
   preAlertClean:clean.filter(r=>r.direction===direction).length,
   reachedPct:d.length?ROUND(subset.length*100/d.length):null}];
 }));
 const byV3=Object.fromEntries(['PASS','SKIP','UNKNOWN'].map(key=>{
  const d=matured.filter(r=>classifyForecastQualityShadow(r)===key);
  const subset=target.filter(r=>classifyForecastQualityShadow(r)===key);
  return [key,{complete30m:d.length,reached15to19:subset.length,
   preAlertClean:clean.filter(r=>classifyForecastQualityShadow(r)===key).length,
   reachedPct:d.length?ROUND(subset.length*100/d.length):null}];
 }));
 return {published:rows.length,complete30m:matured.length,
  incomplete30m:rows.length-matured.length,
  firstCrossingBuckets:counts,
  target15to19:{
   reached:target.length,pctAllComplete:matured.length?
    ROUND(100*target.length/matured.length):null,
   noPriorExtensionAndNoEarlierAdverse:clean.length,
   alreadyExtendedBeforeAlert:preExtended.length,
   unknownPriorHistory:preUnknown.length,
   earlierAdverseCrossing:adverseFirst.length
  },
  byDirection,byV3,
  note:'All percentages count ALL forecasts with 30m fully closed candles, not only successful predictions. A 15–19 minute first 0.1% crossing does not prove market-move onset, early trade execution or profit.'};
}
export function forecastLeadWindowAudit(rows,now=Date.now()){
 if(!Array.isArray(rows))throw Error('FORECAST_LEAD_AUDIT_INVALID');
 const eligible=rows.filter(r=>r&&Number.isSafeInteger(r.sentAt)&&
  r.sentAt>0&&r.sentAt<=now);
 const cut=Date.parse(LEAD_PROTOCOL.forwardFrom);
 return {mode:'READ_ONLY_15_TO_19_HYPOTHESIS',protocol:LEAD_PROTOCOL,
  historicalExploration:report(eligible.filter(r=>r.sentAt<cut)),
  forwardValidation:report(eligible.filter(r=>r.sentAt>=cut)),
  independentlyProven:false,
  caveat:'No ex-ante randomized or no-alert market baseline, overlapping signals and short samples prevent causal claims. Fully observed 30m path required; future candles cannot influence the original forecast. LONG/SHORT and V3 groups are descriptive. All first-crossing buckets are mutually exclusive, including minute 15 exactly once. Not a profitability estimate or advice to trade.'};
}
