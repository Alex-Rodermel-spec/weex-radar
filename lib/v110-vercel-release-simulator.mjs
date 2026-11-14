// Dry-run Vercel release rehearsal. No network, credentials or production writes.
// The caller supplies immutable deployment metadata and an eligible plan.
export function rehearseV110Release({plan,baseline,candidate,observations}={}){
 const events=[];
 const block=reason=>({status:'BLOCKED',reason,events,productionChanged:false,canTrade:false});
 if(plan?.status!=='PLAN_ONLY'||plan.productionChanged!==false||
  plan.requiresExternalController!==true)return block('PLAN_NOT_APPROVED');
 if(!baseline||!candidate||baseline.id===candidate.id||
  baseline.id!==plan.operations?.find(x=>x.kind==='VERIFY_ROLLBACK_TARGET')?.deploymentId||
  candidate.id!==plan.operations?.find(x=>x.kind==='VERIFY_STAGED_PRODUCTION_BUILD')?.deploymentId)
  return block('DEPLOYMENT_MISMATCH');
 if(baseline.target!=='production'||baseline.state!=='READY'||
  candidate.target!=='production'||candidate.state!=='READY'||
  candidate.staged!==true||candidate.domainsAssigned!==false)
  return block('NOT_READY_STAGED_PRODUCTION');
 events.push({action:'SIMULATE_PROMOTE',deploymentId:candidate.id});
 if(!Array.isArray(observations)||observations.length===0){
  events.push({action:'SIMULATE_ROLLBACK',deploymentId:baseline.id});
  return {status:'ROLLBACK_REHEARSED',reason:'MISSING_MONITORING',events,productionChanged:false,canTrade:false};
 }
 for(const item of observations){
  if(item?.fresh!==true||item?.healthy!==true||item?.qualityNonRegressing!==true){
   events.push({action:'SIMULATE_ROLLBACK',deploymentId:baseline.id});
   return {status:'ROLLBACK_REHEARSED',reason:'CANARY_REGRESSION',events,productionChanged:false,canTrade:false};
  }
 }
 return {status:'PROMOTION_REHEARSED',events,productionChanged:false,canTrade:false};
}
