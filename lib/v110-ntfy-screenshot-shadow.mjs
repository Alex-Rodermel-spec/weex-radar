// №110 screenshot learning primitives. PURE functions: no ntfy requests, no AI
// model calls, no image storage, no trades and NO automatic strategy updates.
// Intentionally separate from WEEX RADAR #108's live trading code.
import {profileSymbols} from './market-forecast-profiles.mjs';

const MAX_IMAGE_BYTES=2_000_000,MIN=60_000,MAX_AGE_MS=20*MIN;
const DIRECTIONS=new Set(['LONG_BIAS','SHORT_BIAS','MIXED']);
const TF=new Set([1,5,15]);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=x=>Math.round(x*100)/100;
export const V110_SCREENSHOT_STUDY_POLICY=Object.freeze({
 version:'v110-ntfy-vision-shadow-v1',
 input:'NTFY_OWNER_IMAGE_ONLY_AFTER_ACCESS_AND_BUDGET_APPROVAL',
 maxImageBytes:MAX_IMAGE_BYTES,
 maxReceiptAgeMinutes:20,
 fixedFutureWindowsMinutes:[5,10,15],
 minSampleForPercent:20,
 noAutoTrade:true,noLive108Change:true,
 onlyPreRegisteredPredictions:true,
 screenshotIsNotGroundTruth:true,
 noRawImageRetention:true,
 visionBillingDisabledByDefault:true,
 humanApprovalBeforePromotion:true
});
// An ntfy topic is a bearer-style secret, NOT proof of sender identity.
// There is also a separate server-side fee quota and opt-in flag for any model.
export function inspectNtfyScreenshotMessage(msg,expectedTopic,now=Date.now()){
 const invalid=reason=>({ok:false,reason});
 if(typeof expectedTopic!=='string'||expectedTopic.length<16||
  typeof msg!=='object'||msg===null||msg.event!=='message'||
  msg.topic!==expectedTopic||!/^[a-zA-Z0-9]{8,24}$/.test(msg.id||''))
  return invalid('WRONG_TOPIC_OR_MESSAGE');
 if(!Number.isSafeInteger(msg.time)||msg.time*1000>now+30_000||
  now-msg.time*1000>MAX_AGE_MS||now-msg.time*1000<0)
  return invalid('TOO_OLD_OR_FUTURE');
 const a=msg.attachment;
 if(!a||typeof a!=='object'||!Number.isSafeInteger(a.size)||
  a.size<300||a.size>MAX_IMAGE_BYTES||
  !['image/jpeg','image/png','image/webp'].includes(a.type))
  return invalid('INVALID_IMAGE_SIZE_OR_TYPE');
 let u;try{u=new URL(a.url)}catch{return invalid('INVALID_IMAGE_URL')}
 if(u.origin!=='https://ntfy.sh'||u.username||u.password||u.search||u.hash||
  !/^\/file\/[A-Za-z0-9]{8,24}\.(?:jpg|jpeg|png|webp)$/.test(u.pathname))
  return invalid('IMAGE_URL_NOT_APPROVED');
 const ext=u.pathname.split('.').at(-1);
 if((a.type==='image/jpeg'&&!['jpg','jpeg'].includes(ext))||
  (a.type==='image/png'&&ext!=='png')||
  (a.type==='image/webp'&&ext!=='webp'))
  return invalid('IMAGE_TYPE_MISMATCH');
 return {ok:true,id:msg.id,receivedAt:msg.time*1000,
  size:a.size,mime:a.type,
  attachmentUrl:u.href,
  // Do not expose topic or raw message; never infer sender ownership.
  ownershipVerified:false,
  status:'IMAGE_RECEIVED_UNVERIFIED_OWNER',
  requiresOwnerAuthentication:true,requiresVisionApproval:true};
}
export function freezeScreenshotHypothesis(vision,receipt,{now=Date.now()}={}){
 const fail=reason=>({ok:false,reason,noTrading:true});
 if(!receipt?.ok||receipt.ownershipVerified!==true)
  return fail('OWNER_NOT_VERIFIED');
 if(!vision||typeof vision!=='object'||!profileSymbols().includes(vision.symbol)||
  !TF.has(vision.timeframeMinutes)||!DIRECTIONS.has(vision.direction))
  return fail('UNSUPPORTED_OR_AMBIGUOUS_CHART');
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(vision.chartAsOf)||
  vision.chartAsOf>now+15_000||now-vision.chartAsOf>MAX_AGE_MS)
  return fail('STALE_OR_UNDATED_SCREENSHOT');
 if(!finite(vision.referencePrice)||vision.referencePrice<=0||
  !Number.isSafeInteger(vision.chartAsOf)||
  typeof vision.uncertainty!=='string'||
  vision.uncertainty.length>250)
  return fail('UNCERTAIN_REFERENCE_PRICE');
 if(vision.direction==='MIXED')return fail('NO_DIRECTIONAL_HYPOTHESIS');
 // The frozen time (after image analysis and live independent quote check)
 // is the ONLY allowed start of outcome observation, not past chart candles.
 return {ok:true,mode:'V110_SCREENSHOT_SHADOW_FROZEN',
  id:receipt.id,symbol:vision.symbol,
  chartAsOf:vision.chartAsOf,forecastAt:now,
  timeframeMinutes:vision.timeframeMinutes,
  direction:vision.direction,
  referencePrice:vision.referencePrice,
  uncertainty:vision.uncertainty,
  source:'NTFY_CHART_VISION_RESEARCH_ONLY',
  horizonsMinutes:[5,10,15],
  noTrade:true,noLive108Change:true,ordersSent:0};
}
export function evaluateFrozenScreenshotHypothesis(frozen,minuteCandles,now=Date.now()){
 if(frozen?.ok!==true||frozen.mode!=='V110_SCREENSHOT_SHADOW_FROZEN'||
  !Array.isArray(minuteCandles)||!Number.isSafeInteger(now))
  return {status:'INVALID_INPUT',noTrade:true};
 // One full NEW 1m candle must START at or after forecastAt.
 const start=Math.ceil(frozen.forecastAt/MIN)*MIN;
 const closes=new Map();
 for(const c of minuteCandles){
  if(!Number.isSafeInteger(c?.time)||c.time<start||
   c.time+MIN>now-1000||!finite(c.close)||c.close<=0)continue;
  closes.set(c.time+MIN,c.close);
 }
 // Never count partial candles, future data or gaps as successes.
 const sign=frozen.direction==='LONG_BIAS'?1:-1;
 const outcomes={};
 for(const horizon of frozen.horizonsMinutes){
  const required=Array.from({length:horizon},(_,i)=>start+(i+1)*MIN);
  if(required.some(t=>!closes.has(t))){
   outcomes[horizon]={status:'PENDING_OR_MISSING',moveBps:null};continue;
  }
  const price=closes.get(required.at(-1));
  const moveBps=round(sign*(price/frozen.referencePrice-1)*10000);
  outcomes[horizon]={status:'OBSERVED',moveBps,
   directionResult:moveBps>0?'FAVORABLE':moveBps<0?'ADVERSE':'FLAT'};
 }
 return {mode:'V110_SCREENSHOT_SHADOW_FOLLOWUP',id:frozen.id,
  symbol:frozen.symbol,direction:frozen.direction,
  outcomeWindowStartsAt:start,
  outcomes,noTrade:true,noLive108Change:true,
  verifiedBy:'FUTURE_CLOSED_WEEX_1M_CANDLES',
  warning:'Selected screenshots are a biased sample; direction does not imply fill or profit.'};
}
export function summarizeScreenshotResearch(frozenEvaluations){
 const valid=Array.isArray(frozenEvaluations)?frozenEvaluations.filter(r=>
  r?.mode==='V110_SCREENSHOT_SHADOW_FOLLOWUP'):[],
  result={mode:'V110_SCREENSHOT_SHADOW_AGGREGATE',
   observations:valid.length,noLive108Change:true,
   readyForPromotion:false,byHorizon:{}};
 for(const h of [5,10,15]){
  const obs=valid.map(r=>r.outcomes?.[h]).filter(x=>x?.status==='OBSERVED'&&
   finite(x.moveBps));
  const favorable=obs.filter(x=>x.moveBps>0).length,
   adverse=obs.filter(x=>x.moveBps<0).length;
  result.byHorizon[h]={observed:obs.length,favorable,adverse,
   flat:obs.length-favorable-adverse,
   unknown:valid.length-obs.length,
   favorablePct:obs.length>=20?round(100*favorable/obs.length):null};
 }
 return result;
}
