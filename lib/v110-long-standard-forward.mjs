// Pre-registered V110 research: LONG STANDARD pre-move timing, no live effect.
// Fixed before collection. Independent future observations only.
export const LONG_STANDARD_FORWARD=Object.freeze({
 policyId:'LONG_STANDARD_PREMOVE_10BPS',startUTC:'2026-11-14T06:00:00Z',
 endExclusiveUTC:'2026-11-18T06:00:00Z',minDistinctDays:2,
 minEarly:35,minLate:20,minDifferencePct:8,
 noOrders:true,noLiveChanges:true,humanApprovalRequired:true
});
const start=Date.parse(LONG_STANDARD_FORWARD.startUTC);
const end=Date.parse(LONG_STANDARD_FORWARD.endExclusiveUTC);
const valid=n=>typeof n==='number'&&Number.isFinite(n);
const summary=rows=>({n:rows.length,favorable15mPct:rows.length?
 Math.round(rows.filter(r=>r.windows[15].moveBps>0).length/rows.length*1000)/10:null,
 mean15mBps:rows.length?Math.round(rows.reduce((s,r)=>s+r.windows[15].moveBps,0)/rows.length*100)/100:null});
export function evaluateLongStandardForward(rows,now=Date.now()){
 const base={mode:'V110_LONG_STANDARD_FIXED_FORWARD',policy:LONG_STANDARD_FORWARD,
  recommendation:'KEEP_108',approvedForLive:false,ordersSent:0,changesLiveSignals:false};
 if(!Array.isArray(rows)||rows.length>5000||!Number.isSafeInteger(now))
  return {...base,status:'INVALID_INPUT'};
 const unique=new Map();
 for(const r of rows){
  if(!r||!/^[a-f0-9]{32}$/.test(r.id||'')||r.direction!=='LONG'||
   r.strength!=='STANDARD'||!/^[A-Z0-9]{2,24}$/.test(r.symbol||'')||
   !Number.isSafeInteger(r.sentAt)||r.sentAt<start||r.sentAt>=end||
   r.sentAt+35*60000>=now||!valid(r.preMove5mBps)||
   r.windows?.[15]?.status!=='OBSERVED'||!valid(r.windows[15].moveBps)||
   Math.abs(r.windows[15].moveBps)>=10000)continue;
  if(!unique.has(r.id))unique.set(r.id,r);
 }
 const sample=[...unique.values()].sort((a,b)=>a.sentAt-b.sentAt);
 // Reduce same-market overlapping observations, fixed 30m spacing.
 const spaced=[],last=new Map();
 for(const r of sample){
  if(r.sentAt-(last.get(r.symbol)??-Infinity)<30*60000)continue;
  spaced.push(r);last.set(r.symbol,r.sentAt);
 }
 const early=summary(spaced.filter(r=>r.preMove5mBps<10));
 const late=summary(spaced.filter(r=>r.preMove5mBps>=10));
 const days=new Set(spaced.map(r=>Math.floor(r.sentAt/86400000))).size;
 const differencePct=early.n&&late.n?
  Math.round((early.favorable15mPct-late.favorable15mPct)*10)/10:null;
 const result={...base,early,late,distinctDays:days,differencePct,
  futureWindowComplete:now>=end+40*60000,
  disclaimer:'Future observational forecast comparison only, not executed trades or profit.'};
 if(now<end+40*60000)return {...result,status:'COLLECTING_FIXED_WINDOW'};
 if(days<LONG_STANDARD_FORWARD.minDistinctDays||
  early.n<LONG_STANDARD_FORWARD.minEarly||late.n<LONG_STANDARD_FORWARD.minLate)
  return {...result,status:'INSUFFICIENT_FUTURE_SAMPLE'};
 return {...result,status:differencePct>=LONG_STANDARD_FORWARD.minDifferencePct?
  'TIMING_EFFECT_REPLICATED_REVIEW_ONLY':'TIMING_EFFECT_NOT_REPLICATED'};
}
