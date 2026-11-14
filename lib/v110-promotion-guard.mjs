// Pure, fail-closed autonomous forecast promotion gate. NO deployment side effects.
const protectedPrefixes=['.github/','scripts/','test/','research/','docs/','api/','app/','pages/'];
const allowed=new Set(['lib/v108-forecast-score.mjs']);
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function evaluateV110Promotion(input){
 const reject=reason=>Object.freeze({decision:'KEEP_108',reason,canDeploy:false,canTrade:false});
 if(!input||input.schema!=='v110-promotion-v1')return reject('INVALID_SCHEMA');
 if(input.ordersChanged!==false||input.secretsChanged!==false||input.permissionsChanged!==false)return reject('PROTECTED_SCOPE');
 if(!Array.isArray(input.changedPaths)||input.changedPaths.length===0||
  input.changedPaths.some(p=>typeof p!=='string'||p.includes('..')||p.startsWith('/')||
   protectedPrefixes.some(prefix=>p.startsWith(prefix))||!allowed.has(p)))return reject('PATH_NOT_ALLOWLISTED');
 if(input.frozenCandidate!==true||input.independentForwardTest!==true||
  input.ciPassed!==true||input.replayPassed!==true)return reject('VALIDATION_INCOMPLETE');
 const x=input.metrics;
 if(!x||!Number.isSafeInteger(x.n)||x.n<100||
  !finite(x.baselineAccuracyPct)||!finite(x.candidateAccuracyPct)||
  !finite(x.baselineNetBps)||!finite(x.candidateNetBps)||
  !finite(x.coverageRatio)||x.coverageRatio<0.8||
  !finite(x.latencyP95Ms)||x.latencyP95Ms>5000)return reject('INSUFFICIENT_EVIDENCE');
 if(x.candidateAccuracyPct<=x.baselineAccuracyPct||
  x.candidateNetBps<=x.baselineNetBps)return reject('NO_INDEPENDENT_IMPROVEMENT');
 // Gate authorizes only a *canary proposal*, not deployment.
 return Object.freeze({decision:'CANARY_ELIGIBLE',reason:'REQUIRES_SEPARATE_CONTROLLER_AND_ROLLBACK',canDeploy:false,canTrade:false});
}
