// Pure, read-only comparison. Never authorizes live promotion or order placement.
const H=[1,5,10,15,30], D=['LONG','SHORT'];
const pct=(n,total)=>total?Math.round(1000*n/total)/10:null;
function stats(rows){
 const n=rows.length, favorable=rows.filter(r=>r.signedMoveBps>0).length;
 return {n,favorable,adverse:rows.filter(r=>r.signedMoveBps<0).length,
  flat:rows.filter(r=>r.signedMoveBps===0).length,
  favorablePct:pct(favorable,n),
  meanBps:n?Math.round(rows.reduce((a,r)=>a+r.signedMoveBps,0)*100/n)/100:null};
}
export function compareV110ForwardOutcomes(adapted,{minPaired=75,minDays=2}={}){
 if(!adapted||adapted.status!=='ADAPTED'||!Array.isArray(adapted.baseline)||
 !Array.isArray(adapted.candidate)||!Number.isInteger(minPaired)||minPaired<1||
 !Number.isInteger(minDays)||minDays<1)return {status:'INVALID_INPUT',ready:false,approvedForLive:false};
 const groups=H.flatMap(horizonMinutes=>D.map(direction=>{
  const b=adapted.baseline.filter(r=>r.horizonMinutes===horizonMinutes&&r.direction===direction);
  const c=adapted.candidate.filter(r=>r.horizonMinutes===horizonMinutes&&r.direction===direction);
  const dates=new Set([...b,...c].map(r=>r.observedAt.slice(0,10)));
  return {horizonMinutes,direction,baseline:stats(b),candidate:stats(c),distinctUTCdays:dates.size};
 }));
 // No paired IDs in adapter output: comparing unrelated observations would be misleading.
 // Report descriptive distributions only, never an improvement or approval verdict.
 return {status:'DESCRIPTIVE_ONLY_UNPAIRED',ready:false,approvedForLive:false,
  reason:'Matched independent V108/V110 alerts and prospective days must be verified before lift testing',
  groups,thresholds:{minPaired,minDays}};
}
