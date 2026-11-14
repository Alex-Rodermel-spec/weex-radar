// Embedded, free, trainable machine-learning model in the EXISTING V110.
// Pure shadow analysis over already-published encrypted forecast records.
// No model API, markets, orders, ntfy, secrets, filesystem, or live policy.
// Trains deterministically with REGULARIZED logistic regression; evaluates
// only on later, whole UTC days separated by a 30-minute embargo.
export const V110_ML_POLICY=Object.freeze({
 version:'v110-ml-15m-logistic-shadow-v1',
 algorithm:'REGULARIZED_LOGISTIC_REGRESSION',
 horizonMinutes:15,trainDaysMinimum:3,holdoutDaysMinimum:2,
 minTrain:120,minHoldout:60,perSymbolSpacingMinutes:30,
 embargoMinutes:30,topTrainFraction:0.4,
 minSelectedHoldout:25,minCoverage:0.3,
 minHitLiftPct:5,minBrierImprovement:0.005,
 minMeanBpsLift:2,epochs:130,learningRate:0.35,
 ridge:0.06,maxRecords:5000,
 liveEnabled:false,ordersSent:0,extraMarketRequests:0,
 paidApiCalls:0,requiresForwardValidation:true,
 changesSignals:false,changesForecasts:false
});
const MIN=60_000,DAY=86_400_000;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=(v,d=3)=>Number(v.toFixed(d));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const logistic=z=>1/(1+Math.exp(-clamp(z,-20,20)));
const sigmoidRate=(n,total)=>clamp((n+1)/(total+2),0.05,0.95);

