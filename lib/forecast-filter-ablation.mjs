// Read-only, no-trade side-by-side indicator ablation on SAME closed WEEX bars.
// No external calls, alerts, selection changes, price targets or future candles.
// Useful for measuring overlap, NOT for claiming better forward accuracy.
import {marketForecastProfile} from './market-forecast-profiles.mjs';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const side=n=>n===1?'LONG_BIAS':n===-1?'SHORT_BIAS':'MIXED';
const vote=(n,tolerance=0)=>n>tolerance?1:n< -tolerance?-1:0;
function frame(f){
 if(!f||!finite(f.price)||f.price<=0||!finite(f.ema20)||
  !finite(f.ema50)||!finite(f.rsi14)||!finite(f.bollinger20?.middle))
  return null;
 const ema=vote(f.ema20-f.ema50);
 const rsi=vote(f.rsi14-50,2);
 const bb=vote(f.price-f.bollinger20.middle);
 const aboveFast=vote(f.price-f.ema20);
 return {ema,rsi,bb,aboveFast};
}
function aligned(numbers){
 return numbers.every(n=>n===1)?'LONG_BIAS':
  numbers.every(n=>n===-1)?'SHORT_BIAS':'MIXED';
}
const dual=(a,b)=>a!==0&&a===b?a:0;
export const FILTER_ABLATION_POLICY=Object.freeze({
 version:'2026-11-12-weex-closed-candles-ablation-v1',
 mode:'READ_ONLY',newRequests:0,signalChanges:0,ordersSent:0,
 proofOfAccuracy:false,
 fiveMinuteChartPrimary:true
});
export function assessForecastFilterOverlap(d){
 const base={mode:'FORECAST_FILTER_ABLATION_SHADOW',
  policyVersion:FILTER_ABLATION_POLICY.version,
  available:false,assetGroup:marketForecastProfile(d?.symbol)?.group||
   d?.arrivalTiming?.assetProfile?.group||d?.reversalRisk?.group||null,
  liveDirection:d?.combinedDirection||'MIXED',tradeSignal:false,
  validatedWinRate:false,newRequests:0,ordersSent:0,
  decisions:{emaRsi:'MIXED',emaBollinger:'MIXED',fiveMinutePriority:'MIXED'},
  overlap:{tenMinuteDerivedFromFiveMinute:true,
   extremeRsiUsedByDirectionAndRisk:false,
   extremeBollingerUsedByDirectionAndRisk:false,
   oneMinuteRsiHardVetoAlsoWarned:false,
   duplicatedLateReason:false},
  liveVsShadowsDisagree:false,
  explanation:'Shadow comparisons of closed-bar directions, NOT future performance or permission to enter trades.'};
 if(!d?.available||!Array.isArray(d.timeframes)||
  d.timeframes.map(f=>f?.intervalMinutes).join(',')!=='1,5,10')return base;
 const f=d.timeframes.map(frame);
 if(f.some(x=>!x))return base;
 const [m1,m5,m10]=f;
 const emaRsi=aligned(f.map(x=>dual(x.ema,x.rsi)));
 const emaBollinger=aligned(f.map(x=>dual(x.ema,x.bb)));
 // Alternative for EARLY WATCH only: 5m trend and its close agree;
 // 1m close relative to EMA20 must agree. 10m is observed but does
 // not force a stale confirmation. It may be the opposite direction.
 const fiveSide=dual(m5.ema,m5.aboveFast);
 const fiveMinutePriority=fiveSide!==0&&m1.aboveFast===fiveSide?
  side(fiveSide):'MIXED';
 const extremeRsi=d.timeframes.some(x=>
  finite(x.rsi14)&&(x.rsi14<=30||x.rsi14>=70));
 const extremeBb=d.timeframes[0].bollinger20?.position;
 const overBb=['ABOVE_UPPER','BELOW_LOWER'].includes(extremeBb);
 const extremeOne=(d.combinedDirection==='LONG_BIAS'&&
  d.timeframes[0].rsi14>=78)||
  (d.combinedDirection==='SHORT_BIAS'&&d.timeframes[0].rsi14<=22);
 const late=d.arrivalTiming?.lateRisk===true&&
  d.strongV2Review?.status==='REVIEW_DOWNGRADE';
 const decisions={emaRsi,emaBollinger,fiveMinutePriority};
 return {...base,available:true,decisions,
  liveVsShadowsDisagree:Object.values(decisions).some(v=>v!==d.combinedDirection),
  timeframes:{oneMinute:{...m1},fiveMinute:{...m5},tenMinute:{...m10}},
  overlap:{tenMinuteDerivedFromFiveMinute:true,
   extremeRsiUsedByDirectionAndRisk:extremeRsi,
   extremeBollingerUsedByDirectionAndRisk:overBb,
   oneMinuteRsiHardVetoAlsoWarned:extremeOne,
   duplicatedLateReason:late}};
}
