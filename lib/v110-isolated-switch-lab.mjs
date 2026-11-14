// Pure, isolated preview switch lab. No network, aliases, production, or orders.
export function runV110SwitchLab({baseline,candidate,checks}={}){
 const events=[];
 const blocked=reason=>({status:'BLOCKED',reason,events,productionChanged:false,canTrade:false});
 if(!baseline||!candidate||baseline.id===candidate.id||
  baseline.environment!=='preview'||candidate.environment!=='preview'||
  baseline.ready!==true||candidate.ready!==true||
  baseline.project!=='weex-radar'||candidate.project!=='weex-radar')
  return blocked('PREVIEW_PAIR_INVALID');
 if(!Array.isArray(checks)||checks.length===0)return blocked('MONITORING_NOT_CONFIGURED');
 events.push({action:'SIMULATE_SWITCH',from:baseline.id,to:candidate.id});
 for(const check of checks){
  if(check?.fresh!==true||check?.healthy!==true||check?.qualityNonRegressing!==true){
   events.push({action:'SIMULATE_RESTORE',to:baseline.id});
   return {status:'RESTORE_REHEARSED',reason:'MONITORING_FAILURE',events,productionChanged:false,canTrade:false};
  }
 }
 events.push({action:'SIMULATE_HOLD',deploymentId:candidate.id});
 return {status:'SWITCH_REHEARSED',events,productionChanged:false,canTrade:false};
}
