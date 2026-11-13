// Research-only: does an early PRE_BREAK actually touch its stated trigger
// BEFORE the invalidation barrier? No model/order/notification changes.
// Uses completed one-minute WEEX OHLC strictly AFTER the hypothetical notice.
// Intrabar ordering is UNKNOWN when both thresholds touch in the same candle.
const MIN=60_000;
const valid=n=>typeof n==='number'&&Number.isFinite(n);
export const EARLY_OUTCOME_POLICY=Object.freeze({
 version:'2026-11-12-trigger-vs-invalidation-replay-v1',
 horizonMinutes:15,requiresFutureClosedOneMinuteBars:true,
 sameMinuteDoubleTouch:'AMBIGUOUS',
 realNtfyDeliveryNotReconstructed:true,
 liveFiltersChanged:false,ordersSent:0
});
export function outcomeOfEarlyScenario(scenario,one,asOf){
 const unavailable=reason=>({status:'UNKNOWN',reason,triggerMinute:null,
  cancellationMinute:null,postTrigger5mBps:null});
 if(!scenario||!['LONG','SHORT'].includes(scenario.direction)||
  !Number.isSafeInteger(asOf)||asOf%MIN!==0||
  !valid(scenario.trigger)||!valid(scenario.invalidation)||
  scenario.trigger<=0||scenario.invalidation<=0||
  !(scenario.direction==='LONG'?
    scenario.trigger>scenario.invalidation:
    scenario.trigger<scenario.invalidation))return unavailable('INVALID_SCENARIO');
 if(!Array.isArray(one)||one.length<15)return unavailable('MISSING_FUTURE_MINUTES');
 const future=one.filter(c=>c?.time>=asOf&&
  c.closeTime<=asOf+15*MIN).sort((a,b)=>a.time-b.time);
 if(future.length!==15)return unavailable('INCOMPLETE_FUTURE_MINUTES');
 for(let i=0;i<future.length;i++){
  const c=future[i];
  if(![c.time,c.closeTime,c.open,c.high,c.low,c.close].every(valid)||
   c.time!==asOf+i*MIN||c.closeTime!==c.time+MIN||
   c.low<=0||c.high<Math.max(c.open,c.close,c.low)||
   c.low>Math.min(c.open,c.close))
   return unavailable('INVALID_FUTURE_MINUTES');
 }
 const d=scenario.direction==='LONG'?1:-1;
 let triggerMinute=null,cancellationMinute=null,status='NEITHER';
 for(let i=0;i<15;i++){
  const c=future[i];
  const trigger=d===1?c.high>=scenario.trigger:c.low<=scenario.trigger;
  const invalid=d===1?c.low<=scenario.invalidation:c.high>=scenario.invalidation;
  if(trigger&&invalid){status='AMBIGUOUS';triggerMinute=i+1;
   cancellationMinute=i+1;break;}
  if(trigger){status='TRIGGER_FIRST';triggerMinute=i+1;break;}
  if(invalid){status='CANCEL_FIRST';cancellationMinute=i+1;break;}
 }
 let postTrigger5mBps=null;
 if(status==='TRIGGER_FIRST'&&triggerMinute+5<=15){
  const fifthClose=future[triggerMinute+4]?.close;
  if(valid(fifthClose))postTrigger5mBps=Number(
   (10000*d*(fifthClose-scenario.trigger)/scenario.trigger).toFixed(2));
 }
 return {status,reason:null,triggerMinute,cancellationMinute,
  postTrigger5mBps,source:'CLOSED_1M_WEEX_OHLC_REPLAY',
  notAnExecution:true};
}
export function summarizeEarlyOutcomes(rows){
 const list=Array.isArray(rows)?rows:[];
 const statuses=['TRIGGER_FIRST','CANCEL_FIRST','AMBIGUOUS','NEITHER','UNKNOWN'];
 const summary={total:list.length,statuses:Object.fromEntries(statuses.map(s=>[s,0])),
  postTrigger5m:{observed:0,favorable:0,adverse:0,flat:0,meanBps:null},
  firstTriggerMinutes:{observed:0,average:null}};
 const times=[],bps=[];
 for(const r of list){
  summary.statuses[statuses.includes(r?.status)?r.status:'UNKNOWN']++;
  if(r?.status==='TRIGGER_FIRST'&&Number.isInteger(r.triggerMinute)){
   times.push(r.triggerMinute);
  }
  if(valid(r?.postTrigger5mBps))bps.push(r.postTrigger5mBps);
 }
 summary.firstTriggerMinutes.observed=times.length;
 if(times.length)summary.firstTriggerMinutes.average=
  Number((times.reduce((a,b)=>a+b,0)/times.length).toFixed(2));
 summary.postTrigger5m.observed=bps.length;
 summary.postTrigger5m.favorable=bps.filter(x=>x>0).length;
 summary.postTrigger5m.adverse=bps.filter(x=>x<0).length;
 summary.postTrigger5m.flat=bps.filter(x=>x===0).length;
 if(bps.length)summary.postTrigger5m.meanBps=
  Number((bps.reduce((a,b)=>a+b,0)/bps.length).toFixed(2));
 return summary;
}
