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
  const candidateById=new Map(c.filter(r=>typeof r.alertId==='string').map(r=>[r.alertId,r]));
  const matched=b.filter(r=>typeof r.alertId==='string'&&candidateById.has(r.alertId))
    .map(r=>({baseline:r,candidate:candidateById.get(r.alertId)}))
    .filter(p=>p.baseline.observedAt===p.candidate.observedAt && p.baseline.outcomeKnownAt===p.candidate.outcomeKnownAt);
  const pairedDays=new Set(matched.map(p=>p.baseline.observedAt.slice(0,10))).size;
  const pairedBaseline=stats(matched.map(p=>p.baseline));
  const pairedCandidate=stats(matched.map(p=>p.candidate));
  const sufficient=matched.length>=minPaired&&pairedDays>=minDays;
  const candidateCoveragePct=pct(matched.length,c.length);
  const baselineCoveragePct=pct(matched.length,b.length);
  return {horizonMinutes,direction,baseline:stats(b),candidate:stats(c),distinctUTCdays:dates.size,
   paired:{n:matched.length,days:pairedDays,baseline:pairedBaseline,candidate:pairedCandidate,
    sufficient,candidateCoveragePct,baselineCoveragePct,deltaFavorablePct:sufficient?Math.round((pairedCandidate.favorablePct-pairedBaseline.favorablePct)*10)/10:null}};
 }));
 // Pair only independently verified identical alert IDs and timestamps. Never authorize live changes.
 const enough=groups.some(g=>g.paired.sufficient);
 return {status:enough?'MATCHED_RESEARCH_ONLY':'INSUFFICIENT_MATCHED_FORWARD_DATA',ready:enough,approvedForLive:false,
  reason:'Research statistics do not establish trading profitability or authorize production deployment',
  groups,thresholds:{minPaired,minDays}};
}
