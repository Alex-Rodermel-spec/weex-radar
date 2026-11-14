// V110 shadow-only: 1m forecast followed by TWO FULLY SUBSEQUENT closed 5m periods.
// Source: real, already-published forecast records in the existing AES-GCM journal.
// This never sends a forecast or trade. It cannot measure unsent 1m/5m conflicts.
export const V110_TWO_5M_POLICY=Object.freeze({
 version:'v110-two-full-5m-closed-continuation-v1',
 firstBoundaryIsPartiallyFormed:true,
 fullySubsequent5mWindows:[{from:1,to:2},{from:2,to:3}],
 minRecordsForDescriptiveReport:100,
 minDistinctUtcDays:5,
 perSymbolSpacingMinutes:30,
 noNewRequests:true,noPaidApi:true,noTrading:true,noLiveChanges:true,
 changesForecasts:false,requiresProspectiveValidation:true
});
const MIN=60_000,FIVE=5*MIN,DAY=24*60*MIN;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const round=(x,n=2)=>Number(x.toFixed(n));
const percentage=(a,b)=>b?round(a/b*100,1):null;
const signed=(v)=>v>0?'FAVORABLE':v<0?'ADVERSE':'FLAT';
const duration=r=>{
 // Same published-forecast evaluator convention: do not count the live
 // one-minute candle overlapping publication as a closed future candle.
 const start=Math.ceil((r.sentAt+1)/MIN)*MIN;
 const firstBoundary=Math.ceil((start+MIN)/FIVE)*FIVE;
 const confirmationAt=firstBoundary+2*FIVE;
 return {confirmationAt,minutesAfterNotice:round((confirmationAt-r.sentAt)/MIN,2),
  fullFirstCloseAt:firstBoundary+FIVE,fullSecondCloseAt:confirmationAt};
};
function classify(r,now){
 if(!r||typeof r.id!=='string'||!/^[a-f0-9]{32}$/.test(r.id)||
  !/^[A-Z0-9]{2,24}$/.test(r.symbol||'')||
  !['LONG','SHORT'].includes(r.direction)||
  !Number.isSafeInteger(r.sentAt)||r.sentAt<=0||r.sentAt>now||
  !['STRONG','STANDARD','CAUTION'].includes(r.strength))return null;
 const timing=duration(r);
 if(timing.confirmationAt>now-1000)return null;
 const closes=[1,2,3].map(i=>r.aligned5m?.[i]);
 if(closes.some(x=>x?.status!=='OBSERVED'||!finite(x.moveBps)||
  Math.abs(x.moveBps)>10000))return null;
 const [a,b,c]=closes.map(x=>x.moveBps);
 // The FIRST post-notice 5m CLOSE is not necessarily a fully post-notice
 // candle: its 5m period can begin BEFORE the alert. So evaluate candle 1
 // only as the reference boundary, then candle 2 minus candle 1 and candle
 // 3 minus candle 2 as FULL subsequent consecutive 5m close-to-close moves.
 const one=round(b-a),two=round(c-b);
 const prior=finite(r.preMove5mBps)?r.preMove5mBps:null;
 const oneSign=signed(one),twoSign=signed(two);
 const bothFavorable=oneSign==='FAVORABLE'&&twoSign==='FAVORABLE';
 const confirmed=bothFavorable&&c>0;
 const index=finite(r.firstFavorable10bpsMinute)?r.firstFavorable10bpsMinute:null;
 const start=Math.ceil((r.sentAt+1)/MIN)*MIN;
 const favorableFirstAt=index!==null&&index>=1&&index<=30?
  start+index*MIN:null;
 return {id:r.id,symbol:r.symbol,direction:r.direction,strength:r.strength,
  sentAt:r.sentAt,firstFull5mBps:one,secondFull5mBps:two,
  noticeToFirstBoundaryBps:a,noticeToSecondFullCloseBps:c,
  firstSign:oneSign,secondSign:twoSign,bothFavorable,confirmed,
  preExtended:prior===null?'UNKNOWN':prior>=10?'YES':'NO',
  confirmationMinutes:timing.minutesAfterNotice,
  favorable10bpsBeforeConfirmation:favorableFirstAt!==null?
   favorableFirstAt<timing.confirmationAt:null};
}
function summarize(rows){
 const n=rows.length;
 const first=rows.filter(r=>r.firstSign==='FAVORABLE').length;
 const second=rows.filter(r=>r.secondSign==='FAVORABLE').length;
 const both=rows.filter(r=>r.bothFavorable).length;
 const confirmed=rows.filter(r=>r.confirmed).length;
 const adverse=rows.filter(r=>r.firstSign==='ADVERSE'&&r.secondSign==='ADVERSE').length;
 const mixed=n-both-adverse;
 const early=rows.filter(r=>r.preExtended==='NO');
 const chased=rows.filter(r=>r.preExtended==='YES');
 const unknown=rows.filter(r=>r.preExtended==='UNKNOWN');
 const favorableBefore=rows.filter(r=>r.confirmed&&r.favorable10bpsBeforeConfirmation===true).length;
 const favorableAfter=rows.filter(r=>r.confirmed&&r.favorable10bpsBeforeConfirmation===false).length;
 const timings=rows.map(r=>r.confirmationMinutes).sort((a,b)=>a-b);
 const median=timings.length?timings.length%2?timings[(timings.length-1)/2]:
  (timings[timings.length/2-1]+timings[timings.length/2])/2:null;
 return {n,
  firstFull5mFavorable:first,firstFull5mFavorablePct:percentage(first,n),
  secondFull5mFavorable:second,secondFull5mFavorablePct:percentage(second,n),
  bothFull5mFavorable:both,bothFull5mFavorablePct:percentage(both,n),
  bothFull5mAdverse:adverse,mixedOrFlat:mixed,
  bothAndNetPositiveFromNotice:confirmed,
  bothAndNetPositivePct:percentage(confirmed,n),
  twoFavorableButStillUnderwater:both-confirmed,
  prior5m:{notExtended:early.length,alreadyExtended:chased.length,
   unknown:unknown.length,
   notExtendedBothConfirmed:early.filter(r=>r.confirmed).length,
   extendedBothConfirmed:chased.filter(r=>r.confirmed).length},
  amongTwoCandleConfirmed:{
   firstFavorable10bpsBeforeConfirmation:favorableBefore,
   firstFavorable10bpsAtOrAfterConfirmation:favorableAfter,
   onsetUnavailable:confirmed-favorableBefore-favorableAfter
  },
  medianMinutesToSecondFullClose:median===null?null:round(median,2)};
}
export function evaluateV110TwoFiveMinuteContinuation(input,now=Date.now()){
 const base={mode:'V110_TWO_FULLY_CLOSED_5M_SHADOW',
  policy:V110_TWO_5M_POLICY,
  source:'ACTUALLY_PUBLISHED_FORECASTS_FROM_ENCRYPTED_JOURNAL',
  status:'INSUFFICIENT_DATA',recommendation:'KEEP_108',
  noLiveChanges:true,ordersSent:0,paidApiCalls:0,
  nextStep:'PROSPECTIVE_INDEPENDENT_REVIEW_ONLY',
  caveats:[
   'The initial 5m closing boundary may belong to a candle already in progress when the notice was sent. It is NOT counted as a fully subsequent 5m candle.',
   'The two subsequent 5m periods are measured by sequential CLOSE-to-CLOSE signed changes, not inferred candle body colors, entry fills, or profit.',
   'Archive contains SENT forecasts only; 1m versus 5m disagreements filtered before notification are unobservable here.',
   'Two full 5m confirmation periods take roughly 10–15 minutes after notice and may make an entry late. Success fractions are descriptive only.'
  ]};
 if(!Array.isArray(input)||input.length>5000||!Number.isSafeInteger(now))
  return {...base,status:'INVALID_INPUT',archived:0,matured:0};
 // Dedupe first and preserve chronological spacing per symbol, so a spammy
 // market cannot dominate results. No failed/missing candles count as wins.
 const unique=new Map(),tooEarly=now-45*MIN;
 for(const r of input){
  if(!r||typeof r.id!=='string'||!/^[a-f0-9]{32}$/.test(r.id)||
   !Number.isSafeInteger(r.sentAt)||r.sentAt>tooEarly)continue;
  if(!unique.has(r.id)||r.sentAt<unique.get(r.id).sentAt)
   unique.set(r.id,r);
 }
 const spaced=[],last=new Map();
 for(const r of [...unique.values()].sort((a,b)=>a.sentAt-b.sentAt||a.id.localeCompare(b.id))){
  const old=last.get(r.symbol);
  if(old!==undefined&&r.sentAt-old<30*MIN)continue;
  last.set(r.symbol,r.sentAt);spaced.push(r);
 }
 const qualified=spaced.map(r=>classify(r,now)).filter(Boolean);
 const d=new Set(qualified.map(r=>Math.floor(r.sentAt/DAY))).size;
 const complete=summarize(qualified);
 return {...base,status:qualified.length>=V110_TWO_5M_POLICY.minRecordsForDescriptiveReport&&
  d>=V110_TWO_5M_POLICY.minDistinctUtcDays?'DESCRIPTIVE_SAMPLE_AVAILABLE':
  'COLLECTING_CLOSED_5M_WINDOWS',
  archived:input.length,distinctUtcDays:d,matured:qualified.length,
  missingOrUnresolved:spaced.length-qualified.length,
  complete,
  byDirection:Object.fromEntries(['LONG','SHORT'].map(side=>[
   side,summarize(qualified.filter(r=>r.direction===side))])),
  byStrength:Object.fromEntries(['STANDARD','STRONG','CAUTION'].map(level=>[
   level,summarize(qualified.filter(r=>r.strength===level))])),
  readyForLivePromotion:false,
  // We deliberately DO NOT produce another trading gate: a blinded forward
  // protocol and unsent candidate capture are necessary before any change.
  independentModelCompared:false};
}
