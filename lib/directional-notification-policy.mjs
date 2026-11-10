// Read-only gate for OWNER PHONE notifications.
// Forecasts and early 1m observations remain useful in diagnostics but are
// never converted into confirmed trades or notifications by this module.
// A positive *estimated* net R/R is not a calibrated win probability.
import {COST_MIN_NET_RR} from './net-costs.mjs';
const DIR=['LONG','SHORT'];
export const PHONE_POLICY=Object.freeze({
 mode:'CONFIRMED_LONG_SHORT_ONLY',exchange:'WEEX',
 earlyToPhone:false,forecastFollowupsToPhone:false,
 minModeledNetRR:COST_MIN_NET_RR,
 requires:['CLOSED_5M','FRESH_WEEX_QUOTE','ENTRY_QUALITY',
  'MANUAL_REVIEW','COSTS_PASS_ESTIMATE'],
 noAutoTrade:true
});
export function phoneGate(signal,now=Date.now()){
 if(!signal||!DIR.includes(signal.direction))return 'NOT_DIRECTIONAL';
 if(signal.exchange!=='WEEX'||signal.status!=='ok')return 'EXCHANGE_OR_DATA';
 if(!Number.isSafeInteger(signal.candleCloseTime)||
  signal.candleCloseTime>now||now-signal.candleCloseTime>90000)
  return 'STALE_CANDLE';
 if(!Number.isFinite(signal.expiresAt)||signal.expiresAt<=now+15000)
  return 'EXPIRED';
 if(!Number.isFinite(signal.livePrice)||signal.livePrice<=0)
  return 'NO_FRESH_QUOTE';
 if(signal.entryQuality?.ok!==true)return 'ENTRY_RISK';
 if(signal.advisor?.status!=='REVIEW')return 'NOT_REVIEW_APPROVED';
 if(signal.costReview?.mode!=='SHADOW_COSTS'||
  signal.costReview.status!=='PASS_ESTIMATE'||
  !Number.isFinite(signal.costReview.netRR)||
  signal.costReview.netRR<COST_MIN_NET_RR)
  return 'COST_RISK';
 if(signal.retest?.[signal.direction]?.status==='FAILED')
  return 'FAILED_RETEST';
 return 'PHONE_LONG_SHORT';
}
export function filterPhoneCandidates(signals,now=Date.now()){
 const accepted=[],blocked={};
 for(const signal of Array.isArray(signals)?signals:[]){
  const decision=phoneGate(signal,now);
  if(decision==='PHONE_LONG_SHORT')accepted.push(signal);
  else blocked[decision]=(blocked[decision]||0)+1;
 }
 return {accepted,diagnostics:{
  policy:PHONE_POLICY.mode,examined:Array.isArray(signals)?signals.length:0,
  allowed:accepted.length,blocked,notATrade:true
 }};
}
