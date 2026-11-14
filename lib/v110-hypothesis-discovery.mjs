// V110 bounded hypothesis discovery, strictly SHADOW-ONLY.
// This is a deterministic research engine, NOT a generative AI: it diagnoses
// weaknesses in ACTUALLY PUBLISHED, encrypted forecast records and chooses
// among pre-registered direction-specific ideas using TRAINING data only.
// No external market calls, trades, live signals, ntfy or source changes.
export const V110_HYPOTHESIS_POLICY=Object.freeze({
 version:'v110-direction-hypotheses-3plus2-v1',
 minEligible:180,minTrain:120,minHoldout:50,minTrainDays:3,minHoldoutDays:2,
 trainFractionPermille:700,embargoMinutes:30,perSymbolSpacingMinutes:30,
 minSideTrain:60,minSideHoldout:25,minTrainSelected:35,minHoldoutSelected:18,
 minCoverage:0.45,minTrainLiftPct:4,minTrainMeanLiftBps:2,
 minHoldoutLiftPct:6,minHoldoutMeanLiftBps:3,
 noNewRequests:true,noTrading:true,noLiveChanges:true,
 manualApprovalRequired:true,forwardTestRequired:true
});
const DAY=86400000,MIN=60000;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const round=(n,d=2)=>Number(n.toFixed(d));
const ratio=(num,den)=>den?round(num/den*100,1):null;
const UTC_DAYS=rows=>new Set(rows.map(r=>Math.floor(r.sentAt/DAY))).size;

// Only publication-time fields. Missing pre-move is UNKNOWN, not safe.
const RULES=Object.freeze([
 {id:'LONG_SKIP_CAUTION',side:'LONG',
  detail:'Проверить прогнозы LONG без предупреждения повышенного риска',
  keep:r=>r.strength!=='CAUTION'},
 {id:'LONG_SKIP_CHASE',side:'LONG',
  detail:'Проверить LONG без уже пройденных до уведомления 0,10%',
  keep:r=>finite(r.preMove5mBps)&&r.preMove5mBps<10},
 {id:'LONG_SKIP_CAUTION_CHASE',side:'LONG',
  detail:'Проверить LONG без повышенного риска и догоняющего движения',
  keep:r=>r.strength!=='CAUTION'&&finite(r.preMove5mBps)&&r.preMove5mBps<10},
 {id:'SHORT_SKIP_CAUTION',side:'SHORT',
  detail:'Проверить SHORT без предупреждения повышенного риска',
  keep:r=>r.strength!=='CAUTION'},
 {id:'SHORT_SKIP_CHASE',side:'SHORT',
  detail:'Проверить SHORT без уже пройденных до уведомления 0,10%',
  keep:r=>finite(r.preMove5mBps)&&r.preMove5mBps<10},
 {id:'SHORT_SKIP_CAUTION_CHASE',side:'SHORT',
  detail:'Проверить SHORT без повышенного риска и догоняющего движения',
  keep:r=>r.strength!=='CAUTION'&&finite(r.preMove5mBps)&&r.preMove5mBps<10}
]);
export const V110_HYPOTHESIS_IDS=Object.freeze(RULES.map(r=>r.id));

function eligibleRows(records,now){
 const byId=new Map();
 for(const x of records){
  if(!x||!(/^[a-f0-9]{32}$/).test(x.id||'')||
   !/^[A-Z0-9]{2,24}$/.test(x.symbol||'')||
   !['LONG','SHORT'].includes(x.direction)||
   !['STRONG','STANDARD','CAUTION'].includes(x.strength)||
   !Number.isSafeInteger(x.sentAt)||x.sentAt<=0||
   x.sentAt+35*MIN>=now||x.sentAt>now||
   ![15,30].every(h=>x.windows?.[h]?.status==='OBSERVED'&&
    finite(x.windows[h].moveBps)&&Math.abs(x.windows[h].moveBps)<10000))continue;
  // Prevent duplicate correlated forecasts from inflating the sample.
  const record={id:x.id,symbol:x.symbol,sentAt:x.sentAt,
   direction:x.direction,strength:x.strength,
   preMove5mBps:finite(x.preMove5mBps)?x.preMove5mBps:null,
   m15:x.windows[15].moveBps,m30:x.windows[30].moveBps};
  if(!byId.has(x.id)||record.sentAt<byId.get(x.id).sentAt)byId.set(x.id,record);
 }
 const spaced=[],lastBySymbol=new Map();
 for(const x of [...byId.values()].sort((a,b)=>a.sentAt-b.sentAt||a.id.localeCompare(b.id))){
  if(x.sentAt-(lastBySymbol.get(x.symbol)??-Infinity)<
   V110_HYPOTHESIS_POLICY.perSymbolSpacingMinutes*MIN)continue;
  spaced.push(x);lastBySymbol.set(x.symbol,x.sentAt);
 }
 return spaced;
}
const metrics=rows=>({n:rows.length,
 favorablePct:ratio(rows.filter(x=>x.m15>0).length,rows.length),
 meanBps:rows.length?round(rows.reduce((s,x)=>s+x.m15,0)/rows.length):null,
 favorable30mPct:ratio(rows.filter(x=>x.m30>0).length,rows.length)});


