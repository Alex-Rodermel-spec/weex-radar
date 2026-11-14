// Converts a validated 3+2 research-screening result into a sanitized,
// research-only GitHub proposal. This NEVER applies a live policy or trades.
// A future independent forward test and explicit owner approval are required.
export const V110_PROPOSAL_POLICY_IDS=Object.freeze([
 'LONG_SKIP_CAUTION','LONG_SKIP_CHASE','LONG_SKIP_CAUTION_CHASE',
 'SHORT_SKIP_CAUTION','SHORT_SKIP_CHASE','SHORT_SKIP_CAUTION_CHASE'
]);
const okNumber=n=>typeof n==='number'&&Number.isFinite(n);
const okInt=n=>Number.isSafeInteger(n)&&n>=0;
const round=n=>Math.round(n*100)/100;
export function buildV110OwnerProposal(report){
 if(!report||!okInt(report.generatedAt))return null;
 const v=report.hypothesisDiscovery;
 if(!v||v.mode!=='V110_DIRECTIONAL_HYPOTHESIS_SHADOW'||
  v.dataSource!=='ONLY_ACTUALLY_PUBLISHED_ENCRYPTED_FORECASTS'||
  v.status!=='SHADOW_HYPOTHESIS_PASSED'||
  v.recommendation!=='OWNER_REVIEW_FOR_FORWARD_TEST'||
  v.noLiveChanges!==true||v.ordersSent!==0||
  v.requiresOwnerApproval!==true||
  v.requiresIndependentForwardTest!==true)return null;
 const id=v.selectedOnTrainingOnly;
 if(!V110_PROPOSAL_POLICY_IDS.includes(id))return null;
 if(!okInt(v.eligible)||v.eligible<180||
  !okInt(v.trainN)||v.trainN<120||
  !okInt(v.holdoutN)||v.holdoutN<50||
  !okInt(v.trainDays)||v.trainDays<3||
  !okInt(v.holdoutDays)||v.holdoutDays<2)return null;
 const idea=v.ideas?.find(x=>x.id===id);
 if(!idea||idea.trainPasses!==true)return null;
 const b=v.holdoutBaseline,c=v.holdoutCandidate;
 if(!b||!c||!okInt(b.n)||b.n<25||!okInt(c.n)||c.n<18||
  !['favorablePct','meanBps','favorable30mPct'].every(k=>
   okNumber(b[k])&&okNumber(c[k]))||
  c.n/b.n<0.45||
  c.favorablePct<b.favorablePct+6||
  c.meanBps<b.meanBps+3||
  c.meanBps<=0||
  c.favorable30mPct<b.favorable30mPct)return null;
 return Object.freeze({
  schema:'v110-research-proposal-v1',
  policyId:id,
  direction:id.startsWith('LONG_')?'LONG':'SHORT',
  source:'WEEX_RADAR_ENCRYPTED_FORECAST_JOURNAL_AGGREGATES',
  sampleGeneratedAt:new Date(report.generatedAt).toISOString(),
  eligible:v.eligible,
  training:{days:v.trainDays,n:v.trainN},
  screeningHoldout:{days:v.holdoutDays,n:v.holdoutN,
   baselineN:b.n,proposedN:c.n,
   baselineFavorablePct:round(b.favorablePct),
   proposedFavorablePct:round(c.favorablePct),
   deltaFavorablePoints:round(c.favorablePct-b.favorablePct),
   baselineMeanBps:round(b.meanBps),
   proposedMeanBps:round(c.meanBps),
   deltaMeanBps:round(c.meanBps-b.meanBps),
   baselineFavorable30mPct:round(b.favorable30mPct),
   proposedFavorable30mPct:round(c.favorable30mPct)},
  readiness:'FORWARD_TEST_REQUIRED',
  requiresOwnerApproval:true,
  affectsLiveSignals:false,
  affectsOrders:false,
  canAutoMerge:false,
  disclaimer:'Exploratory holdout screening only; no proof of profitable execution. Independent untouched prospective test, latency and costs, owner approval, green CI and rollback are required before ANY change to live №108.'
 });
}