// Only data present at publication is a model feature. NEVER incorporate
// windows, future candles, firstFavorableMinute or post-alert market moves.
function features(r){
 const moves=['preMove1mBps','preMove3mBps','preMove5mBps','preMove15mBps'];
 const scales=[25,40,60,120];
 const nums=moves.map((key,i)=>{
  const v=r[key];
  return finite(v)&&Math.abs(v)<=2500?clamp(v/scales[i],-3,3):0;
 });
 const missing=moves.map(key=>finite(r[key])&&Math.abs(r[key])<=2500?0:1);
 return [
  r.direction==='LONG'?1:-1,
  r.strength==='STRONG'?1:0,
  r.strength==='CAUTION'?1:0,
  r.v2Timing==='CLEAR'?1:0,
  r.v2Timing==='LATE'?1:0,
  ...nums,...missing
 ];
}
function eligible(rows,now){
 const seen=new Map();
 for(const r of rows){
  if(!r||!(/^[a-f0-9]{32}$/).test(r.id||'')||
   !/^[A-Z0-9]{2,24}$/.test(r.symbol||'')||
   !['LONG','SHORT'].includes(r.direction)||
   !['STRONG','STANDARD','CAUTION'].includes(r.strength)||
   !Number.isSafeInteger(r.sentAt)||r.sentAt<=0||
   r.sentAt+35*MIN>=now||r.sentAt>now||
   r.windows?.[15]?.status!=='OBSERVED'||
   r.windows?.[30]?.status!=='OBSERVED'||
   !finite(r.windows[15].moveBps)||!finite(r.windows[30].moveBps)||
   Math.abs(r.windows[15].moveBps)>=10000||
   Math.abs(r.windows[30].moveBps)>=10000)continue;
  const row={
   id:r.id,symbol:r.symbol,sentAt:r.sentAt,
   direction:r.direction,strength:r.strength,v2Timing:r.v2Timing,
   preMove1mBps:r.preMove1mBps,preMove3mBps:r.preMove3mBps,
   preMove5mBps:r.preMove5mBps,preMove15mBps:r.preMove15mBps,
   x:features(r),label:r.windows[15].moveBps>0?1:0,
   move15:r.windows[15].moveBps,
   move30:r.windows[30].moveBps
  };
  const old=seen.get(r.id);
  if(!old||row.sentAt<old.sentAt)seen.set(r.id,row);
 }
 const sampled=[],last=new Map();
 for(const r of [...seen.values()].sort((a,b)=>a.sentAt-b.sentAt||
  a.id.localeCompare(b.id))){
  const old=last.get(r.symbol);
  if(old!==undefined&&r.sentAt-old<V110_ML_POLICY.perSymbolSpacingMinutes*MIN)continue;
  last.set(r.symbol,r.sentAt);sampled.push(r);
 }
 return sampled;
}
function fit(train){
 const dim=train[0].x.length;
 const w=Array(dim).fill(0);
 const p=sigmoidRate(train.reduce((s,r)=>s+r.label,0),train.length);
 let b=Math.log(p/(1-p));
 // Full-batch deterministic gradient descent with fixed hyperparameters.
 // Feature scales and regularization are NOT tuned on the holdout.
 for(let epoch=0;epoch<V110_ML_POLICY.epochs;epoch++){
  const grad=Array(dim).fill(0);let biasGrad=0;
  for(const r of train){
   let z=b;
   for(let j=0;j<dim;j++)z+=w[j]*r.x[j];
   const delta=logistic(z)-r.label;
   biasGrad+=delta;
   for(let j=0;j<dim;j++)grad[j]+=delta*r.x[j];
  }
  b-=V110_ML_POLICY.learningRate*biasGrad/train.length;
  for(let j=0;j<dim;j++){
   w[j]-=V110_ML_POLICY.learningRate*
    (grad[j]/train.length+V110_ML_POLICY.ridge*w[j]);
  }
 }
 return {w,b,trainConstantProbability:p};
}
function predict(model,r){
 let z=model.b;
 for(let j=0;j<model.w.length;j++)z+=model.w[j]*r.x[j];
 return logistic(z);
}
function metrics(rows){
 const n=rows.length;
 return {n,favorablePct:n?round(rows.reduce((s,r)=>s+r.label,0)*100/n,1):null,
  mean15mBps:n?round(rows.reduce((s,r)=>s+r.move15,0)/n,2):null,
  favorable30mPct:n?round(rows.filter(r=>r.move30>0).length*100/n,1):null};
}
const numDays=a=>new Set(a.map(r=>Math.floor(r.sentAt/DAY))).size;
function brier(rows,probability){
 if(!rows.length)return null;
 return round(rows.reduce((sum,r)=>{
  const d=probability(r)-r.label;
  return sum+d*d;
 },0)/rows.length,5);
}
export function evaluateV110MLShadow(input,now=Date.now()){
 const base={mode:'V110_EMBEDDED_ML_SHADOW',
  version:V110_ML_POLICY.version,
  algorithm:V110_ML_POLICY.algorithm,
  outcome:'15M_DIRECTION_AFTER_PUBLISHED_FORECAST',
  featureSource:'ONLY_PUBLICATION_TIME_METADATA_AND_PRE_ALERT_CLOSES',
  modelTrained:false,ordersSent:0,paidApiCalls:0,extraMarketRequests:0,
  liveChanges:0,changesLiveSignals:false,
  independentForwardRequired:true,recommendation:'KEEP_108',
  note:'Real trainable ML, not an LLM. It studies only already-published forecasts. Chronological historical holdout is a screening exercise, NOT proof of future accuracy, independent price prediction or tradable profit.'};
 if(!Array.isArray(input)||input.length>V110_ML_POLICY.maxRecords||
  !Number.isSafeInteger(now))
  return {...base,status:'INVALID_INPUT',eligible:0};
 const rows=eligible(input,now);
 const allDays=[...new Set(rows.map(r=>Math.floor(r.sentAt/DAY)))].sort((a,b)=>a-b);
 if(allDays.length<V110_ML_POLICY.trainDaysMinimum+
   V110_ML_POLICY.holdoutDaysMinimum)
  return {...base,status:'COLLECTING_INDEPENDENT_DAYS',
   eligible:rows.length,distinctDays:allDays.length,requiredDays:5};
 const split=Math.max(V110_ML_POLICY.trainDaysMinimum,
  Math.min(allDays.length-V110_ML_POLICY.holdoutDaysMinimum,
   Math.floor(allDays.length*0.7)));
 const cut=allDays[split]*DAY;
 const train=rows.filter(r=>r.sentAt<cut-V110_ML_POLICY.embargoMinutes*MIN);
 const holdout=rows.filter(r=>r.sentAt>=cut+V110_ML_POLICY.embargoMinutes*MIN);
 const progress={eligible:rows.length,distinctDays:allDays.length,
  trainN:train.length,holdoutN:holdout.length,
  trainDays:numDays(train),holdoutDays:numDays(holdout),
  embargoMinutes:V110_ML_POLICY.embargoMinutes,
  trainEndExclusive:new Date(cut-V110_ML_POLICY.embargoMinutes*MIN).toISOString(),
  holdoutStartInclusive:new Date(cut+V110_ML_POLICY.embargoMinutes*MIN).toISOString()};
 if(train.length<V110_ML_POLICY.minTrain||
  holdout.length<V110_ML_POLICY.minHoldout||
  progress.trainDays<V110_ML_POLICY.trainDaysMinimum||
  progress.holdoutDays<V110_ML_POLICY.holdoutDaysMinimum)
  return {...base,...progress,status:'INSUFFICIENT_SEPARATED_SAMPLES'};
 const model=fit(train);
 const sorted=train.map(r=>predict(model,r)).sort((a,b)=>b-a);
 const threshold=sorted[Math.ceil(train.length*V110_ML_POLICY.topTrainFraction)-1];
 const spread=sorted[0]-sorted.at(-1);
 const held=metrics(holdout);
 const selected=holdout.filter(r=>predict(model,r)>=threshold);
 const chosen=metrics(selected);
 const constantBrier=brier(holdout,()=>model.trainConstantProbability);
 const modelBrier=brier(holdout,r=>predict(model,r));
 const advantage=round(constantBrier-modelBrier,5);
 const lift=chosen.favorablePct===null?null:
  round(chosen.favorablePct-held.favorablePct,1);
 const meanLift=chosen.mean15mBps===null?null:
  round(chosen.mean15mBps-held.mean15mBps,2);
 const coveragePct=round(selected.length*100/holdout.length,1);
 const sufficientlyMany=selected.length>=V110_ML_POLICY.minSelectedHoldout&&
  coveragePct>=V110_ML_POLICY.minCoverage*100;
 const promising=spread>=0.02&&sufficientlyMany&&
  advantage>=V110_ML_POLICY.minBrierImprovement&&
  lift>=V110_ML_POLICY.minHitLiftPct&&
  meanLift>=V110_ML_POLICY.minMeanBpsLift&&
  chosen.favorable30mPct>=held.favorable30mPct;
 return {...base,...progress,modelTrained:true,
  status:promising?'HISTORICAL_HOLDOUT_PROMISING_ONLY':
   'HISTORICAL_HOLDOUT_NO_PROVEN_ADVANTAGE',
  modelFeatures:13,trainingBaselineHitPct:metrics(train).favorablePct,
  holdoutBaseline:held,
  holdoutSelected:{
   n:selected.length,coveragePct,
   // Sparse subsets must not be advertised as promising outcome rates.
   favorablePct:selected.length>=25?chosen.favorablePct:null,
   mean15mBps:selected.length>=25?chosen.mean15mBps:null,
   favorable30mPct:selected.length>=25?chosen.favorable30mPct:null
  },
  holdoutBrier:{constantTrainingRate:constantBrier,
   learnedModel:modelBrier,improvement:advantage},
  trainedTopFraction:V110_ML_POLICY.topTrainFraction,
  validationPassedHistoricalScreen:promising,
  // No probabilities, weights, secret journal rows or IDs are published.
  futurePredictionApproved:false};
}
