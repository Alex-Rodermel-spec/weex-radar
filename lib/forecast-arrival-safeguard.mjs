// Live forecast-channel timeliness safeguard: NOT a direction predictor.
// Uses ONLY closed, consecutive WEEX 1m candles available before message.
// No new API requests, no orders, no notification cadence/volume increase.
// This blocks an already-moving scenario from taking a limited ntfy slot;
// it may also drop a forecast that later moves correctly (precision/recall tradeoff).
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export const FORECAST_ARRIVAL_POLICY=Object.freeze({
 version:'2026-11-12-1m3m-late-slot-safeguard-v1',
 minuteThresholdBps:10,windowMinutes:[1,3],
 suppressOnlyDetectedLate:true,maxExtraQueries:0,
 sameNtfyTopic:true,noAutotrade:true
});
const round=n=>Math.round(n*10)/10;
export function forecastShortPreMove(d,minuteBars){
 const unavailable={mode:'FORECAST_PRE_ALERT_1M_3M',
  sampleReady:false,lateRisk:false,preMove1mBps:null,
  preMove3mBps:null,reason:'UNVERIFIED',tradeSignal:false};
 const [last]=d?.timeframes||[];
 const direction=d?.combinedDirection==='LONG_BIAS'?1:
  d?.combinedDirection==='SHORT_BIAS'?-1:0;
 if(!direction||!Array.isArray(minuteBars)||minuteBars.length<4||
  !Number.isSafeInteger(last?.closedAt)||!finite(last.price)||
  last.price<=0)return unavailable;
 const four=minuteBars.slice(-4);
 if(four.some((b,i)=>!Number.isSafeInteger(b?.closeTime)||
  !finite(b.close)||b.close<=0||b.closeTime>last.closedAt||
  (i>0&&b.closeTime!==four[i-1].closeTime+60000))||
  four.at(-1).closeTime!==last.closedAt||
  Math.abs(four.at(-1).close-last.price)>last.price*0.000001)
  return unavailable;
 const current=four[3].close;
 const move=(old)=>round(10000*direction*(current-old)/old);
 const preMove1mBps=move(four[2].close);
 const preMove3mBps=move(four[0].close);
 const lateRisk=preMove1mBps>=FORECAST_ARRIVAL_POLICY.minuteThresholdBps||
  preMove3mBps>=FORECAST_ARRIVAL_POLICY.minuteThresholdBps;
 return {mode:unavailable.mode,sampleReady:true,lateRisk,
  preMove1mBps,preMove3mBps,
  reason:lateRisk?'ALREADY_MOVED_IN_DIRECTION':'NO_FAST_EXTENSION',
  tradeSignal:false};
}
// V2 may catch exhaustion/EMA stretch after >3 minutes. Treat EITHER warning
// as late-risk for slot selection. Never assume missing candles prove early.
export function forecastDeliveryDecision(d){
 const v2=d?.strongV2Review;
 const timed=d?.arrivalTiming;
 if(v2?.sampleReady===true&&v2.status==='REVIEW_DOWNGRADE'&&
  ['STRONG','STANDARD'].includes(v2.baselineLevel))
  return {status:'SUPPRESS_LATE',reason:'V2_DETECTED_CHASE'};
 if(timed?.sampleReady===true&&timed.lateRisk===true)
  return {status:'SUPPRESS_LATE',reason:'CLOSED_1M_3M_ALREADY_MOVED'};
 if(timed?.sampleReady!==true||v2?.sampleReady!==true||
  !['REVIEW_KEEP_STRONG','REVIEW_KEEP_STANDARD'].includes(v2.status))
  return {status:'UNKNOWN',reason:'MISSING_PRE_ALERT_EVIDENCE'};
 return {status:'CANDIDATE',reason:'NO_DETECTED_CHASE'};
}
