// V110: independent 5-minute directional FORECAST learning, NOT a trade system.
// Uses ONLY encrypted journal rows of *published* forecasts. Candidate rules
// are fixed and use features that existed when the ntfy forecast was sent.
// The 5m outcome is a label, NEVER an input feature. No live routing changes.
const MIN=60000,DAY=86400000;
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<10000;
const pct=(a,b)=>b?Math.round(1000*a/b)/10:null;
const round=n=>Math.round(n*100)/100;
const days=rows=>new Set(rows.map(r=>new Date(r.sentAt).toISOString().slice(0,10))).size;
export const V110_FIVE_MINUTE_POLICY=Object.freeze({
 version:'v110-5m-side-specific-v1',
 trainDaysMin:3,holdoutDaysMin:2,embargoMinutes:30,
 minTrainPerSide:90,minHoldoutPerSide:40,
 minimumSelectedTrain:40,minimumSelectedHoldout:20,
 minimumCoverage:0.35,
 minTrainLiftPp:4,minHoldoutLiftPp:5,
 minTrainMeanLiftBps:2,minHoldoutMeanLiftBps:2,
 independentForwardRequired:true,liveChanges:0,ordersSent:0,
 automaticPromotion:false,noExtraMarketRequests:true
});
const FILTERS=Object.freeze([
 {id:'NO_CAUTION',keep:r=>r.strength!=='CAUTION'},
 {id:'CLEAR_V2',keep:r=>r.v2Timing==='CLEAR'},
 {id:'NOT_CHASED_5M',keep:r=>finite(r.preMove5mBps)&&r.preMove5mBps<10},
 {id:'NOT_CHASED_15M',keep:r=>finite(r.preMove15mBps)&&r.preMove15mBps<30},
 {id:'NO_FAST_CHASE',keep:r=>finite(r.preMove1mBps)&&finite(r.preMove3mBps)&&
  r.preMove1mBps<10&&r.preMove3mBps<10},
 {id:'CLEAR_WITHOUT_CAUTION',keep:r=>r.v2Timing==='CLEAR'&&
  r.strength!=='CAUTION'}
]);
const active=(r,now)=>r&&typeof r.id==='string'&&/^[a-f0-9]{32}$/.test(r.id)&&
 /^[A-Z0-9]{2,24}$/.test(r.symbol||'')&&
 ['LONG','SHORT'].includes(r.direction)&&
 ['STRONG','STANDARD','CAUTION'].includes(r.strength)&&
 Number.isSafeInteger(r.sentAt)&&r.sentAt>0&&r.sentAt<=now-35*MIN&&
 r.sentAt>=now-90*DAY&&
 r.windows?.[5]?.status==='OBSERVED'&&
 r.windows?.[15]?.status==='OBSERVED'&&
 finite(r.windows[5].moveBps)&&finite(r.windows[15].moveBps);
