// Live forecast-channel timeliness safeguard: NOT a direction predictor.
// Uses ONLY closed, consecutive WEEX 1m candles available before message.
// No new API requests, no orders, no notification cadence/volume increase.
// This blocks an already-moving scenario from taking a limited ntfy slot;
// it may also drop a forecast that later moves correctly (precision/recall tradeoff).
import {adaptiveForecastThresholds,marketForecastProfile} from './market-forecast-profiles.mjs';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export const FORECAST_ARRIVAL_POLICY=Object.freeze({
 version:'2026-11-12-safe-legacy-cap-and-5m-reversal-v3',
 minuteThresholdBps:10,windowMinutes:[1,3],
 suppressOnlyDetectedLate:true,maxExtraQueries:0,
 sameNtfyTopic:true,noAutotrade:true
});
const round=n=>Math.round(n*10)/10;
export function forecastShortPreMove(d,minuteBars,symbol=d?.symbol){
 const unavailable={mode:'FORECAST_PRE_ALERT_1M_3M',
  sampleReady:false,lateRisk:false,preMove1mBps:null,
  preMove3mBps:null,threshold1mBps:null,threshold3mBps:null,
  legacyLateRisk:false,adaptiveReady:false,assetProfile:marketForecastProfile(symbol),
  reason:'UNVERIFIED',tradeSignal:false};
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
  Math.abs(four.at(-1).close-last.price)>
    Math.max(last.price*0.000001,0.0000000051))
  return unavailable;
 const current=four[3].close;
 const move=(old)=>round(10000*direction*(current-old)/old);
 const preMove1mBps=move(four[2].close);
 const preMove3mBps=move(four[0].close);
 // Compare to 60 older 1m returns from THIS market. The 3m move being
 // checked is excluded from that baseline, so a new impulse cannot make its
 // own threshold easier to pass. Missing volatility => original fixed policy.
 const adaptive=adaptiveForecastThresholds(symbol,minuteBars,last.closedAt);
 const threshold1mBps=adaptive?.threshold1mBps??
  FORECAST_ARRIVAL_POLICY.minuteThresholdBps;
 const threshold3mBps=adaptive?.threshold3mBps??
  FORECAST_ARRIVAL_POLICY.minuteThresholdBps;
 const legacyLateRisk=preMove1mBps>=FORECAST_ARRIVAL_POLICY.minuteThresholdBps||
  preMove3mBps>=FORECAST_ARRIVAL_POLICY.minuteThresholdBps;
 // Do not turn off previously proven safety checks simply because a
 // memecoin has a higher usual volatility. Adaptive levels may tighten,
 // never relax, the pre-move protection until a replay validates doing so.
 const lateRisk=legacyLateRisk||preMove1mBps>=threshold1mBps||
  preMove3mBps>=threshold3mBps;
 return {mode:unavailable.mode,sampleReady:true,lateRisk,
  preMove1mBps,preMove3mBps,threshold1mBps,threshold3mBps,
  legacyLateRisk,adaptiveReady:Boolean(adaptive),
  assetProfile:marketForecastProfile(symbol),
  median1mAbsReturnBps:adaptive?.median1mAbsReturnBps??null,
  baselineEndsAt:adaptive?.referenceEndsAt??null,
  policyVersion:FORECAST_ARRIVAL_POLICY.version,
  reason:lateRisk?'ALREADY_MOVED_FOR_OWN_MARKET':'NO_FAST_EXTENSION',
  tradeSignal:false};
}
// V2 may catch exhaustion/EMA stretch after >3 minutes. Treat EITHER warning
// as late-risk for slot selection. Never assume missing candles prove early.
export function forecastDeliveryDecision(d){
 const v2=d?.strongV2Review;
 const timed=d?.arrivalTiming;
 if(v2?.sampleReady===true&&v2.status==='REVIEW_DOWNGRADE'&&
  ['STRONG','STANDARD'].includes(v2.baselineLevel)&&
  (!d?.strengthRisk||d.strengthRisk.level===v2.baselineLevel))
  return {status:'SUPPRESS_LATE',reason:'V2_DETECTED_CHASE'};
 if(timed?.sampleReady===true&&timed.lateRisk===true)
  return {status:'SUPPRESS_LATE',reason:'CLOSED_1M_3M_ALREADY_MOVED'};
 if(d?.reversalRisk?.sampleReady===true&&d.reversalRisk.highRisk===true)
  return {status:'SUPPRESS_REVERSAL',reason:'CLOSED_1M_5M_OPPOSING_MOMENTUM'};
 if(timed?.sampleReady!==true||v2?.sampleReady!==true||
  !['REVIEW_KEEP_STRONG','REVIEW_KEEP_STANDARD'].includes(v2.status))
  return {status:'UNKNOWN',reason:'MISSING_PRE_ALERT_EVIDENCE'};
 return {status:'CANDIDATE',reason:'NO_DETECTED_CHASE'};
}
