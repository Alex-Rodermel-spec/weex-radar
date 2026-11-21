// FORECAST V4: frozen, pre-publication evidence-based ntfy slot ranking.
// Ranks at most two existing published FORECAST candidates per 10-minute
// bucket. It does NOT invent a probability or change the underlying bias,
// 32-market scan, cadence, number of messages, or WEEX trading eligibility.
// Any demonstrated advantage must be independently measured afterwards.
import {assessForecastStrengthRisk} from './forecast-strength-risk.mjs';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export const FORECAST_V4_RANKING_POLICY=Object.freeze({
 version:'forecast-v4-5m-evidence-rank-v1',
 primaryHorizonMinutes:5,maxForecastNtfyPerBucket:2,
 newMarketRequests:0,liveOrders:0,liveTradingChanges:0,
 claimsCalibratedAccuracy:false,validatedAccuracyGain:false
});
export function rankForecastV4(d){
 const q=assessForecastStrengthRisk(d);
 const one=d?.timeframes?.[0],five=d?.timeframes?.[1];
 const direction=d?.combinedDirection;
 const sign=direction==='LONG_BIAS'?1:direction==='SHORT_BIAS'?-1:0;
 const timing=d?.arrivalTiming,v2=d?.strongV2Review,rev=d?.reversalRisk;
 if(!sign||!finite(one?.price)||one.price<=0||
  !finite(one?.relativeVolume)||!finite(five?.price)||five.price<=0)
  return {score:-100,status:'UNVERIFIED',reason:'MISSING_CLOSED_EVIDENCE',
   policyVersion:FORECAST_V4_RANKING_POLICY.version,notTrade:true};
 // A correlated 10m candle is not an additional independent predictor.
 const fiveBodyAligned=five.lastCandleBody===(sign===1?'UP':'DOWN');
 const fiveBodyOpposes=five.lastCandleBody===(sign===1?'DOWN':'UP');
 let score=q.level==='STRONG'?8:q.level==='STANDARD'?6:
  q.level==='CAUTION'?0:-10;
 const reasons=[];
 if(fiveBodyAligned){score+=4;reasons.push('5M_BODY_ALIGNED')}
 else if(fiveBodyOpposes){score-=4;reasons.push('5M_BODY_OPPOSING')}
 else{reasons.push('5M_BODY_UNKNOWN')}
 if(v2?.sampleReady===true&&['REVIEW_KEEP_STRONG','REVIEW_KEEP_STANDARD'].includes(v2.status)){
  score+=2;reasons.push('V2_CLEAR');
 }else{score-=2;reasons.push('V2_UNVERIFIED')}
 if(timing?.sampleReady===true&&timing.lateRisk===false){
  score+=1;reasons.push('NOT_FAST_EXTENDED');
 }else{score-=2;reasons.push('TIMING_UNVERIFIED')}
 if(rev?.sampleReady===true&&rev.risk==='CLEAR'){
  score+=1;reasons.push('NO_DETECTED_REVERSAL');
 }else{score-=2;reasons.push('REVERSAL_EVIDENCE_WEAK')}
 if(one.relativeVolume>=1.15&&one.relativeVolume<=3)score+=1;
 // Timeliness, age and exchange are checked elsewhere. No future input.
 return {score,status:score>=12?'5M_EVIDENCE_STRONG':
  score>=7?'5M_EVIDENCE_MIXED':'5M_EVIDENCE_WEAK',
  reason:reasons.join('|'),
  policyVersion:FORECAST_V4_RANKING_POLICY.version,
  primaryHorizonMinutes:5,notTrade:true,
  validatedAccuracyGain:false};
}
