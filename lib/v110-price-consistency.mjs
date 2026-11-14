// Same-market, same-time paired outcomes must use the same market prices.
// Pure research audit; never authorizes trading or deployment.
const key=r=>[r.symbol,r.alertId,r.horizonMinutes,r.observedAt,r.evaluatedAt||r.outcomeKnownAt].join('|');
export function auditV110PriceConsistency(adapted,{relativeTolerance=0.00001}={}){
 if(adapted?.status!=='ADAPTED'||!Array.isArray(adapted.baseline)||!Array.isArray(adapted.candidate)||
 !Number.isFinite(relativeTolerance)||relativeTolerance<0||relativeTolerance>0.001)
  return {status:'INVALID_INPUT',approvedForLive:false};
 const candidates=new Map();
 for(const r of adapted.candidate){const k=key(r);if(!candidates.has(k))candidates.set(k,[]);candidates.get(k).push(r);}
 let paired=0,consistent=0,priceConflicts=0,ambiguous=0;
 const seen=new Set();
 for(const b of adapted.baseline){
  const k=key(b),found=candidates.get(k)||[];
  if(seen.has(k)||found.length>1){ambiguous++;continue;}
  seen.add(k);
  if(found.length!==1)continue;
  const c=found[0];paired++;
  const same=(x,y)=>Number.isFinite(x)&&Number.isFinite(y)&&x>0&&y>0&&Math.abs(x-y)/Math.max(x,y)<=relativeTolerance;
  if(same(b.entryPrice,c.entryPrice)&&same(b.outcomePrice,c.outcomePrice))consistent++;
  else priceConflicts++;
 }
 return {status:'RESEARCH_AUDIT_ONLY',paired,consistent,priceConflicts,ambiguous,approvedForLive:false};
}