function fourDayExploratoryStudy(rows,days,now){
 // EARLY DIAGNOSTICS ONLY: no eligibility change, no alerts and no promotion.
 // The fifth calendar day remains mandatory for independent screening.
 const trainDays=new Set(days.slice(0,3)),previewDay=days[3];
 const train=rows.filter(r=>trainDays.has(Math.floor(r.sentAt/DAY)));
 const lastTrainAt=train.at(-1)?.sentAt??0;
 const preview=rows.filter(r=>Math.floor(r.sentAt/DAY)===previewDay&&
   r.sentAt>=lastTrainAt+V110_HYPOTHESIS_POLICY.embargoMinutes*MIN);
 const ideas=RULES.map(rule=>{
  const trainAll=train.filter(r=>r.direction===rule.side);
  const trainKeep=trainAll.filter(rule.keep);
  const previewAll=preview.filter(r=>r.direction===rule.side);
  const previewKeep=previewAll.filter(rule.keep);
  const trainBaseline=metrics(trainAll),trainCandidate=metrics(trainKeep);
  const previewBaseline=metrics(previewAll),previewCandidate=metrics(previewKeep);
  const trainLiftPct=trainAll.length&&trainKeep.length?
   round(trainCandidate.favorablePct-trainBaseline.favorablePct,1):null;
  const trainMeanLiftBps=trainAll.length&&trainKeep.length?
   round(trainCandidate.meanBps-trainBaseline.meanBps):null;
  const trainPasses=trainAll.length>=V110_HYPOTHESIS_POLICY.minSideTrain&&
   trainKeep.length>=V110_HYPOTHESIS_POLICY.minTrainSelected&&
   trainKeep.length/trainAll.length>=V110_HYPOTHESIS_POLICY.minCoverage&&
   trainLiftPct>=V110_HYPOTHESIS_POLICY.minTrainLiftPct&&
   trainMeanLiftBps>=V110_HYPOTHESIS_POLICY.minTrainMeanLiftBps&&
   trainCandidate.meanBps>0;
  return {
   id:rule.id,side:rule.side,hypothesis:rule.detail,
   trainBaseline,trainCandidate,trainLiftPct,trainMeanLiftBps,trainPasses,
   previewBaseline,previewCandidate,
   previewLiftPct:previewAll.length&&previewKeep.length?
    round(previewCandidate.favorablePct-previewBaseline.favorablePct,1):null,
   previewMeanLiftBps:previewAll.length&&previewKeep.length?
    round(previewCandidate.meanBps-previewBaseline.meanBps):null,
   state:'EXPLORATORY_NOT_VALIDATED'
  };
 });
 // Choose on the first three days ONLY, never using the fourth-day results.
 const selected=ideas.filter(x=>x.trainPasses).sort((a,b)=>
  b.trainLiftPct-a.trainLiftPct||b.trainMeanLiftBps-a.trainMeanLiftBps||
  a.id.localeCompare(b.id))[0]??null;
 return {
  status:'EXPLORATORY_3_PLUS_1',trainDays:3,previewDays:1,
  trainN:train.length,previewN:preview.length,
  previewDateUTC:new Date(previewDay*DAY).toISOString().slice(0,10),
  previewDayIncomplete:previewDay===Math.floor(now/DAY),
  selectedOnTrainingOnly:selected?.id??null,
  selectedPreview:selected?{
   baseline:selected.previewBaseline,candidate:selected.previewCandidate,
   favorableLiftPct:selected.previewLiftPct,meanLiftBps:selected.previewMeanLiftBps
  }:null,
  ideas,notValidated:true,doNotPromote:true,doNotNotify:true,
  requiredDistinctDaysForFormalReview:V110_HYPOTHESIS_POLICY.minTrainDays+
   V110_HYPOTHESIS_POLICY.minHoldoutDays,
  note:'Early four-day peek is exploratory and cannot establish an untouched two-day holdout. Do not adapt filters to this preview; further independent forward validation is required.'
 };
}

