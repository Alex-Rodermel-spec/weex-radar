// Pure deterministic canary state machine. No API calls, deploys or trades.
export const V110_CANARY_STATES=Object.freeze(['IDLE','CANARY','PROMOTED','ROLLED_BACK']);
const fail=(reason)=>Object.freeze({state:'ROLLED_BACK',reason,trafficPct:0,canDeploy:false,canTrade:false});
export function stepV110Canary(current,event){
 const state=current?.state??'IDLE';
 if(!V110_CANARY_STATES.includes(state))return fail('INVALID_STATE');
 if(state==='ROLLED_BACK')return fail('ROLLBACK_LATCHED');
 if(!event||typeof event!=='object')return fail('MISSING_TELEMETRY');
 if(state==='IDLE'){
  if(event.type!=='START'||event.gateDecision!=='CANARY_ELIGIBLE'||
   event.monitoringReady!==true||event.rollbackReady!==true||
   event.baselinePinned!==true)return Object.freeze({state:'IDLE',reason:'NOT_READY',trafficPct:0,canDeploy:false,canTrade:false});
  return Object.freeze({state:'CANARY',reason:'SHADOW_CANARY_STARTED',trafficPct:5,canDeploy:false,canTrade:false});
 }
 if(event.type!=='OBSERVE')return fail('UNEXPECTED_EVENT');
 if(event.telemetryFresh!==true||event.errorsOk!==true||
  event.rollbackReady!==true||event.baselinePinned!==true||
  !Number.isSafeInteger(event.samples)||event.samples<50||
  typeof event.deltaAccuracyPct!=='number'||!Number.isFinite(event.deltaAccuracyPct)||
  typeof event.deltaNetBps!=='number'||!Number.isFinite(event.deltaNetBps)||
  event.deltaAccuracyPct<0||event.deltaNetBps<0)return fail('QUALITY_OR_MONITORING_FAILURE');
 if(state==='CANARY'){
  if(event.samples<200)return Object.freeze({state:'CANARY',reason:'COLLECT_MORE_EVIDENCE',trafficPct:5,canDeploy:false,canTrade:false});
  return Object.freeze({state:'PROMOTED',reason:'SIMULATED_PROMOTION_ONLY',trafficPct:100,canDeploy:false,canTrade:false});
 }
 return Object.freeze({state:'PROMOTED',reason:'SIMULATED_PROMOTION_ONLY',trafficPct:100,canDeploy:false,canTrade:false});
}
