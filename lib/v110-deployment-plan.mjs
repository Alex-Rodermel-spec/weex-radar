// Offline deployment plan builder. Never invokes Vercel or GitHub.
const validId=s=>typeof s==='string'&&/^dpl_[A-Za-z0-9]{12,}$/.test(s);
export function buildV110DeploymentPlan({gate,canary,project,baselineDeploymentId,candidateDeploymentId}={}){
 const deny=reason=>Object.freeze({status:'BLOCKED',reason,operations:[],requiresExternalController:true});
 if(project!=='weex-radar')return deny('PROJECT_MISMATCH');
 if(!validId(baselineDeploymentId)||!validId(candidateDeploymentId)||
  baselineDeploymentId===candidateDeploymentId)return deny('DEPLOYMENT_IDS_INVALID');
 if(gate?.decision!=='CANARY_ELIGIBLE'||gate.canDeploy!==false||
  canary?.state!=='PROMOTED'||canary.canDeploy!==false)return deny('NOT_ELIGIBLE');
 // Plan only: production activation is impossible from this module.
 return Object.freeze({
  status:'PLAN_ONLY',requiresExternalController:true,productionChanged:false,
  operations:[
   {kind:'VERIFY_STAGED_PRODUCTION_BUILD',deploymentId:candidateDeploymentId},
   {kind:'VERIFY_ROLLBACK_TARGET',deploymentId:baselineDeploymentId},
   {kind:'REQUIRE_MONITORING_AND_PROTECTED_DEPLOYMENT_GATE'},
   {kind:'STAGE_FOR_EXTERNAL_REVIEW'}
  ]
 });
}