export function evaluateV110Hypotheses(input,now=Date.now()){
 const common={mode:'V110_DIRECTIONAL_HYPOTHESIS_SHADOW',
  version:V110_HYPOTHESIS_POLICY.version,
  noLiveChanges:true,ordersSent:0,requiresOwnerApproval:true,
  additionalMarketRequests:0,requiresIndependentForwardTest:true,
  dataSource:'ONLY_ACTUALLY_PUBLISHED_ENCRYPTED_FORECASTS',
  note:'Pre-registered deterministic ideas; correlated markets, multiple comparisons, non-executable prices and overlapping rolling holdouts preclude claims of trading profitability.'};
 if(!Array.isArray(input)||input.length>5000||!Number.isSafeInteger(now))
  return {...common,status:'INVALID_INPUT',eligible:0,recommendation:'KEEP_108',ideas:[]};
 const rows=eligibleRows(input,now);
 // Even before the five disjoint research days are available, transparently
 // report what the researcher will test. These are UNTESTED ideas, never
 // holdout results or executable recommendations.
 const provisionalIdeas=RULES.map(r=>({
  id:r.id,side:r.side,hypothesis:r.detail,
  state:'PENDING_CHRONOLOGICAL_VALIDATION'
 }));
 const directionalSnapshot=Object.fromEntries(['LONG','SHORT'].map(side=>[
  side,metrics(rows.filter(r=>r.direction===side))
 ]));
 const short=directionalSnapshot.SHORT,long=directionalSnapshot.LONG;
 const observedGapPct=short.n>=30&&long.n>=30?
  round(short.favorablePct-long.favorablePct,1):null;
 const base={...common,eligible:rows.length,recommendation:'KEEP_108',
  ideas:provisionalIdeas,
  descriptiveDirectionSnapshot:directionalSnapshot,
  observedShortMinusLongPct:observedGapPct,
  preliminaryDiagnosticsOnly:true};
 if(rows.length<V110_HYPOTHESIS_POLICY.minEligible)
  return {...base,status:'INSUFFICIENT_DATA',
   required:V110_HYPOTHESIS_POLICY.minEligible};
 // Whole-day chronological partition: training and holdout MUST NOT
 // share a UTC calendar day. Reserve at least two untouched later days.
 // Pick the day boundary nearest 70% of pre-filtered eligible observations.
 const counts=new Map();
 for(const r of rows){
  const day=Math.floor(r.sentAt/DAY);
  counts.set(day,(counts.get(day)||0)+1);
 }
 const keys=[...counts.keys()].sort((a,b)=>a-b);
 if(keys.length<5)return {...base,status:'INSUFFICIENT_DISTINCT_UTC_DAYS',
  distinctDays:keys.length,requiredDays:5,
  fourDayExploratory:keys.length===4?fourDayExploratoryStudy(rows,keys,now):null};
 const boundaries=[];
 let cumulative=0;
 for(let i=0;i<keys.length-2;i++){
  cumulative+=counts.get(keys[i]);
  if(i>=2)boundaries.push({
   borderDay:keys[i+1],trainN:cumulative,
   difference:Math.abs(1000*cumulative/rows.length-
    V110_HYPOTHESIS_POLICY.trainFractionPermille)
  });
 }
 boundaries.sort((a,b)=>a.difference-b.difference||
  a.borderDay-b.borderDay);
 const boundary=boundaries[0].borderDay*DAY;
 const train=rows.filter(x=>x.sentAt<boundary);
 const lastTrainAt=train.at(-1)?.sentAt??0;
 const held=rows.filter(x=>
  x.sentAt>=boundary&&
  x.sentAt>=lastTrainAt+V110_HYPOTHESIS_POLICY.embargoMinutes*MIN);
 const partition={...base,trainN:train.length,holdoutN:held.length,
  trainDays:UTC_DAYS(train),holdoutDays:UTC_DAYS(held)};
 if(train.length<V110_HYPOTHESIS_POLICY.minTrain||
  held.length<V110_HYPOTHESIS_POLICY.minHoldout||
  UTC_DAYS(train)<V110_HYPOTHESIS_POLICY.minTrainDays||
  UTC_DAYS(held)<V110_HYPOTHESIS_POLICY.minHoldoutDays)
  return {...partition,status:'INSUFFICIENT_INDEPENDENT_DAYS'};
 const trainSide={LONG:train.filter(x=>x.direction==='LONG'),
  SHORT:train.filter(x=>x.direction==='SHORT')};
 const holdoutSide={LONG:held.filter(x=>x.direction==='LONG'),
  SHORT:held.filter(x=>x.direction==='SHORT')};
 const sideDiagnostics=Object.fromEntries(['LONG','SHORT'].map(dir=>[dir,{
  train:metrics(trainSide[dir]),holdout:metrics(holdoutSide[dir])
 }]));
 // Ideas are ordered by TRAINING evidence. HOLDOUT outcomes cannot decide
 // which filters to explore or help pick thresholds.
 const ideas=RULES.map(rule=>{
  const all=trainSide[rule.side],kept=all.filter(rule.keep);
  const baseline=metrics(all),candidate=metrics(kept);
  const coveragePct=ratio(kept.length,all.length);
  const liftPct=all.length?round(candidate.favorablePct-baseline.favorablePct,1):null;
  const meanLiftBps=all.length&&kept.length?round(candidate.meanBps-baseline.meanBps):null;
  const trainPasses=all.length>=V110_HYPOTHESIS_POLICY.minSideTrain&&
   kept.length>=V110_HYPOTHESIS_POLICY.minTrainSelected&&
   kept.length/all.length>=V110_HYPOTHESIS_POLICY.minCoverage&&
   liftPct>=V110_HYPOTHESIS_POLICY.minTrainLiftPct&&
   meanLiftBps>=V110_HYPOTHESIS_POLICY.minTrainMeanLiftBps&&
   candidate.meanBps>0;
  return {id:rule.id,side:rule.side,hypothesis:rule.detail,
   trainBaseline:baseline,trainCandidate:candidate,
   coveragePct,liftPct,meanLiftBps,trainPasses};
 });
 const eligibleIdeas=ideas.filter(x=>x.trainPasses).sort((a,b)=>
  b.liftPct-a.liftPct||b.meanLiftBps-a.meanLiftBps||a.id.localeCompare(b.id));
 if(!eligibleIdeas.length)return {...partition,status:'NO_TRAINING_HYPOTHESIS',
  sideDiagnostics,ideas};
 const winner=eligibleIdeas[0],rule=RULES.find(r=>r.id===winner.id);
 const baseline=metrics(holdoutSide[rule.side]),
  candidate=metrics(holdoutSide[rule.side].filter(rule.keep));
 const cover=ratio(candidate.n,baseline.n);
 const pass=baseline.n>=V110_HYPOTHESIS_POLICY.minSideHoldout&&
  candidate.n>=V110_HYPOTHESIS_POLICY.minHoldoutSelected&&
  candidate.n/baseline.n>=V110_HYPOTHESIS_POLICY.minCoverage&&
  candidate.favorablePct>=baseline.favorablePct+
   V110_HYPOTHESIS_POLICY.minHoldoutLiftPct&&
  candidate.meanBps>=baseline.meanBps+
   V110_HYPOTHESIS_POLICY.minHoldoutMeanLiftBps&&
  candidate.meanBps>0&&
  candidate.favorable30mPct>=baseline.favorable30mPct;
 return {...partition,
  status:pass?'SHADOW_HYPOTHESIS_PASSED':'HOLDOUT_REJECTED',
  recommendation:pass?'OWNER_REVIEW_FOR_FORWARD_TEST':'KEEP_108',
  selectedOnTrainingOnly:winner.id,
  sideDiagnostics,ideas,
  holdoutBaseline:baseline,holdoutCandidate:candidate,
  holdoutCoveragePct:cover};
}
