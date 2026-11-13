// Read-only audit of REAL ntfy PRE_BREAK notices, using their ACTUAL
// published time and displayed trigger/cancellation levels.
// NEVER use a historical hypothetical notice for this aggregate.
// A touch is not a trade, a closed 5m confirmation, or a calibrated forecast.
import {outcomeOfEarlyScenario} from './early-scenario-outcome.mjs';
import {marketForecastProfile} from './market-forecast-profiles.mjs';
const MIN=60_000,FIVE=5*MIN;
const STATUSES=['TRIGGER_FIRST','CANCEL_FIRST','AMBIGUOUS','NEITHER'];
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const sign=d=>d==='LONG'?1:-1;
const round=(n,d=2)=>Number(n.toFixed(d));
export const PUBLISHED_EARLY_POLICY=Object.freeze({
 version:'2026-11-12-actual-ntfy-prebreak-5m-audit-v1',
 historicalPriceSource:'WEEX fully closed 1m OHLC',
 actualAlertTimestampRequired:true,
 afterMessagePartialMinuteExcluded:true,
 first5mBoundaryAfterActualTrigger:true,
 nextClosed5mMoveEvaluatedSeparately:true,
 sourceArchiveIsNotReconstructed:true,
 extraDataRequests:0,tradeOrders:0
});
function fiveCloseAt(byTime,closeAt){
 let last=null;
 for(let t=closeAt-FIVE;t<closeAt;t+=MIN){
  const c=byTime.get(t);
  if(!c||c.time!==t||c.closeTime!==t+MIN||
   ![c.open,c.high,c.low,c.close].every(finite)||
   c.open<=0||c.low<=0||c.high<Math.max(c.open,c.close)||
   c.low>Math.min(c.open,c.close))return null;
  last=c;
 }
 return last.close;
}
const result=(status,fields={})=>({status,
 first5m:'UNOBSERVED',following5m:'UNOBSERVED',
 first5mDirectionBps:null,next5mDirectionBps:null,
 invalidatedAfterTrigger:null,...fields});
