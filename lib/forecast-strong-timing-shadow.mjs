// Research-only counterfactual: did STRONG forecasts arrive early enough?
// Uses only fields available when the original ntfy message was published.
// Future 5m/15m outcomes are evaluated separately AFTER classification.
// No order, alert, cron, secret, budget or forecast severity changes.
import {classifyForecastQualityShadow} from './forecast-quality-gate.mjs';
import {fastArrivalStatus} from './forecast-timing-audit.mjs';

const FINITE=n=>typeof n==='number'&&Number.isFinite(n);
const round=n=>Math.round(n*10)/10;
const BASE_FIELDS=['preMove5mBps','preMove15mBps'];
const LABELS=Object.freeze([
 'V2_LATE','V2_CLEAR_FAST_EXTENDED','V2_CLEAR_SLOW_EXTENDED',
 'V2_CLEAR_EARLY_CANDIDATE','UNKNOWN_PREHISTORY','UNKNOWN_V2'
]);
export const STRONG_TIMING_PROTOCOL=Object.freeze({
 version:'2026-11-12-strong-on-time-shadow-v1',
 // Classification thresholds and cohorts are fixed before THIS forward test.
 prospectiveFrom:'2026-11-12T12:00:00.000Z',
 priorMovementThresholdBps:10,
 minPerComparisonGroup:30,minDistinctDays:5,minSharedSymbolDirections:3,
 minPerSidePerSymbolDirection:5,
 minimumCoveragePct:80,
 noLiveSignalsChanged:true,noNtfyChanged:true,noTrading:true,ordersSent:0
});
const berlinDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',
 year:'numeric',month:'2-digit',day:'2-digit'});
