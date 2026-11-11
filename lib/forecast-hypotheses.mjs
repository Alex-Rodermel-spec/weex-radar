// Preregistered, read-only WEEX forecast hypothesis checks.
// Only aggregate outcomes leave the AES-GCM journal. No trade suggestions,
// probabilistic confidence score, execution model or signal filter is changed.
export const FORECAST_STUDY_PROTOCOL=Object.freeze({
 version:'2026-11-11-v1',
 forwardFrom:'2026-11-11T23:00:00.000Z', // 12 Nov 00:00 in Europe/Berlin
 primaryHorizonMinutes:15,
 descriptiveHorizonsMinutes:[5,10,15],
 priorMovementMinutes:15,
 priorMovementThresholdBps:10, // 0.10% before publication
 minimumObservedPerGroup:50,
 minimumCoveragePct:80,
 minimumSharedSymbols:3,
 minimumObservedPerGroupPerSymbol:5,
 descriptiveDifferencePp:10
});
const MINUTE=60000;
const ROUND=x=>Number(x.toFixed(1));
const FINITE=x=>typeof x==='number'&&Number.isFinite(x);

function isMatured(row,horizon,now){
 if(!Number.isSafeInteger(row?.sentAt)||row.sentAt>now||row.sentAt<0)return false;
 const nextMinute=Math.ceil((row.sentAt+1)/MINUTE)*MINUTE;
 return nextMinute+horizon*MINUTE<=now-1000;
}
function outcome(rows,horizon,now){
 const matured=rows.filter(r=>isMatured(r,horizon,now));
 const evaluated=matured.filter(r=>r.windows?.[horizon]?.status==='OBSERVED'&&
  FINITE(r.windows[horizon].moveBps));
 const favorable=evaluated.filter(r=>r.windows[horizon].moveBps>0).length;
 const n=evaluated.length;
 return {total:matured.length,observed:n,missing:matured.length-n,
  favorable,flat:evaluated.filter(r=>r.windows[horizon].moveBps===0).length,
  favorablePct:n?ROUND(100*favorable/n):null,
  coveragePct:matured.length?ROUND(n*100/matured.length):null};
}
function commonSymbolDelta(left,right,horizon,now){
 const symbols=[...new Set(left.map(r=>r.symbol))].filter(s=>right.some(r=>r.symbol===s));
 const perSymbol=symbols.map(s=>{
  const a=outcome(left.filter(r=>r.symbol===s),horizon,now);
  const b=outcome(right.filter(r=>r.symbol===s),horizon,now);
  return {a,b};
 }).filter(x=>x.a.observed>=FORECAST_STUDY_PROTOCOL.minimumObservedPerGroupPerSymbol&&
  x.b.observed>=FORECAST_STUDY_PROTOCOL.minimumObservedPerGroupPerSymbol);
 if(!perSymbol.length)return {sharedSymbols:0,stratifiedDifferencePp:null};
 // Equal weight per coin, so a coin with 50 notices does not drown another
 // coin with 5 in the descriptive comparison.
 return {sharedSymbols:perSymbol.length,
  stratifiedDifferencePp:ROUND(perSymbol.reduce((s,x)=>
   s+x.a.favorablePct-x.b.favorablePct,0)/perSymbol.length)};
}
function compareGroups(left,right,horizon,now){
 const a=outcome(left,horizon,now),b=outcome(right,horizon,now);
 const shared=commonSymbolDelta(left,right,horizon,now);
 const rawDelta=a.favorablePct===null||b.favorablePct===null?null:
  ROUND(a.favorablePct-b.favorablePct);
 const enough=a.observed>=FORECAST_STUDY_PROTOCOL.minimumObservedPerGroup&&
  b.observed>=FORECAST_STUDY_PROTOCOL.minimumObservedPerGroup&&
  a.coveragePct>=FORECAST_STUDY_PROTOCOL.minimumCoveragePct&&
  b.coveragePct>=FORECAST_STUDY_PROTOCOL.minimumCoveragePct&&
  shared.sharedSymbols>=FORECAST_STUDY_PROTOCOL.minimumSharedSymbols;
 return {left:a,right:b,differencePp:rawDelta,
  ...shared,readyForReview:enough,
  passesDescriptiveThreshold:enough&&rawDelta!==null&&
   Math.abs(rawDelta)>=FORECAST_STUDY_PROTOCOL.descriptiveDifferencePp,
  status:enough?'REVIEW_ONLY':'COLLECTING'};
}
function timeGroup(rows){
 const total=rows.length;
 const known=rows.filter(r=>FINITE(r.preMove15mBps));
 const late=known.filter(r=>r.preMove15mBps>=FORECAST_STUDY_PROTOCOL.priorMovementThresholdBps).length;
 return {total,observed:known.length,missing:total-known.length,
  late,latePct:known.length?ROUND(100*late/known.length):null,
  coveragePct:total?ROUND(100*known.length/total):null};
}
function timingComparison(rows){
 const standard=timeGroup(rows.filter(r=>r.strength==='STANDARD'));
 const strong=timeGroup(rows.filter(r=>r.strength==='STRONG'));
 const enough=standard.observed>=FORECAST_STUDY_PROTOCOL.minimumObservedPerGroup&&
  strong.observed>=FORECAST_STUDY_PROTOCOL.minimumObservedPerGroup&&
  standard.coveragePct>=FORECAST_STUDY_PROTOCOL.minimumCoveragePct&&
  strong.coveragePct>=FORECAST_STUDY_PROTOCOL.minimumCoveragePct;
 return {left:standard,right:strong,
  // Positive means more STRONG forecasts already moved 0.10% before the notice.
  strongMinusStandardLatePp:strong.latePct===null||standard.latePct===null?
   null:ROUND(strong.latePct-standard.latePct),
  readyForReview:enough,status:enough?'REVIEW_ONLY':'COLLECTING'};
}
function cohort(rows,now){
 const known=rows.filter(r=>FINITE(r.preMove15mBps));
 const early=known.filter(r=>r.preMove15mBps<FORECAST_STUDY_PROTOCOL.priorMovementThresholdBps);
 const late=known.filter(r=>r.preMove15mBps>=FORECAST_STUDY_PROTOCOL.priorMovementThresholdBps);
 return {
  total:rows.length,missingPriorMovement:rows.length-known.length,
  shortVsLong:Object.fromEntries([5,10,15].map(h=>[h,
   compareGroups(rows.filter(r=>r.direction==='SHORT'),
    rows.filter(r=>r.direction==='LONG'),h,now)])),
  strongVsStandard:Object.fromEntries([5,10,15].map(h=>[h,
   compareGroups(rows.filter(r=>r.strength==='STRONG'),
    rows.filter(r=>r.strength==='STANDARD'),h,now)])),
  earlyVsLate:Object.fromEntries([5,10,15].map(h=>[h,
   compareGroups(early,late,h,now)])),
  // Distinguish delayed LONG from delayed SHORT; a pooled early-vs-late
  // percentage can reverse due to the mix of the two market directions.
  timingByDirection:Object.fromEntries(['LONG','SHORT'].map(side=>{
   const earlySide=early.filter(r=>r.direction===side),
    lateSide=late.filter(r=>r.direction===side);
   return [side,{
    earlyTotal:earlySide.length,lateTotal:lateSide.length,
    missingPriorMovement:rows.filter(r=>r.direction===side&&
     !FINITE(r.preMove15mBps)).length,
    ...Object.fromEntries([5,10,15].map(h=>[h,
     compareGroups(earlySide,lateSide,h,now)]))
   }];
  })),
  standardEarlierThanStrong:timingComparison(rows)
 };
}
export function forecastHypothesisAudit(rows,now=Date.now()){
 if(!Array.isArray(rows))throw Error('FORECAST_HYPOTHESIS_ROWS_INVALID');
 const futureFrom=Date.parse(FORECAST_STUDY_PROTOCOL.forwardFrom);
 const eligible=rows.filter(r=>r&&Number.isSafeInteger(r.sentAt)&&r.sentAt<=now);
 return {protocol:FORECAST_STUDY_PROTOCOL,
  exploratory:cohort(eligible.filter(r=>r.sentAt<futureFrom),now),
  forward:cohort(eligible.filter(r=>r.sentAt>=futureFrom),now),
  caveat:'Description only: 50/group, 80% coverage and three shared coins are review gates, not statistical proof. Overlapping alerts, unequal coin/time mix, fees, funding and liquidation risk remain. Forward data is separate from historical exploration.'};
}