export function evaluatePublishedPreBreak(alert,candles,now=Date.now()){
 if(alert?.watchType!=='PRE_BREAK'||!['LONG','SHORT'].includes(alert?.direction)||
  !Number.isSafeInteger(alert?.sentAt)||alert.sentAt<=0)
  return result('INVALID_NOTICE');
 if(![alert.trigger,alert.invalidation].every(x=>finite(x)&&x>0))
  return result('NO_PUBLISHED_LEVELS');
 const start=Math.ceil(alert.sentAt/MIN)*MIN;
 if(now<start+15*MIN+1000)return result('PENDING');
 if(!Array.isArray(candles))return result('NO_DATA');
 const base=outcomeOfEarlyScenario({
  direction:alert.direction,trigger:alert.trigger,
  invalidation:alert.invalidation
 },candles,start);
 if(base.status==='UNKNOWN')return result('NO_DATA');
 if(base.status!=='TRIGGER_FIRST')
  return result(base.status,{triggerMinute:base.triggerMinute,
    cancellationMinute:base.cancellationMinute});
 const d=sign(alert.direction);
 const triggerBarClose=start+base.triggerMinute*MIN;
 const first5mClose=Math.ceil(triggerBarClose/FIVE)*FIVE;
 const following5mClose=first5mClose+FIVE;
 const evidence={triggerMinute:base.triggerMinute,first5mClose,
  following5mClose};
 if(now<following5mClose+1000)return result(base.status,{...evidence,
  first5m:'PENDING',following5m:'PENDING'});
 const byTime=new Map(candles.map(c=>[c.time,c]));
 const first=fiveCloseAt(byTime,first5mClose);
 const next=fiveCloseAt(byTime,following5mClose);
 if(!finite(first)||!finite(next))
  return result(base.status,{...evidence,first5m:'NO_DATA',
   following5m:'NO_DATA'});
 let invalidated=false;
 for(let t=triggerBarClose;t<following5mClose;t+=MIN){
  const c=byTime.get(t);
  if(!c||!finite(c.low)||!finite(c.high)||c.high<c.low)
   return result(base.status,{...evidence,first5m:'NO_DATA',
     following5m:'NO_DATA'});
  if(d===1?c.low<=alert.invalidation:c.high>=alert.invalidation)
   invalidated=true;
 }
 const firstBps=round(10000*d*(first-alert.trigger)/alert.trigger);
 const nextBps=round(10000*d*(next-first)/first);
 return result(base.status,{...evidence,
  first5m:firstBps>0?'HELD':firstBps<0?'FAILED':'FLAT',
  following5m:nextBps>0?'CONTINUED':nextBps<0?'REVERSED':'FLAT',
  first5mDirectionBps:firstBps,next5mDirectionBps:nextBps,
  invalidatedAfterTrigger:invalidated});
}
function summarizeGroup(entries){
 const r={notices:entries.length,
  noPublishedLevels:0,pending:0,noData:0,
  triggerFirst:0,cancelFirst:0,ambiguous:0,neither:0,
  first5mObserved:0,first5mHeld:0,
  following5mObserved:0,following5mContinued:0,
  following5mReversed:0,following5mFlat:0,
  invalidatedAfterTrigger:0,
  heldThenContinued:0,heldThenReversed:0,
  meanNext5mBps:null,
  pctTriggerFirst:null,pctHeldThenContinued:null};
 const values=[];
 for(const e of entries){
  const o=e.outcome;
  if(o.status==='NO_PUBLISHED_LEVELS')r.noPublishedLevels++;
  if(o.status==='PENDING')r.pending++;
  if(['NO_DATA','INVALID_NOTICE'].includes(o.status))r.noData++;
  if(o.status==='TRIGGER_FIRST')r.triggerFirst++;
  if(o.status==='CANCEL_FIRST')r.cancelFirst++;
  if(o.status==='AMBIGUOUS')r.ambiguous++;
  if(o.status==='NEITHER')r.neither++;
  if(['HELD','FAILED','FLAT'].includes(o.first5m))r.first5mObserved++;
  if(o.first5m==='HELD')r.first5mHeld++;
  if(['CONTINUED','REVERSED','FLAT'].includes(o.following5m)){
   r.following5mObserved++;
   if(o.following5m==='CONTINUED')r.following5mContinued++;
   if(o.following5m==='REVERSED')r.following5mReversed++;
   if(o.following5m==='FLAT')r.following5mFlat++;
   values.push(o.next5mDirectionBps);
  }
  if(o.invalidatedAfterTrigger===true)r.invalidatedAfterTrigger++;
  if(o.first5m==='HELD'&&o.following5m==='CONTINUED')
   r.heldThenContinued++;
  if(o.first5m==='HELD'&&o.following5m==='REVERSED')
   r.heldThenReversed++;
 }
 const decidable=r.triggerFirst+r.cancelFirst+r.ambiguous+r.neither;
 if(decidable)r.pctTriggerFirst=round(100*r.triggerFirst/decidable,1);
 if(r.following5mObserved)
  r.meanNext5mBps=round(values.reduce((s,n)=>s+n,0)/values.length);
 if(r.first5mHeld)
  r.pctHeldThenContinued=round(100*r.heldThenContinued/r.first5mHeld,1);
 return r;
}
export function summarizePublishedPreBreak(alerts,candlesBySymbol,now=Date.now()){
 const unique=new Map();
 for(const a of alerts??[]){
  if(a?.watchType!=='PRE_BREAK'||!a.key||unique.has(a.key))continue;
  unique.set(a.key,a);
 }
 const entries=[...unique.values()].map(a=>({
  group:marketForecastProfile(a.symbol)?.group??'UNKNOWN',
  outcome:evaluatePublishedPreBreak(a,candlesBySymbol?.get(a.symbol),now)
 }));
 const groups=Object.fromEntries([...new Set(entries.map(e=>e.group))].sort().map(
  g=>[g,summarizeGroup(entries.filter(e=>e.group===g))]));
 return {mode:'REAL_NTFY_PRE_BREAK_5M_AUDIT',policy:PUBLISHED_EARLY_POLICY.version,
  source:'actual ntfy message timestamp, rounded trigger/invalidation, closed WEEX 1m',
  overall:summarizeGroup(entries),byMarketGroup:groups,
  privacy:'aggregates only',notTrades:true,noOrders:true,
  caveat:'Short rolling ntfy history (max 110m), actual phone delivery unverified. The candle containing the alert is excluded. 5m results are not fills, profits, or independent forecasts.'};
}
