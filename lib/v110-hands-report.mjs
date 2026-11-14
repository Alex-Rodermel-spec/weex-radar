// Pure read-only V110 owner review report. No trades, no live changes.
const H=[1,5,10,15,30];
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const round=n=>Math.round(n*100)/100;
function summarize(rows,side){
 const out={direction:side,n:rows.length,horizons:{}};
 for(const h of H){
  const observed=rows.filter(r=>finite(r.windows?.[h]?.moveBps));
  const favorable=observed.filter(r=>r.windows[h].moveBps>0).length;
  out.horizons[h]={observed:observed.length,
   favorablePct:observed.length?round(100*favorable/observed.length):null,
   meanBps:observed.length?round(observed.reduce((s,r)=>s+r.windows[h].moveBps,0)/observed.length):null};
 }
 const lat=rows.map(r=>r.firstFavorableMinute).filter(finite).sort((a,b)=>a-b);
 out.medianFirstFavorableMinute=lat.length?round(lat[Math.floor((lat.length-1)/2)]):null;
 out.lateAlerts=rows.filter(r=>r.alreadyMovedBeforeAlert===true).length;
 out.lateAlertPct=rows.length?round(out.lateAlerts*100/rows.length):null;
 return out;
}
export function buildV110HandsReviewReport(rows,policyId){
 const base={schema:'v110-hands-review-v1',policyId,
  recommendation:'KEEP_108',approvedForLive:false,requiresOwnerApproval:true};
 if(!Array.isArray(rows)||rows.length>5000||
  !['LONG_SKIP_CAUTION','LONG_SKIP_CHASE','LONG_SKIP_CAUTION_CHASE',
   'SHORT_SKIP_CAUTION','SHORT_SKIP_CHASE','SHORT_SKIP_CAUTION_CHASE'].includes(policyId))
  return {...base,status:'INVALID_INPUT'};
 const side=policyId.startsWith('LONG_')?'LONG':'SHORT';
 const eligible=rows.filter(r=>r&&['LONG','SHORT'].includes(r.direction)&&
  ['STRONG','STANDARD','CAUTION'].includes(r.strength));
 const selected=eligible.filter(r=>{
  if(r.direction!==side)return true;
  if(policyId.includes('CAUTION')&&r.strength==='CAUTION')return false;
  if(policyId.includes('CHASE')&&(!finite(r.preMove5mBps)||r.preMove5mBps>=10))return false;
  return true;
 });
 const result={...base,status:'RESEARCH_ONLY_NOT_INDEPENDENTLY_VALIDATED',
  baseline:{LONG:summarize(eligible.filter(r=>r.direction==='LONG'),'LONG'),
   SHORT:summarize(eligible.filter(r=>r.direction==='SHORT'),'SHORT')},
  candidate:{LONG:summarize(selected.filter(r=>r.direction==='LONG'),'LONG'),
   SHORT:summarize(selected.filter(r=>r.direction==='SHORT'),'SHORT')},
  evidenceNote:'Directional descriptive statistics only. Missing observations excluded per horizon. Latency fields optional and must be sourced, never inferred. No claim of independent validation, profit or deploy readiness.'};
 return result;
}
