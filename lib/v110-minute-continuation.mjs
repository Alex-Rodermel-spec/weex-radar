// V110 prototype: closed WEEX 1m candle evidence after a real early notice.
// No future data, account calls or automatic orders. Conservative: unknown -> fail.
export const V110_MINUTE_POLICY=Object.freeze({
 interval:'1m',minPostAlertClosedBars:2,
 requiresFreshFinalMinute:true,requiresTriggerBreak:true,
 requiresNoInvalidation:true,requiresLastMinuteContinuation:true,
 noOrders:true
});
const MINUTE=60000;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function normalizeV110Minutes(payload,signalClose){
 if(!Array.isArray(payload)||!Number.isSafeInteger(signalClose))return [];
 const seen=new Map();
 for(const raw of payload){
  if(!Array.isArray(raw)||raw.length<6)continue;
  const [time,open,high,low,close,volume]=raw.slice(0,6).map(Number);
  if(!Number.isSafeInteger(time)||time%MINUTE!==0||
   time>=signalClose||time<signalClose-125*MINUTE||
   ![open,high,low,close,volume].every(finite)||
   open<=0||low<=0||volume<0||
   high<Math.max(open,close,low)||low>Math.min(open,close))continue;
  if(time+MINUTE<=signalClose)seen.set(time,{
   time,closeTime:time+MINUTE,open,high,low,close,volume});
 }
 return [...seen.values()].sort((a,b)=>a.time-b.time);
}
export function validateV110MinuteContinuation(signal,scenario,candles){
 const fail=reason=>({ok:false,reason});
 if(!signal||!scenario||!Array.isArray(candles)||
  !['LONG','SHORT'].includes(signal.direction)||
  !Number.isSafeInteger(signal.candleCloseTime)||
  !Number.isSafeInteger(scenario.sentAt)||
  scenario.sentAt>=signal.candleCloseTime||
  ![scenario.trigger,scenario.invalidation,signal.price].every(x=>finite(x)&&x>0))
  return fail('MINUTE_EVIDENCE_MISSING');
 const d=signal.direction==='LONG'?1:-1;
 if(d*(scenario.trigger-scenario.invalidation)<=0)
  return fail('EARLY_SCENARIO_LEVELS_INVALID');
 // Ignore candle containing the ntfy send: intraminute event ordering is unknown.
 const after=candles.filter(c=>c.time>=scenario.sentAt&&
  c.closeTime<=signal.candleCloseTime).sort((a,b)=>a.time-b.time);
 if(after.length<V110_MINUTE_POLICY.minPostAlertClosedBars)
  return fail('TOO_FEW_FULL_MINUTES_AFTER_EARLY');
 const tail=after.at(-1),prior=after.at(-2);
 if(tail.closeTime!==signal.candleCloseTime||
  prior.closeTime!==tail.time)
  return fail('FINAL_MINUTE_GAP');
 for(let i=0;i<after.length;i++){
  const c=after[i];
  if(!c||![c.time,c.closeTime,c.open,c.high,c.low,c.close].every(finite)||
   c.closeTime!==c.time+MINUTE||c.low<=0||
   c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||
   (i>0&&c.time!==after[i-1].closeTime))
   return fail('POST_ALERT_MINUTE_GAP');
  if(d===1?c.low<=scenario.invalidation:c.high>=scenario.invalidation)
   return fail('EARLY_SCENARIO_INVALIDATED');
 }
 if(d*(tail.close-scenario.trigger)<=0)
  return fail('EARLY_TRIGGER_NOT_CLOSED_BEYOND');
 // The 5m close and last 1m close must be from the same WEEX timeline.
 if(Math.abs(tail.close-signal.price)>1e-6*signal.price)
  return fail('FIVE_MINUTE_AND_MINUTE_CLOSE_DISAGREE');
 if(d*(tail.close-prior.close)<0)
  return fail('LAST_MINUTE_REVERSAL');
 if(d*(tail.close-after[0].open)<=0)
  return fail('NO_POST_ALERT_PROGRESS');
 const span=tail.high-tail.low;
 if(span<=0||(d===1?(tail.high-tail.close)/span>0.55:
  (tail.close-tail.low)/span>0.55))
  return fail('LAST_MINUTE_REJECTION_WICK');
 return {ok:true,reason:'EARLY_ACTIVE_AND_1M_CONTINUATION',
  observedBars:after.length,trigger:scenario.trigger,
  invalidation:scenario.invalidation,noOrders:true};
}
