// Preview-only automatic rollback controller. Adapter is injected; no credentials or production API in this module.
const LAB_ALIAS='v110-switch-lab-stilvoll-bullet.vercel.app';
export async function runV110PreviewRollback({alias,baselineId,candidateId,telemetry,adapter}={}){
 const result={alias,status:'BLOCKED',reason:'INVALID_INPUT',events:[],productionChanged:false,canTrade:false};
 if(alias!==LAB_ALIAS||!/^dpl_[A-Za-z0-9]{12,}$/.test(baselineId??'')||
 !/^dpl_[A-Za-z0-9]{12,}$/.test(candidateId??'')||baselineId===candidateId||
 !adapter||typeof adapter.getAliasDeploymentId!=='function'||typeof adapter.assignAlias!=='function')return result;
 const before=await adapter.getAliasDeploymentId(alias);
 if(before!==candidateId)return {...result,reason:'ALIAS_NOT_ON_CANDIDATE'};
 const ok=telemetry?.fresh===true&&telemetry?.healthy===true&&telemetry?.qualityNonRegressing===true;
 if(ok)return {...result,status:'HEALTHY',reason:'NO_ROLLBACK_NEEDED'};
 // Fail closed: on any missing/stale/bad evidence restore pinned baseline.
 const events=[{action:'ROLLBACK_REQUESTED',to:baselineId}];
 try{
  await adapter.assignAlias({alias,deploymentId:baselineId});
  const verified=await adapter.getAliasDeploymentId(alias);
  if(verified!==baselineId)return {...result,status:'RESTORE_UNVERIFIED',reason:'ALIAS_VERIFICATION_FAILED',events};
  return {...result,status:'RESTORED',reason:'TELEMETRY_UNSAFE',events:[...events,{action:'ROLLBACK_VERIFIED',to:baselineId}]};
 }catch{return {...result,status:'RESTORE_FAILED',reason:'ADAPTER_ERROR',events};}
}
