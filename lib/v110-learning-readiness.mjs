// V110 only: public aggregate preflight of existing production journal.
// No private archive rows, decrypted inputs, trading keys or ntfy topics cross
// between Production and Preview. Manual GET only, never a cron or scanner.
export const READINESS_POLICY=Object.freeze({
 version:'v110-aggregate-preflight-v1',
 mode:'AGGREGATE_ONLY',automaticModelTraining:false,
 independentEventValidation:false,readyForPromotion:false,
 requiredEligible:180,noOrders:true,noNotificationChanges:true,
 newMarketRequests:0
});
const SOURCE='https://weex-radar.vercel.app/api/signals?mode=journal';
const okInt=x=>Number.isSafeInteger(x)&&x>=0;
const take=x=>okInt(x)?x:null;
export function summarizeLearningReadiness(j){
 if(!j||j.state!=='READY'||j.persistent!==true||
    j.encryptedAtRest!==true||typeof j.forecastStudy!=='object')
  throw Error('PUBLIC_AGGREGATE_UNAVAILABLE');
 const fs=j.forecastStudy||{},windows=fs.windows||{};
 const recent=windows['1']||{},all=windows['90']||{};
 const at15=all.at15m||{},at30=all.at30m||{};
 const forecastTotal=take(fs.archivedForecasts),at15Observed=take(at15.observed);
 const at30Observed=take(at30.observed);
 if([forecastTotal,at15Observed,at30Observed].includes(null)||
  at15Observed>forecastTotal||at30Observed>forecastTotal)
   throw Error('INVALID_PUBLIC_AGGREGATES');
 return {
  mode:'V110_SHADOW_LEARNING_READINESS',
  source:'CURRENT_PUBLIC_AGGREGATES_FROM_PRODUCTION_ENCRYPTED_JOURNAL',
  generatedAt:take(j.generatedAt),
  archive:{forecastTotal,at15Observed,at30Observed,
   publishedEarly:take(j.earlyStudy?.archivedEarly),
   confirmed:take(j.archivedSignals),last24h:take(recent.total)},
  observedDirection:{at15mFavorable:take(at15.favorable),
   at15mAdverse:take(at15.adverse),at15mFlat:take(at15.flat)},
  training:{status:'ROW_LEVEL_SECURE_EVALUATION_REQUIRED',
   minEligible:READINESS_POLICY.requiredEligible,
   eligibleAfterDedup:null,trainDays:null,holdoutDays:null,
   ownerApprovalRequired:true,realModelTestCompleted:false,
   recommendation:'KEEP_108'},
  safeguards:{noSecretsCopied:true,readonly:true,ordersSent:0,
   liveSignalChanges:0,ntfyChanges:0},
  limitations:'Aggregate counts cannot validate pre-notice features, chronological train/holdout, embargo or overlapping predictions. No model was fitted or validated.'
 };
}
export async function handleLearningReadiness(req,res,{fetchImpl=fetch}={}){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{
  const r=await fetchImpl(SOURCE,{cache:'no-store',
   signal:AbortSignal.timeout(8000),
   headers:{Accept:'application/json'}});
  if(!r.ok)throw Error('PUBLIC_JOURNAL_HTTP_ERROR');
  const len=Number(r.headers?.get?.('content-length')||0);
  if(len>1800000)throw Error('PUBLIC_JOURNAL_TOO_LARGE');
  const raw=await r.text();
  if(raw.length>1800000)throw Error('PUBLIC_JOURNAL_TOO_LARGE');
  return res.status(200).json(summarizeLearningReadiness(JSON.parse(raw)));
 }catch{
  return res.status(503).json({mode:'V110_SHADOW_LEARNING_READINESS',
   status:'AGGREGATE_REPORT_UNAVAILABLE',recommendation:'KEEP_108',
   noModelTraining:true,liveSignalChanges:0,ordersSent:0});
 }
}
