// READ-ONLY research: did a forecast arrive AFTER a short directional move?
// Based exclusively on completed WEEX candles before an actually published ntfy
// forecast, plus its separately observed 5/15-minute outcome.
// This is NOT a trade gate, signal predictor, or proof of movement onset.
import {classifyForecastQualityShadow,QUALITY_GATE_PROTOCOL} from './forecast-quality-gate.mjs';

export const TIMING_PROTOCOL=Object.freeze({
 version:'2026-11-12-fast-arrival-shadow-v1',
 forwardFrom:QUALITY_GATE_PROTOCOL.forwardFrom,
 windowsMinutes:[1,3,5,15],
 fastExtensionThresholdBps:10,
 minObservedPerComparisonGroup:50,
 minCoveragePct:80,
 minMatchedSymbolDirections:3,
 minPerGroupPerSymbolDirection:5,
 alertsUnchanged:true,
 ordersSent:0,
 notATrade:true
});
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const pct=(a,b)=>b?Math.round(a/b*1000)/10:null;
const FIELDS=Object.freeze({1:'preMove1mBps',3:'preMove3mBps',
 5:'preMove5mBps',15:'preMove15mBps'});
const FUTURE=[5,15];

export function fastArrivalStatus(row){
 const a=row?.preMove1mBps,b=row?.preMove3mBps;
 if(finite(a)&&a>=TIMING_PROTOCOL.fastExtensionThresholdBps||
    finite(b)&&b>=TIMING_PROTOCOL.fastExtensionThresholdBps)return 'ALREADY_EXTENDED';
 if(!finite(a)||!finite(b))return 'UNKNOWN';
 return 'NOT_EXTENDED';
}
function scored(rows,h){
 let observed=0,favorable=0,adverse=0,flat=0,pending=0,noData=0;
 for(const r of rows){
  const v=r.windows?.[h];
  if(v?.status==='OBSERVED'&&finite(v.moveBps)){
   observed++;
   if(v.moveBps>0)favorable++;
   else if(v.moveBps<0)adverse++;
   else flat++;
  }else if(v?.status==='PENDING')pending++;
  else noData++;
 }
 return {total:rows.length,observed,favorable,adverse,flat,pending,noData,
  favorablePct:pct(favorable,observed),
  coveragePct:pct(observed,observed+noData)};
}
function prior(rows,key){
 const valid=rows.map(x=>x[key]).filter(finite);
 const extended=valid.filter(x=>x>=TIMING_PROTOCOL.fastExtensionThresholdBps).length;
 return {observed:valid.length,unknown:rows.length-valid.length,
  already10bps:extended,
  already10bpsPct:pct(extended,valid.length)};
}
function snapshot(rows){
 return {total:rows.length,
  prior:Object.fromEntries(Object.entries(FIELDS).map(([h,k])=>[h,prior(rows,k)])),
  fastStatus:Object.fromEntries(['ALREADY_EXTENDED','NOT_EXTENDED','UNKNOWN'].map(status=>
   [status,rows.filter(r=>fastArrivalStatus(r)===status).length])),
  ...Object.fromEntries(FUTURE.map(h=>['at'+h+'m',scored(rows,h)])),
  byDirection:Object.fromEntries(['LONG','SHORT'].map(dir=>
   [dir,{total:rows.filter(r=>r.direction===dir).length,
    ...Object.fromEntries(FUTURE.map(h=>['at'+h+'m',scored(rows.filter(r=>r.direction===dir),h)]))}]))
 };
}
function matchedCoinDirections(left,right){
 const pairs=[...new Set(left.map(r=>r.symbol+':'+r.direction))];
 const eligible=pairs.filter(pair=>{
  const count=(rows)=>rows.filter(r=>r.symbol+':'+r.direction===pair&&
   r.windows?.[5]?.status==='OBSERVED'&&finite(r.windows[5].moveBps)).length;
  return count(left)>=TIMING_PROTOCOL.minPerGroupPerSymbolDirection&&
   count(right)>=TIMING_PROTOCOL.minPerGroupPerSymbolDirection;
 });
 return eligible.length;
}
function cohort(rows){
 const known=rows.filter(r=>fastArrivalStatus(r)!=='UNKNOWN');
 const extended=known.filter(r=>fastArrivalStatus(r)==='ALREADY_EXTENDED');
 const notExtended=known.filter(r=>fastArrivalStatus(r)==='NOT_EXTENDED');
 const v2Clear=rows.filter(r=>r.v2Timing==='CLEAR');
 const v3Pass=rows.filter(r=>classifyForecastQualityShadow(r)==='PASS');
 const cmp=(subset)=>{
  const a=subset.filter(r=>fastArrivalStatus(r)==='ALREADY_EXTENDED'),
   b=subset.filter(r=>fastArrivalStatus(r)==='NOT_EXTENDED'),
   x=scored(a,5),y=scored(b,5),
   shared=matchedCoinDirections(a,b);
  const ready=x.observed>=TIMING_PROTOCOL.minObservedPerComparisonGroup&&
   y.observed>=TIMING_PROTOCOL.minObservedPerComparisonGroup&&
   x.coveragePct>=TIMING_PROTOCOL.minCoveragePct&&
   y.coveragePct>=TIMING_PROTOCOL.minCoveragePct&&
   shared>=TIMING_PROTOCOL.minMatchedSymbolDirections;
  return {total:subset.length,
   alreadyExtended:snapshot(a),notExtended:snapshot(b),
   unknown:snapshot(subset.filter(r=>fastArrivalStatus(r)==='UNKNOWN')),
   differencePp:x.favorablePct===null||y.favorablePct===null?null:
    Math.round((y.favorablePct-x.favorablePct)*10)/10,
   matchedCoinDirections:shared,
   readyForResearchReview:ready,status:ready?'REVIEW_ONLY':'COLLECTING'};
 };
 return {
  total:rows.length,all:snapshot(rows),
  shortPreMove:snapshot(extended),notExtended:snapshot(notExtended),
  unknownFast:snapshot(rows.filter(r=>fastArrivalStatus(r)==='UNKNOWN')),
  v2Clear:cmp(v2Clear),
  v3Pass:cmp(v3Pass),
  v2Late:snapshot(rows.filter(r=>r.v2Timing==='LATE'))
 };
}
export function forecastTimingAudit(rows,now=Date.now()){
 if(!Array.isArray(rows))throw Error('FORECAST_TIMING_ROWS_INVALID');
 const published=rows.filter(r=>r&&Number.isSafeInteger(r.sentAt)&&r.sentAt<=now);
 const cut=Date.parse(TIMING_PROTOCOL.forwardFrom);
 return {mode:'READ_ONLY_FAST_ARRIVAL_AUDIT',
  protocol:TIMING_PROTOCOL,
  historical:cohort(published.filter(r=>r.sentAt<cut)),
  forward:cohort(published.filter(r=>r.sentAt>=cut)),
  caveat:'Pre-alert reference is the rounded 1m close printed in ntfy, not an executable trade quote. Completed 1m candles before publication estimate short pre-move; ntfy second-resolution time and 10-minute scanning cannot identify exact market-move onset or notification-device delay. Extended means 0.10%+ in the proposed direction by the 1/3m window; it is a possible late-chase flag, not proof. Unknown history stays unknown. Outcomes are future closed-candle directions, not fills, profits, calibrated probabilities or a signal filter. Prospective matched coin+direction validation is required before any change.'};
}
