// №110: factual "signal came AFTER the move" diagnostic, not a new predictor.
// All inputs are REAL published encrypted-journal forecasts; split by UTC day,
// never use 5/15/30m outcome candles for candidate classification.
// Pre-alert 15/30/60m measurements must have existed before publication.
// No live phone/forecast changes, order, paid API, extra scan, or trade advice.
const MIN=60000,DAY=86400000;
const FINITE=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=10000;
const RATE=(a,b)=>b?Math.round(a*1000/b)/10:null;
const MEAN=(sum,n)=>n?Math.round(sum*100/n)/100:null;
const UTC_DAY=t=>new Date(t).toISOString().slice(0,10);
export const V110_CHASE_POLICY=Object.freeze({
 version:'v110-prealert-15-30-60m-chase-audit-v1',
 lookbacks:Object.freeze([
  Object.freeze({minutes:15,field:'preMove15mBps',thresholdBps:30}),
  Object.freeze({minutes:30,field:'preMove30mBps',thresholdBps:100}),
  Object.freeze({minutes:60,field:'preMove60mBps',thresholdBps:100})
 ]),
 perSymbolSpacingMinutes:30,
 minimumUtcDays:5,minimumTrainDays:3,minimumHoldoutDays:2,
 minimumHoldoutEarly:60,minimumHoldoutExtended:25,
 minimumTrainEarly:60,minimumTrainExtended:25,
 minimumHoldoutDirectionalLiftPp:6,minimumHoldoutMeanBpsLift:3,
 primaryWindowMinutes:15,noLiveChanges:true,noOrders:true,
 noNewWEEXRequests:true,onlyEncryptedJournal:true,
 researchedHypothesesNotIndependent:true
});
function valid(r,now){
 if(!r||!/^[a-f0-9]{32}$/.test(r.id||'')||
  !/^[A-Z0-9]{2,24}$/.test(r.symbol||'')||
  !['LONG','SHORT'].includes(r.direction)||
  !Number.isSafeInteger(r.sentAt)||r.sentAt<=0||
  r.sentAt+35*MIN>=now||
  ![5,15,30].every(h=>r.windows?.[h]?.status==='OBSERVED'&&
   FINITE(r.windows[h].moveBps)))return null;
 return {id:r.id,symbol:r.symbol,side:r.direction,sentAt:r.sentAt,
  m5:r.windows[5].moveBps,m15:r.windows[15].moveBps,
  m30:r.windows[30].moveBps,
  prior:Object.fromEntries(V110_CHASE_POLICY.lookbacks.map(g=>[
   g.minutes,FINITE(r[g.field])?r[g.field]:null])),
  firstFavorable10bpsMinute:Number.isInteger(r.firstFavorable10bpsMinute)&&
   r.firstFavorable10bpsMinute>=1&&r.firstFavorable10bpsMinute<=30?
   r.firstFavorable10bpsMinute:null,
  firstAdverse10bpsMinute:Number.isInteger(r.firstAdverse10bpsMinute)&&
   r.firstAdverse10bpsMinute>=1&&r.firstAdverse10bpsMinute<=30?
   r.firstAdverse10bpsMinute:null};
}
function metrics(rows){
 const n=rows.length;
 const at=h=>{
  const favorable=rows.filter(r=>r['m'+h]>0).length;
  const adverse=rows.filter(r=>r['m'+h]<0).length;
  return {observed:n,favorable,adverse,flat:n-favorable-adverse,
   favorablePctDescriptive:n>=20?RATE(favorable,n):null,
   meanSignedBpsDescriptive:n>=20?
    MEAN(rows.reduce((s,r)=>s+r['m'+h],0),n):null};
 };
 let favorableFirst=0,adverseFirst=0,unknownOrTie=0;
 for(const r of rows){
  const f=r.firstFavorable10bpsMinute,a=r.firstAdverse10bpsMinute;
  if(f!==null&&(a===null||f<a))favorableFirst++;
  else if(a!==null&&(f===null||a<f))adverseFirst++;
  else unknownOrTie++;
 }
 return {n,at5m:at(5),at15m:at(15),at30m:at(30),
  first10bpsOrder:{favorableFirst,adverseFirst,unknownOrTie,
   directionFirstPctDescriptive:favorableFirst+adverseFirst>=20?
    RATE(favorableFirst,favorableFirst+adverseFirst):null,
   note:'Null first crossing can mean no crossing or missing archival onset; not fills.'}};
}
function groupLookback(rows,g){
 const known=rows.filter(r=>r.prior[g.minutes]!==null);
 const missing=rows.filter(r=>r.prior[g.minutes]===null);
 const clean=known.filter(r=>r.prior[g.minutes]<g.thresholdBps);
 const extended=known.filter(r=>r.prior[g.minutes]>=g.thresholdBps);
 return {lookbackMinutes:g.minutes,thresholdBps:g.thresholdBps,
  clean:metrics(clean),extended:metrics(extended),
  unknown:metrics(missing),known:known.length,
  knownCoveragePct:RATE(known.length,rows.length),
  absoluteExtreme1pct:known.filter(r=>r.prior[g.minutes]>=100).length,
  absoluteExtreme2pct:known.filter(r=>r.prior[g.minutes]>=200).length};
}
function panel(rows){
 return {n:rows.length,distinctUtcDays:new Set(rows.map(r=>UTC_DAY(r.sentAt))).size,
  baseline:metrics(rows),
  byLookback:Object.fromEntries(V110_CHASE_POLICY.lookbacks.map(g=>[
   g.minutes,groupLookback(rows,g)])),
  byDirection:Object.fromEntries(['LONG','SHORT'].map(d=>{
   const subset=rows.filter(r=>r.side===d);
   return [d,{n:subset.length,baseline:metrics(subset),
    byLookback:Object.fromEntries(V110_CHASE_POLICY.lookbacks.map(g=>[
     g.minutes,groupLookback(subset,g)]))}];
  }))};
}
function daysplit(rows){
 const days=[...new Set(rows.map(r=>UTC_DAY(r.sentAt)))].sort();
 if(days.length<V110_CHASE_POLICY.minimumUtcDays)return null;
 const possible=[];
 for(let i=V110_CHASE_POLICY.minimumTrainDays;i<=days.length-
     V110_CHASE_POLICY.minimumHoldoutDays;i++){
  const n=rows.filter(r=>UTC_DAY(r.sentAt)<days[i]).length;
  possible.push({at:days[i],fraction:n/rows.length,distance:Math.abs(n/rows.length-0.7)});
 }
 possible.sort((a,b)=>a.distance-b.distance||a.at.localeCompare(b.at));
 const border=possible[0].at;
 const train=rows.filter(r=>UTC_DAY(r.sentAt)<border);
 const holdout=rows.filter(r=>UTC_DAY(r.sentAt)>=border);
 return {border,train,holdout};
}
export function evaluateV110MultiHorizonChase(records,now=Date.now()){
 const base={mode:'V110_15_30_60M_PREALERT_CHASE_AUDIT',
  policy:V110_CHASE_POLICY,source:'ACTUALLY_PUBLISHED_ENCRYPTED_FORECASTS',
  noLiveChanges:true,ordersSent:0,recommendation:'KEEP_108',
  accuracyImproved:false,notTradingProfit:true,
  warning:'Descriptive chronological research, not an independent forward experiment, profitable trade, or automatic filter approval. Multiple coin alerts and market regimes remain correlated.'};
 if(!Array.isArray(records)||records.length>5000||!Number.isSafeInteger(now)||now<=0)
  return {...base,status:'INVALID_INPUT'};
 const unique=new Map();
 for(const r of records){
  const x=valid(r,now);
  if(x&&!unique.has(x.id))unique.set(x.id,x);
 }
 const ordered=[...unique.values()].sort((a,b)=>a.sentAt-b.sentAt||a.id.localeCompare(b.id));
 const last=new Map(),spaced=[];
 for(const r of ordered){
  if(r.sentAt-(last.get(r.symbol)??-Infinity)<
   V110_CHASE_POLICY.perSymbolSpacingMinutes*MIN)continue;
  spaced.push(r);last.set(r.symbol,r.sentAt);
 }
 const distinctUtcDays=new Set(spaced.map(r=>UTC_DAY(r.sentAt))).size;
 const common={...base,eligible:spaced.length,uniquePublished:unique.size,
  excludedCloseRepeat:unique.size-spaced.length,distinctUtcDays,
  fullSample:panel(spaced)};
 const split=daysplit(spaced);
 if(!split)return {...common,status:'INSUFFICIENT_DISTINCT_UTC_DAYS'};
 const train=panel(split.train),holdout=panel(split.holdout);
 const train15=train.byLookback[15],test15=holdout.byLookback[15];
 const sufficient=train15.clean.n>=V110_CHASE_POLICY.minimumTrainEarly&&
  train15.extended.n>=V110_CHASE_POLICY.minimumTrainExtended&&
  test15.clean.n>=V110_CHASE_POLICY.minimumHoldoutEarly&&
  test15.extended.n>=V110_CHASE_POLICY.minimumHoldoutExtended;
 const a=test15.clean.at15m,b=test15.extended.at15m;
 const lift=a.favorablePctDescriptive!==null&&b.favorablePctDescriptive!==null?
  Math.round((a.favorablePctDescriptive-b.favorablePctDescriptive)*10)/10:null;
 const meanLift=a.meanSignedBpsDescriptive!==null&&b.meanSignedBpsDescriptive!==null?
  Math.round((a.meanSignedBpsDescriptive-b.meanSignedBpsDescriptive)*100)/100:null;
 const screeningPass=sufficient&&lift>=V110_CHASE_POLICY.minimumHoldoutDirectionalLiftPp&&
  meanLift>=V110_CHASE_POLICY.minimumHoldoutMeanBpsLift;
 return {...common,status:sufficient?'HISTORICAL_COMPARISON_AVAILABLE':'INSUFFICIENT_MATCHED_GROUPS',
  splitUtcDay:split.border,train,holdout,
  holdoutCleanMinusExtended15mPp:lift,
  holdoutCleanMinusExtendedMeanBps:meanLift,
  screeningPassHistorical:screeningPass,
  readyForOwnerReview:screeningPass,
  requiresUnseenProspectiveControl:true,
  acceptedForLive:false};
}