export function classifyStrongArrival(row){
 if(!row||row.strength!=='STRONG'||!['LONG','SHORT'].includes(row.direction))
  return 'NOT_STRONG';
 if(row.v2Timing==='LATE')return 'V2_LATE';
 if(row.v2Timing!=='CLEAR')return 'UNKNOWN_V2';
 const fast=fastArrivalStatus(row);
 if(fast==='ALREADY_EXTENDED')return 'V2_CLEAR_FAST_EXTENDED';
 if(fast==='UNKNOWN'||BASE_FIELDS.some(x=>!FINITE(row[x])))
  return 'UNKNOWN_PREHISTORY';
 if(BASE_FIELDS.some(x=>row[x]>=STRONG_TIMING_PROTOCOL.priorMovementThresholdBps))
  return 'V2_CLEAR_SLOW_EXTENDED';
 return 'V2_CLEAR_EARLY_CANDIDATE';
}
function measure(rows,h){
 let n=0,fav=0,adverse=0,flat=0,unknown=0,pending=0;
 for(const r of rows){
  const w=r.windows?.[h];
  if(w?.status==='OBSERVED'&&FINITE(w.moveBps)){
   n++;
   if(w.moveBps>0)fav++;
   else if(w.moveBps<0)adverse++;
   else flat++;
  }else if(w?.status==='PENDING')pending++;
  else unknown++;
 }
 return {total:rows.length,observed:n,favorable:fav,adverse,flat,
  pending,noData:unknown,
  favorablePct:n?round(100*fav/n):null,
  coveragePct:rows.length-pending?round(100*n/(rows.length-pending)):null};
}
function pathAdverse(rows){
 const measured=rows.filter(r=>r.windows?.[30]?.status==='OBSERVED'&&
  FINITE(r.windows?.[30]?.moveBps));
 const adverseFirst=measured.filter(r=>Number.isInteger(r.firstAdverse10bpsMinute)&&
  (r.firstFavorable10bpsMinute===null||
   r.firstFavorable10bpsMinute===undefined||
   r.firstAdverse10bpsMinute<=r.firstFavorable10bpsMinute));
 const firstFavorable=measured.filter(r=>Number.isInteger(r.firstFavorable10bpsMinute)&&
  (r.firstAdverse10bpsMinute===null||
   r.firstAdverse10bpsMinute===undefined||
   r.firstFavorable10bpsMinute<r.firstAdverse10bpsMinute));
 return {complete30m:measured.length,adverseFirst:adverseFirst.length,
  favorableFirst:firstFavorable.length,
  adverseFirstPct:measured.length?round(adverseFirst.length*100/measured.length):null};
}
function describe(rows){
 const days=new Set(rows.map(r=>berlinDay.format(r.sentAt))).size;
 return {total:rows.length,distinctBerlinDays:days,at5m:measure(rows,5),
  at15m:measure(rows,15),first10bps:pathAdverse(rows),
  byDirection:Object.fromEntries(['LONG','SHORT'].map(side=>[
   side,{total:rows.filter(r=>r.direction===side).length,
    at5m:measure(rows.filter(r=>r.direction===side),5),
    at15m:measure(rows.filter(r=>r.direction===side),15)}
  ])),
  byV3:Object.fromEntries(['PASS','SKIP','UNKNOWN'].map(key=>[
   key,{total:rows.filter(r=>classifyForecastQualityShadow(r)===key).length,
    at5m:measure(rows.filter(r=>classifyForecastQualityShadow(r)===key),5)}
  ]))};
}
function compare(rows){
 const classes=Object.fromEntries(LABELS.map(label=>[
  label,rows.filter(r=>classifyStrongArrival(r)===label)
 ]));
 const flag=rows.filter(r=>[
  'V2_LATE','V2_CLEAR_FAST_EXTENDED','V2_CLEAR_SLOW_EXTENDED'
 ].includes(classifyStrongArrival(r)));
 const keep=classes.V2_CLEAR_EARLY_CANDIDATE;
 const excluded=rows.filter(r=>[
  'UNKNOWN_PREHISTORY','UNKNOWN_V2'
 ].includes(classifyStrongArrival(r)));
 const eligibleGroups={KEEP_EARLY:describe(keep),FLAGGED_LATE:describe(flag),
  UNKNOWN:describe(excluded)};
 const stats=Object.fromEntries(LABELS.map(label=>[label,describe(classes[label])]));
 const a=eligibleGroups.KEEP_EARLY.at5m,b=eligibleGroups.FLAGGED_LATE.at5m;
 const symbols=[...new Set(keep.map(r=>r.symbol+':'+r.direction))].filter(k=>
  flag.some(r=>r.symbol+':'+r.direction===k));
 const matched=symbols.filter(k=>{
  const hits=arr=>arr.filter(r=>r.symbol+':'+r.direction===k&&
   r.windows?.[5]?.status==='OBSERVED'&&FINITE(r.windows[5]?.moveBps)).length;
  return hits(keep)>=STRONG_TIMING_PROTOCOL.minPerSidePerSymbolDirection&&
   hits(flag)>=STRONG_TIMING_PROTOCOL.minPerSidePerSymbolDirection;
 });
 const ready=a.observed>=STRONG_TIMING_PROTOCOL.minPerComparisonGroup&&
  b.observed>=STRONG_TIMING_PROTOCOL.minPerComparisonGroup&&
  eligibleGroups.KEEP_EARLY.distinctBerlinDays>=STRONG_TIMING_PROTOCOL.minDistinctDays&&
  eligibleGroups.FLAGGED_LATE.distinctBerlinDays>=STRONG_TIMING_PROTOCOL.minDistinctDays&&
  a.coveragePct>=STRONG_TIMING_PROTOCOL.minimumCoveragePct&&
  b.coveragePct>=STRONG_TIMING_PROTOCOL.minimumCoveragePct&&
  matched.length>=STRONG_TIMING_PROTOCOL.minSharedSymbolDirections;
 return {total:rows.length,allStrong:describe(rows),groups:stats,
  counterfactual:eligibleGroups,comparison:{
   status:ready?'READY_FOR_RESEARCH_REVIEW':'COLLECTING',
   readyForResearchReview:ready,matchedSymbolDirections:matched.length,
   directional5mDifferencePp:a.favorablePct===null||b.favorablePct===null?
    null:round(a.favorablePct-b.favorablePct),
   estimatesTradingProfit:false,
   noSignalFilteringApplied:true
  }};
}
export function strongTimingShadowAudit(rows,now=Date.now()){
 if(!Array.isArray(rows))throw Error('STRONG_TIMING_ROWS_INVALID');
 const chosen=rows.filter(r=>r?.strength==='STRONG'&&
  Number.isSafeInteger(r.sentAt)&&r.sentAt>0&&r.sentAt<=now);
 const cut=Date.parse(STRONG_TIMING_PROTOCOL.prospectiveFrom);
 return {mode:'READ_ONLY_STRONG_TIMING_COUNTERFACTUAL',
  protocol:STRONG_TIMING_PROTOCOL,
  historicalExploration:compare(chosen.filter(r=>r.sentAt<cut)),
  prospectiveValidation:compare(chosen.filter(r=>r.sentAt>=cut)),
  tradeReady:false,
  caveat:'Pre-message classifications are based on V2 label and already-closed WEEX candles only. V2 LATE may predict direction correctly, but still be too late for an entry. Future 5m/15m and adverse-first 30m are descriptive ONLY and do not enter any classification. No live alert blocking or wording changes. The original ntfy forecast price is not an execution fill; fees, spread, slippage, leverage, non-alert control, repeated correlations and independent future-day validation are not covered.'};
}
