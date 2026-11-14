// Read-only adapter: independently resolved directional outcomes from a private journal.
// Does not fetch secrets, market prices, or live signals. Never treats unresolved outcomes as correct.
const H=[1,5,10,15,30];
export function adaptV110ForecastJournal(records,{now=Date.now()}={}){
 if(!Array.isArray(records)||records.length>10000||!Number.isFinite(now))return {status:'INVALID_INPUT',baseline:[],candidate:[]};
 const baseline=[],candidate=[],seen=new Set();let skipped=0;
 for(const r of records){
  if(!r||!['V108','V110'].includes(r.model)||!['LONG','SHORT'].includes(r.direction)||
   !H.includes(r.horizonMinutes)||typeof r.alertId!=='string'||!r.alertId||
   !Number.isFinite(r.entryPrice)||r.entryPrice<=0||!Number.isFinite(r.outcomePrice)||r.outcomePrice<=0||
   r.source!=='independent-forward'||typeof r.observedAt!=='string'||typeof r.outcomeKnownAt!=='string'||
   !Number.isFinite(Date.parse(r.observedAt))||!Number.isFinite(Date.parse(r.outcomeKnownAt))||
   Date.parse(r.observedAt)>now||Date.parse(r.outcomeKnownAt)>now||
   Date.parse(r.outcomeKnownAt)<Date.parse(r.observedAt)){skipped++;continue;}
  const key=[r.model,r.alertId,r.horizonMinutes].join(':');if(seen.has(key)){skipped++;continue;}seen.add(key);
  const signedMoveBps=(r.outcomePrice/r.entryPrice-1)*10000*(r.direction==='LONG'?1:-1);
  const out={alertId:r.alertId,symbol:typeof r.symbol==='string'?r.symbol:null,direction:r.direction,horizonMinutes:r.horizonMinutes,signedMoveBps,
   observedAt:r.observedAt,evaluatedAt:typeof r.evaluatedAt==='string'?r.evaluatedAt:null,outcomeKnownAt:r.outcomeKnownAt,source:'independent-forward'};
  (r.model==='V108'?baseline:candidate).push(out);
 }
 return {status:'ADAPTED',baseline,candidate,skipped,readyForMonitoring:baseline.length>0&&candidate.length>0};
}
