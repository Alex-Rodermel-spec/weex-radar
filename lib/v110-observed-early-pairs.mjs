// PR110 read-only evaluation of ACTUALLY published WEEX PRE_BREAK alerts.
// No hypothetical alert timestamps in this module. No ntfy sending, orders,
// paid providers, account endpoints, or secret storage.
import {evaluateAnchored5mConfirmation} from './v110-anchored-5m-shadow.mjs';
const MIN=60000,FIVE=5*MIN;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const sideSign=x=>x==='LONG'?1:-1;
const safeKey=a=>typeof a?.key==='string'&&a.key.length>0;
export const OBSERVED_PAIR_POLICY=Object.freeze({
 version:'2026-11-12-pr110-actual-ntfy-same-trigger-shadow-v1',
 maxNoticeAgeMinutes:60,
 maxNotices:8,maxSymbols:4,
 validForTrading:false,actualPhoneReceiptVerified:false,
 independent5mBreakoutRequired:false,
 ordersSent:0,notificationsSent:0
});
export function auditObservedEarlyPairs(alerts,oneBySymbol,fiveBySymbol,
 fifteenBySymbol,now=Date.now()){
 const unique=new Map();
 if(!Array.isArray(alerts))alerts=[];
 for(const a of alerts){
  if(a?.watchType!=='PRE_BREAK'||!safeKey(a)||
   !['LONG','SHORT'].includes(a.direction)||
   !Number.isSafeInteger(a.sentAt)||a.sentAt>now||
   now-a.sentAt>OBSERVED_PAIR_POLICY.maxNoticeAgeMinutes*MIN||
   ![a.trigger,a.invalidation].every(x=>finite(x)&&x>0))continue;
  if(!unique.has(a.key))unique.set(a.key,a);
 }
 const sample=[...unique.values()].sort((a,b)=>b.sentAt-a.sentAt)
  .slice(0,OBSERVED_PAIR_POLICY.maxNotices);
 const consideredSymbols=[...new Set(sample.map(a=>a.symbol))]
  .slice(0,OBSERVED_PAIR_POLICY.maxSymbols);
 const summary={mode:'REAL_NTFY_ANCHORED_5M_SHADOW',
  version:OBSERVED_PAIR_POLICY.version,
  latestNoticesEligible:unique.size,sampledNotices:0,
  missingEvidence:0,cancelledByLaterNotice:0,
  shadowMatched:0,shadowUnmatched:0,
  matchedObservedFuture5m:0,matchedFavorableFuture5m:0,
  matchedAdverseFuture5m:0,matchedFlatFuture5m:0,
  reasons:{},trueNtfyTimeButPriceProxy:true,
  requiredNewOrders:0,notificationsSent:0,notProfits:true};
 for(const a of sample){
  if(!consideredSymbols.includes(a.symbol))continue;
  summary.sampledNotices++;
  const one=oneBySymbol?.get?.(a.symbol),
   five=fiveBySymbol?.get?.(a.symbol),
   fifteen=fifteenBySymbol?.get?.(a.symbol);
  if(!Array.isArray(one)||!Array.isArray(five)||!Array.isArray(fifteen)||
    one.length<20||five.length<60||fifteen.length<60){
   summary.missingEvidence++;continue;
  }
  let firstReason='NO_FULL_FIVE_MINUTE_WINDOW',matched=false,replaced=false;
  const first5m=Math.floor(a.sentAt/FIVE)*FIVE+FIVE;
  for(let asOf=first5m;asOf<=a.sentAt+15*MIN;asOf+=FIVE){
   if(asOf>now-1000)break;
   if(asOf-a.sentAt<2*MIN)continue;
   // The newer message for this SAME market invalidates the prior
   // scenario regardless of direction (otherwise stale levels can match).
   if(sample.some(b=>b!==a&&b.symbol===a.symbol&&
      b.sentAt>a.sentAt&&b.sentAt<asOf)){
    replaced=true;break;
   }
   const lastFive=five.find(c=>c.closeTime===asOf);
   if(!lastFive)continue;
   const prior5=five.filter(c=>c.closeTime<=asOf).slice(-125),
    prior15=fifteen.filter(c=>c.closeTime<=asOf).slice(-125),
    post1=one.filter(c=>c.time>=a.sentAt&&c.closeTime<=asOf);
   const review=evaluateAnchored5mConfirmation({
    symbol:a.symbol,
    scenario:{direction:a.direction,sentAt:a.sentAt,
      trigger:a.trigger,invalidation:a.invalidation},
    five:prior5,fifteen:prior15,one:post1,quote:lastFive.close,asOf
   });
   firstReason=review.reason;
   if(review.status==='ANCHOR_CONFIRMED_RESEARCH_ONLY'){
    matched=true;summary.shadowMatched++;
    const future=one.find(c=>c.closeTime===asOf+FIVE)?.close;
    if(finite(future)&&future>0&&lastFive.close>0){
     const signed=sideSign(a.direction)*(future-lastFive.close);
     summary.matchedObservedFuture5m++;
     if(signed>0)summary.matchedFavorableFuture5m++;
     else if(signed<0)summary.matchedAdverseFuture5m++;
     else summary.matchedFlatFuture5m++;
    }
    break;
   }
  }
  if(replaced)summary.cancelledByLaterNotice++;
  else if(!matched){
   summary.shadowUnmatched++;
   summary.reasons[firstReason]=(summary.reasons[firstReason]||0)+1;
  }
 }
 return summary;
}
