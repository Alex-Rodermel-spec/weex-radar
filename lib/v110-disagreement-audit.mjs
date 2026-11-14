// Read-only audit of disagreements; does not infer profitability or authorize deployment.
const key=r=>[r.symbol,r.alertId,r.horizonMinutes,r.observedAt,r.outcomeKnownAt].join('|');
export function auditV110DirectionalDisagreements(adapted){
 if(adapted?.status!=='ADAPTED'||!Array.isArray(adapted.baseline)||!Array.isArray(adapted.candidate))
  return {status:'INVALID_INPUT',approvedForLive:false};
 const candidates=new Map();
 for(const r of adapted.candidate){
  if(!r.symbol||!r.alertId)continue;
  const k=key(r);
  if(!candidates.has(k))candidates.set(k,[]);
  candidates.get(k).push(r);
 }
 let matched=0,agree=0,disagree=0,baselineCorrectOnDisagreement=0,candidateCorrectOnDisagreement=0,ambiguous=0;
 for(const b of adapted.baseline){
  if(!b.symbol||!b.alertId)continue;
  const found=candidates.get(key(b))||[];
  if(found.length!==1){if(found.length>1)ambiguous++;continue;}
  const c=found[0];matched++;
  if(b.direction===c.direction){agree++;continue;}
  disagree++;
  if(b.signedMoveBps>0)baselineCorrectOnDisagreement++;
  if(c.signedMoveBps>0)candidateCorrectOnDisagreement++;
 }
 return {status:'RESEARCH_AUDIT_ONLY',matched,agree,disagree,ambiguous,
  baselineCorrectOnDisagreement,candidateCorrectOnDisagreement,approvedForLive:false};
}
