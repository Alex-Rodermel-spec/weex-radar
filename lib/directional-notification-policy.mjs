// Read-only gate for OWNER PHONE notifications.
// Forecasts and early 1m observations remain useful in diagnostics but are
// never converted into confirmed trades or notifications by this module.
// A positive *estimated* net R/R is not a calibrated win probability.
import {COST_MIN_NET_RR} from './net-costs.mjs';
const DIR=['LONG','SHORT'];
// Live manual-entry SAFETY limit, not an accuracy prediction. A completed
// 5m candle already advanced >=0.30% in the proposed direction can mean
// a late/chasing entry when no confirmed trend-aligned retest exists.
// Unknown prior move is NOT treated as evidence of a safe entry.
export const MAX_UNRETESTED_5M_CHASE_BPS=30;
export const PHONE_POLICY=Object.freeze({
 mode:'CONFIRMED_LONG_SHORT_ONLY',exchange:'WEEX',
 earlyToPhone:false,forecastFollowupsToPhone:false,
 minModeledNetRR:COST_MIN_NET_RR,
 maxUnretestedClosed5mChaseBps:MAX_UNRETESTED_5M_CHASE_BPS,
 requires:['CLOSED_5M','FRESH_WEEX_QUOTE','ENTRY_QUALITY',
  'MANUAL_REVIEW','COSTS_PASS_ESTIMATE','NO_EXTENDED_5M_WITHOUT_RETEST'],
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
 // Do not encourage chasing an extended 5m impulse WITHOUT a confirmed
 // retest. This changes only 5m phone delivery, not indicators, forecasts,
 // TP/SL, trade permission, or leverage. Full recheck still remains required.
 const retest=signal.retest?.[signal.direction];
 const confirmed=retest?.status==='CONFIRMED'&&retest.trendAligned===true;
 if(Number.isFinite(signal.closedFiveMinuteMoveBps)&&
   signal.closedFiveMinuteMoveBps>=MAX_UNRETESTED_5M_CHASE_BPS&&!confirmed)
  return 'UNRETESTED_EXTENDED_5M_CHASE';
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