function clean(rows,now){
 if(!Array.isArray(rows)||rows.length>5000)return null;
 const unique=new Map();
 for(const r of rows)if(active(r,now)&&!unique.has(r.id))unique.set(r.id,r);
 const sorted=[...unique.values()].sort((a,b)=>a.sentAt-b.sentAt||a.id.localeCompare(b.id));
 const last=new Map(),kept=[];
 for(const r of sorted){
  // One same-symbol forecast per 30min, irrespective of side or severity.
  const prev=last.get(r.symbol);
  if(prev!==undefined&&r.sentAt-prev<30*MIN)continue;
  last.set(r.symbol,r.sentAt);kept.push(r);
 }
 return kept;
}
function stats(rows){
 const good=rows.filter(r=>r.windows[5].moveBps>0).length;
 const adverse=rows.filter(r=>r.windows[5].moveBps<0).length;
 const favorable15=rows.filter(r=>r.windows[15].moveBps>0).length;
 const mean=rows.length?
  round(rows.reduce((s,r)=>s+r.windows[5].moveBps,0)/rows.length):null;
 return {n:rows.length,days:days(rows),favorable:good,adverse,
  flat:rows.length-good-adverse,
  favorablePct:pct(good,rows.length),
  favorable15mPct:pct(favorable15,rows.length),mean5mBps:mean};
}
function sideEval(rows,side,cut){
 const p=V110_FIVE_MINUTE_POLICY,subset=rows.filter(r=>r.direction===side);
 const train=subset.filter(r=>r.sentAt<cut-p.embargoMinutes*MIN);
 const holdout=subset.filter(r=>r.sentAt>=cut+p.embargoMinutes*MIN);
 const base=stats(train),held=stats(holdout);
 const common={direction:side,train:base,holdout:held,
  recommendation:'KEEP_108',liveChanges:0};
 if(train.length<p.minTrainPerSide||holdout.length<p.minHoldoutPerSide||
  base.days<p.trainDaysMin||held.days<p.holdoutDaysMin)
  return {...common,status:'COLLECTING_SIDE_SPECIFIC_SAMPLES'};
 // Select ONE idea based solely on past training. The holdout remains
 // untouched by threshold selection and rules are frozen in source.
 const selected=FILTERS.map(f=>{
  const subsetTrain=train.filter(f.keep),m=stats(subsetTrain),coverage=m.n/train.length;
  return {filterId:f.id,trainCandidate:m,trainCoveragePct:pct(m.n,train.length),
   qualifies:m.n>=p.minimumSelectedTrain&&coverage>=p.minimumCoverage&&
    m.favorablePct>=base.favorablePct+p.minTrainLiftPp&&
    m.mean5mBps>=base.mean5mBps+p.minTrainMeanLiftBps};
 }).filter(x=>x.qualifies).sort((a,b)=>
  b.trainCandidate.favorablePct-a.trainCandidate.favorablePct||
  b.trainCandidate.mean5mBps-a.trainCandidate.mean5mBps||
  a.filterId.localeCompare(b.filterId))[0];
 if(!selected)return {...common,status:'NO_TRAINING_IMPROVEMENT'};
 const f=FILTERS.find(x=>x.id===selected.filterId),
  candidate=stats(holdout.filter(f.keep));
 const passes=candidate.n>=p.minimumSelectedHoldout&&
  candidate.n/held.n>=p.minimumCoverage&&
  candidate.favorablePct>=held.favorablePct+p.minHoldoutLiftPp&&
  candidate.mean5mBps>=held.mean5mBps+p.minHoldoutMeanLiftBps&&
  candidate.favorable15mPct>=held.favorable15mPct-3;
 return {...common,status:passes?'HOLDOUT_PROMISING_FORWARD_REQUIRED':'HOLDOUT_REJECTED',
  chosenOnTrainingOnly:selected.filterId,
  trainCandidate:selected.trainCandidate,
  holdoutCandidate:candidate,holdoutCoveragePct:pct(candidate.n,held.n),
  independentForwardValidated:false,
  recommendation:passes?'SEPARATE_FORWARD_SHADOW_REQUIRED':'KEEP_108'};
}
export function evaluateV110FiveMinuteForecast(rows,now=Date.now()){
 const p=V110_FIVE_MINUTE_POLICY;
 const base={mode:'V110_FORECAST_5M_SIDE_SPECIFIC_LEARNING',
  policyVersion:p.version,primaryHorizonMinutes:5,
  noTrade:true,ordersSent:0,liveChanges:0,automaticPromotion:false,
  recommendation:'KEEP_108',forwardValidated:false,
  note:'Published ntfy forecast candle directions, NOT executions, profit, independent labels across assets or calibrated probabilities. A retrospective holdout is only a screen. Preserve original 1/5/10m published forecast and live filters until new prospective evidence.'};
 if(!Number.isSafeInteger(now)||now<=0)return {...base,status:'BAD_NOW'};
 const eligible=clean(rows,now);
 if(!eligible)return {...base,status:'INVALID_ROWS'};
 const dateKeys=[...new Set(eligible.map(r=>new Date(r.sentAt).toISOString().slice(0,10)))].sort();
 const summary={eligible:eligible.length,distinctUtcDays:dateKeys.length,
  nonOverlappingWithinSymbolMinutes:30,
  baseline:stats(eligible)};
 if(dateKeys.length<p.trainDaysMin+p.holdoutDaysMin)
  return {...base,...summary,status:'COLLECTING_DAYS'};
 const index=Math.max(p.trainDaysMin,
  Math.min(dateKeys.length-p.holdoutDaysMin,Math.floor(dateKeys.length*.7)));
 const cut=Date.parse(dateKeys[index]+'T00:00:00.000Z');
 const both={LONG:sideEval(eligible,'LONG',cut),
  SHORT:sideEval(eligible,'SHORT',cut)};
 return {...base,...summary,status:Object.values(both).some(x=>
  x.status==='HOLDOUT_PROMISING_FORWARD_REQUIRED')?
  'RESEARCH_PROMISING_NOT_DEPLOYABLE':'KEEP_108',
  cutoffUTC:new Date(cut).toISOString(),
  byDirection:both};
}
