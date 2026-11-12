// V110 shadow-only early forecast obstacle checks on PREVIOUS CLOSED 5m bars.
// Not a trade rule, calibrated probability, live notification change or order.
// This is deliberately separate from forecastPreBreak until replay demonstrates
// meaningful value on independently observed signals and real publishing times.
import {marketForecastProfile} from './market-forecast-profiles.mjs';
const MIN=60_000;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export const EARLY_LEVEL_SHADOW_POLICY=Object.freeze({
 version:'2026-11-12-early-5m-obstacle-shadow-v1',
 prior5mLevels:12,
 adverseWickFraction:0.45,
 obstacleDistanceAtr5:0.30,
 actualNotificationsChanged:false,
 extraMarketRequests:0,ordersSent:0
});
export function earlyLevelShadow(candidate,five,symbol){
 const group=marketForecastProfile(symbol)?.group??null;
 const unknown=reason=>({status:'UNKNOWN',reason,group,obstacleAhead:null,
  last5mRejection:null});
 if(!candidate||!['LONG','SHORT'].includes(candidate.direction)||
  !Number.isSafeInteger(candidate.candleCloseTime)||
  !finite(candidate.triggerPrice)||candidate.triggerPrice<=0||
  !Array.isArray(five)||five.length<25)return unknown('MISSING_5M_CONTEXT');
 const rows=five.slice(-25);
 for(let i=0;i<rows.length;i++){
  const x=rows[i],prev=rows[i-1];
  if(!x||![x.time,x.closeTime,x.open,x.high,x.low,x.close,x.volume].every(finite)||
   x.open<=0||x.low<=0||x.close<=0||x.volume<0||
   x.high<Math.max(x.open,x.close)||x.low>Math.min(x.open,x.close)||
   x.closeTime!==x.time+5*MIN||x.closeTime>candidate.candleCloseTime||
   (i>0&&x.time!==prev.time+5*MIN))return unknown('INVALID_5M_CONTEXT');
 }
 const last=rows.at(-1),levels=rows.slice(-13,-1);
 const resistance=Math.max(...levels.map(x=>x.high));
 const support=Math.min(...levels.map(x=>x.low));
 let ranges=0;
 for(let i=1;i<rows.length;i++){
  const a=rows[i],p=rows[i-1].close;
  ranges+=Math.max(a.high-a.low,Math.abs(a.high-p),Math.abs(a.low-p));
 }
 const atr5=ranges/(rows.length-1);
 if(!finite(atr5)||atr5<=0)return unknown('INVALID_5M_VOLATILITY');
 const isLong=candidate.direction==='LONG';
 const level=isLong?resistance:support,trigger=candidate.triggerPrice;
 const distance=isLong?level-trigger:trigger-level;
 const obstacleAhead=distance>0&&distance<=
   EARLY_LEVEL_SHADOW_POLICY.obstacleDistanceAtr5*atr5;
 const span=last.high-last.low;
 const adverseWick=span>0?
   (isLong?last.high-last.close:last.close-last.low)/span:0;
 const last5mRejection=span>0&&adverseWick>=
   EARLY_LEVEL_SHADOW_POLICY.adverseWickFraction&&
   (isLong?last.close<=last.open:last.close>=last.open);
 const reasons=[obstacleAhead?'NEAR_5M_OPPOSING_LEVEL':null,
   last5mRejection?'REJECTION_WICK_ON_LAST_CLOSED_5M':null].filter(Boolean);
 return {status:reasons.length?'CAUTION':'CLEAR',
  reason:reasons.join('+')||'NO_NEAR_OBSTACLE_OR_REJECTION',
  group,obstacleAhead,last5mRejection,
  priorResistance:resistance,priorSupport:support,
  distanceInAtr5:Number((distance/atr5).toFixed(3)),
  noFutureCandles:true,noOrders:true};
}
