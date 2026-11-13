// V110 experimental auto-calibration, SHADOW ONLY.
// Learns a conservative pre-notice forecast filter from the existing ENCRYPTED
// journal's *published* forecast outcomes. No inference at live-signal time.
// It never changes trading, ntfy, configuration, branches or production rules.
export const V110_LEARNING_POLICY=Object.freeze({
 version:'v110-shadow-learning-v1',
 outcomeMinutes:15,stabilityMinutes:30,
 embargoMinutes:30,perSymbolSpacingMinutes:30,
 trainFraction:0.7,minEligible:180,minTrain:120,minHoldout:50,
 minTrainDays:5,minHoldoutDays:2,
 minTrainSelected:60,minHoldoutSelected:25,minCoverage:0.4,
 minTrainHitLiftPct:3,minHoldoutHitLiftPct:5,
 minHoldoutMeanLiftBps:2,
 requiresOwnerApproval:true,changesLiveSignals:false,
 modifiesSource:false,placesOrders:false,extraMarketRequests:0
});
const DAY=86400000,MIN=60000;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const rounded=(n,d=2)=>Number(n.toFixed(d));
const pct=(n,d)=>d?rounded(n/d*100,1):null;
const POLICY_GATES=Object.freeze({
 AVOID_CAUTION:r=>r.strength!=='CAUTION',
 AVOID_LATE:r=>r.v2Timing==='CLEAR',
 AVOID_CHASE:r=>finite(r.preMove5mBps)&&r.preMove5mBps<10,
 AVOID_CAUTION_AND_CHASE:r=>r.strength!=='CAUTION'&&
  finite(r.preMove5mBps)&&r.preMove5mBps<10
});
function eligibleRows(input,now){
 const unique=new Map();
 for(const row of input){
  if(!row||typeof row.id!=='string'||!(/^[a-f0-9]{32}$/).test(row.id)||
   !/^[A-Z0-9]{2,24}$/.test(row.symbol||'')||
   !['LONG','SHORT'].includes(row.direction)||
   !['STRONG','STANDARD','CAUTION'].includes(row.strength)||
   !Number.isSafeInteger(row.sentAt)||row.sentAt<=0||
   row.sentAt+35*MIN>=now||row.sentAt>now||
   ![15,30].every(h=>row.windows?.[h]?.status==='OBSERVED'&&
    finite(row.windows[h].moveBps)&&Math.abs(row.windows[h].moveBps)<10000))continue;
  // No post-publication feature may enter policy evaluation. Only forecast
  // metadata and pre-ntfy movement are used by POLICY_GATES.
  const safe={id:row.id,symbol:row.symbol,direction:row.direction,
   sentAt:row.sentAt,strength:row.strength,v2Timing:row.v2Timing,
   preMove5mBps:finite(row.preMove5mBps)?row.preMove5mBps:null,
   m15:row.windows[15].moveBps,m30:row.windows[30].moveBps};
  const old=unique.get(row.id);
  if(!old||safe.sentAt<old.sentAt)unique.set(row.id,safe);
 }
 // All 32 symbols may correlate; this is a *screening* report, NOT proof
 // of statistical independence or profitable executable entries.
 const spaced=[],lastBySymbol=new Map();
 for(const row of [...unique.values()].sort((a,b)=>a.sentAt-b.sentAt||a.id.localeCompare(b.id))){
  const prior=lastBySymbol.get(row.symbol);
  if(prior!==undefined&&row.sentAt-prior<V110_LEARNING_POLICY.perSymbolSpacingMinutes*MIN)continue;
  spaced.push(row);lastBySymbol.set(row.symbol,row.sentAt);
 }
 return spaced;
}
function metrics(rows){
 if(!rows.length)return {n:0,favorablePct:null,meanBps:null,at30mFavorablePct:null};
 return {n:rows.length,favorablePct:pct(rows.filter(r=>r.m15>0).length,rows.length),
  meanBps:rounded(rows.reduce((v,r)=>v+r.m15,0)/rows.length),
  at30mFavorablePct:pct(rows.filter(r=>r.m30>0).length,rows.length)};
}
const days=rows=>new Set(rows.map(r=>Math.floor(r.sentAt/DAY))).size;
const select=(rows,name)=>rows.filter(POLICY_GATES[name]);
function scoreCandidate(train,name){
 const base=metrics(train),kept=metrics(select(train,name));
 const coverage=kept.n/train.length;
 return {policy:name,coveragePct:pct(kept.n,train.length),train:kept,
  passes:coverage>=V110_LEARNING_POLICY.minCoverage&&
   kept.n>=V110_LEARNING_POLICY.minTrainSelected&&
   kept.favorablePct>=base.favorablePct+V110_LEARNING_POLICY.minTrainHitLiftPct&&
   kept.meanBps>=base.meanBps};
}
export function evaluateV110Learning(forecastRows,now=Date.now()){
 const common={mode:'V110_ENCRYPTED_JOURNAL_SHADOW_LEARNING',
  policyVersion:V110_LEARNING_POLICY.version,
  requiresOwnerApproval:true,liveChanges:0,ordersSent:0,
  independentModelsNotCompared:true,notTradingProfit:true};
 if(!Array.isArray(forecastRows)||forecastRows.length>5000||!Number.isSafeInteger(now))
  return {...common,status:'INVALID_INPUT',recommendation:'KEEP_108',eligible:0};
 const rows=eligibleRows(forecastRows,now);
 const base={...common,eligible:rows.length,
  dataSource:'ACTUALLY_PUBLISHED_FORECASTS_IN_ENCRYPTED_JOURNAL',
  note:'Overlapping markets and regime shifts may invalidate historical lift.'};
 if(rows.length<V110_LEARNING_POLICY.minEligible)
  return {...base,status:'INSUFFICIENT_DATA',required:V110_LEARNING_POLICY.minEligible,
   recommendation:'KEEP_108'};
 const split=Math.floor(rows.length*V110_LEARNING_POLICY.trainFraction);
 const train=rows.slice(0,split);
 const holdout=rows.slice(split).filter(r=>
  r.sentAt>=train.at(-1).sentAt+V110_LEARNING_POLICY.embargoMinutes*MIN);
 if(train.length<V110_LEARNING_POLICY.minTrain||
  holdout.length<V110_LEARNING_POLICY.minHoldout||
  days(train)<V110_LEARNING_POLICY.minTrainDays||
  days(holdout)<V110_LEARNING_POLICY.minHoldoutDays)
  return {...base,status:'INSUFFICIENT_INDEPENDENT_WINDOWS',
   trainN:train.length,holdoutN:holdout.length,
   trainDays:days(train),holdoutDays:days(holdout),
   recommendation:'KEEP_108'};
 const options=Object.keys(POLICY_GATES).map(name=>scoreCandidate(train,name))
  .filter(x=>x.passes)
  .sort((a,b)=>b.train.favorablePct-a.train.favorablePct||
   b.train.meanBps-a.train.meanBps||a.policy.localeCompare(b.policy));
 const baseline=metrics(holdout);
 if(!options.length)return {...base,status:'NO_TRAINING_IMPROVEMENT',
  trainN:train.length,holdoutN:holdout.length,
  holdoutBaseline:baseline,recommendation:'KEEP_108'};
 // Pick EXACTLY ONE policy from training; the holdout is NEVER used to
 // select or iterate over policy candidates.
 const winner=options[0],test=metrics(select(holdout,winner.policy));
 const holdoutCoverage=test.n/holdout.length;
 const validated=test.n>=V110_LEARNING_POLICY.minHoldoutSelected&&
  holdoutCoverage>=V110_LEARNING_POLICY.minCoverage&&
  test.favorablePct>=baseline.favorablePct+V110_LEARNING_POLICY.minHoldoutHitLiftPct&&
  test.meanBps>=baseline.meanBps+V110_LEARNING_POLICY.minHoldoutMeanLiftBps&&
  test.at30mFavorablePct>=baseline.at30mFavorablePct;
 return {...base,status:validated?'SHADOW_CANDIDATE_PASSED':'HOLDOUT_REJECTED',
  trainN:train.length,holdoutN:holdout.length,
  chosenOnTrainingOnly:winner.policy,
  trainingCoveragePct:winner.coveragePct,trainingCandidate:winner.train,
  holdoutBaseline:baseline,holdoutCandidate:test,
  holdoutCoveragePct:pct(test.n,holdout.length),
  recommendation:validated?'OWNER_REVIEW_REQUIRED':'KEEP_108'};
}
