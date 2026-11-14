// V110 pre-registered independent FORWARD monitoring. Read-only aggregate.
// Policy selected BEFORE the future window; no dynamic winner or thresholds.
// Never imports into live signals / forecast dispatch / order execution.
export const V110_FORWARD_POLICY=Object.freeze({
 version:'v110-long-caution-chase-forward-v1',
 policyId:'LONG_SKIP_CAUTION_CHASE',
 startUTC:'2026-11-15T00:00:00Z',
 endExclusiveUTC:'2026-11-19T00:00:00Z',
 minDistinctUTCdays:2, perSymbolSpacingMinutes:30,
 minBaselineN:75,minCandidateN:35,minCoverage:0.45,
 minLiftPct:6,minMeanLiftBps:3,
 modeledFeeBpsEachSide:8,modeledSlippageBpsEachSide:3,
 modeledStressExtraSlippageBpsEachSide:5,
 requireModeledCostStressPositive:true,
 require30mNotWorse:true,
 feeAndExecutionStillUnverified:true,
 noNewMarketRequests:true,noLiveChanges:true,noOrders:true,
 humanApprovalRequired:true
});
const MIN=60000,DAY=86400000;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const round=(n,d=2)=>Number(n.toFixed(d));
const START=Date.parse(V110_FORWARD_POLICY.startUTC),
 END=Date.parse(V110_FORWARD_POLICY.endExclusiveUTC);
const summary=rows=>({
 n:rows.length,
 favorable15mPct:rows.length?round(rows.filter(r=>r.m15>0).length/rows.length*100,1):null,
 mean15mBps:rows.length?round(rows.reduce((s,r)=>s+r.m15,0)/rows.length):null,
 favorable30mPct:rows.length?round(rows.filter(r=>r.m30>0).length/rows.length*100,1):null
});
// Exactly the existing hypothesis lab's published/matured + same-symbol
// 30 minute spacing rules. Do not select/retrain on forward outcomes.
function forwardCohort(records,now){
 const unique=new Map();
 for(const r of records){
  if(!r||!/^[a-f0-9]{32}$/.test(r.id||'')||
   !/^[A-Z0-9]{2,24}$/.test(r.symbol||'')||
   !['LONG','SHORT'].includes(r.direction)||
   !['STRONG','STANDARD','CAUTION'].includes(r.strength)||
   !Number.isSafeInteger(r.sentAt)||r.sentAt<START||r.sentAt>=END||
   r.sentAt+35*MIN>=now||
   ![15,30].every(h=>r.windows?.[h]?.status==='OBSERVED'&&
     finite(r.windows[h].moveBps)&&Math.abs(r.windows[h].moveBps)<10000))continue;
  const value={id:r.id,symbol:r.symbol,sentAt:r.sentAt,
   direction:r.direction,strength:r.strength,
   preMove5mBps:finite(r.preMove5mBps)?r.preMove5mBps:null,
   m15:r.windows[15].moveBps,m30:r.windows[30].moveBps};
  if(!unique.has(r.id)||value.sentAt<unique.get(r.id).sentAt)
   unique.set(r.id,value);
 }
 const spaced=[],last=new Map();
 for(const r of [...unique.values()].sort((a,b)=>a.sentAt-b.sentAt||
   a.id.localeCompare(b.id))){
  if(r.sentAt-(last.get(r.symbol)??-Infinity)<
    V110_FORWARD_POLICY.perSymbolSpacingMinutes*MIN)continue;
  spaced.push(r);last.set(r.symbol,r.sentAt);
 }
 return spaced.filter(r=>r.direction==='LONG');
}
export function evaluateV110FixedForwardStudy(records,now=Date.now()){
 const base={mode:'V110_FIXED_PROSPECTIVE_RESEARCH',
  policy:V110_FORWARD_POLICY,
  recommendation:'KEEP_108',approvedForLive:false,
  noLiveChanges:true,ordersSent:0,
  disclaimer:'A fixed prospective directional forecast comparison, not proof of executable trading profit. Requires independent validation of fills, fees, latency and human review.'};
 if(!Array.isArray(records)||records.length>5000||!Number.isSafeInteger(now))
  return {...base,status:'INVALID_INPUT'};
 if(now<START)return {...base,status:'NOT_STARTED',baseline:summary([]),
  candidate:summary([])};
 const original=forwardCohort(records,now);
 const selected=original.filter(r=>r.strength!=='CAUTION'&&
  finite(r.preMove5mBps)&&r.preMove5mBps<10);
 const baseline=summary(original),candidate=summary(selected);
 const days=new Set(original.map(r=>Math.floor(r.sentAt/DAY))).size;
 const coveragePct=original.length?round(selected.length/original.length*100,1):null;
 const liftPct=selected.length&&original.length?
  round(candidate.favorable15mPct-baseline.favorable15mPct,1):null;
 const meanLiftBps=selected.length&&original.length?
  round(candidate.mean15mBps-baseline.mean15mBps):null;
 const modeledRoundTripBps=2*(V110_FORWARD_POLICY.modeledFeeBpsEachSide+
  V110_FORWARD_POLICY.modeledSlippageBpsEachSide);
 const modeledStressRoundTripBps=modeledRoundTripBps+
  2*V110_FORWARD_POLICY.modeledStressExtraSlippageBpsEachSide;
 const costs={modelOnly:true,notActualWEEXFills:true,
  modeledRoundTripBps,modeledStressRoundTripBps,
  candidateNormalNetBpsProxy:candidate.mean15mBps===null?null:
   round(candidate.mean15mBps-modeledRoundTripBps),
  candidateStressNetBpsProxy:candidate.mean15mBps===null?null:
   round(candidate.mean15mBps-modeledStressRoundTripBps)};
 const diagnostics={...base,baseline,candidate,days,coveragePct,
  favorableLiftPct:liftPct,meanLiftBps,modeledCosts:costs,
  futureWindowComplete:now>=END+40*MIN};
 // Strictly no interim winner announcement or stopping at a favorable peek.
 if(now<END+40*MIN)
  return {...diagnostics,status:'COLLECTING_FIXED_WINDOW'};
 if(days<V110_FORWARD_POLICY.minDistinctUTCdays||
  baseline.n<V110_FORWARD_POLICY.minBaselineN||
  candidate.n<V110_FORWARD_POLICY.minCandidateN||
  candidate.n/baseline.n<V110_FORWARD_POLICY.minCoverage)
  return {...diagnostics,status:'INSUFFICIENT_FUTURE_SAMPLE'};
 const directionalPass=liftPct>=V110_FORWARD_POLICY.minLiftPct&&
  meanLiftBps>=V110_FORWARD_POLICY.minMeanLiftBps&&
  candidate.mean15mBps>0&&
  candidate.favorable30mPct>=baseline.favorable30mPct;
 if(!directionalPass)return {...diagnostics,status:'FORWARD_SCREEN_REJECTED'};
 const costProxyPass=costs.candidateNormalNetBpsProxy>0&&
   costs.candidateStressNetBpsProxy>0;
 return {...diagnostics,
  status:costProxyPass?'FORWARD_PRICE_AND_COST_PROXY_PASSED':
   'FORWARD_COST_PROXY_REJECTED',
  recommendation:costProxyPass?
   'OWNER_REVIEW_EXECUTION_EVIDENCE_STILL_REQUIRED':'KEEP_108'};
}
