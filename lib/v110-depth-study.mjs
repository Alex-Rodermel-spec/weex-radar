// Prospective WEEX depth shadow trial. Only ENCRYPTED-JOURNAL PUBLISHED forecasts.
// It cannot change the live scanner, alerts, order routes, GitHub or secrets.
import {validateV110Depth} from './v110-depth-capture.mjs';
export const V110_DEPTH_STUDY_POLICY=Object.freeze({
 version:'v110-depth-3plus2-shadow-v1',
 minEligible:180,minTrain:120,minHoldout:50,
 minTrainDays:3,minHoldoutDays:2,
 minCoverage:.4,minTrainSelected:60,minHoldoutSelected:25,
 minTrainHitLiftPoints:3,minHoldoutHitLiftPoints:5,
 minHoldoutMeanLiftBps:2,directionalImbalanceThresholdPct:12,
 embargoMinutes:30,perSymbolSpacingMinutes:30,
 requiresOwnerApproval:true,liveChanges:false,ordersSent:0,
 automaticLiveTuning:false,notTradingProfit:true
});
const DAY=86400000,MIN=60000;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const rnd=(v,d=2)=>Number(v.toFixed(d));
const ratio=(a,b)=>b?rnd(a/b*100,1):null;
const days=x=>new Set(x.map(r=>Math.floor(r.sentAt/DAY))).size;
function metrics(rows){
 const result={n:rows.length};
 for(const h of [5,15,30]){
  result['favorable'+h+'mPct']=rows.length?ratio(rows.filter(r=>r.move[h]>0).length,rows.length):null;
  result['mean'+h+'mBps']=rows.length?
   rnd(rows.reduce((s,r)=>s+r.move[h],0)/rows.length):null;
 }
 return result;
}
export function evaluateV110DepthStudy(archive,now=Date.now()){
 const base={mode:'V110_PROSPECTIVE_DEPTH_SHADOW',version:V110_DEPTH_STUDY_POLICY.version,
  needsNewProspectiveSnapshots:true,notTradingProfit:true,
  requiresOwnerApproval:true,liveChanges:0,ordersSent:0,
  recommendation:'KEEP_108',
  caveat:'WEEX REST snapshot is local receipt time, not an exchange timestamp. Depth size units are unconfirmed. Spoofing, fees, spread and regime changes may dominate.'};
 if(!Array.isArray(archive)||archive.length>5000||!Number.isSafeInteger(now))
  return {...base,status:'INVALID_INPUT',paired:0,eligible:0};
 const seen=new Set(),all=[];
 for(const row of archive){
  if(!row||typeof row.id!=='string'||!/^[a-f0-9]{32}$/.test(row.id)||
   !/^[A-Z0-9]{2,24}$/.test(row.symbol||'')||
   !['LONG','SHORT'].includes(row.direction)||
   !Number.isSafeInteger(row.sentAt)||row.sentAt<=0||row.sentAt>now||
   !validateV110Depth(row.depthShadow,row.sentAt)||seen.has(row.id))continue;
  seen.add(row.id);all.push(row);
 }
 const rows=[],last=new Map();
 for(const f of all.filter(r=>r.sentAt+35*MIN<now&&
  [5,15,30].every(m=>r.windows?.[m]?.status==='OBSERVED'&&
   finite(r.windows[m].moveBps)&&Math.abs(r.windows[m].moveBps)<10000))
  .sort((a,b)=>a.sentAt-b.sentAt||a.id.localeCompare(b.id))){
  if(f.sentAt-(last.get(f.symbol)??-Infinity)<
   V110_DEPTH_STUDY_POLICY.perSymbolSpacingMinutes*MIN)continue;
  last.set(f.symbol,f.sentAt);
  const d=f.depthShadow;
  rows.push({sentAt:f.sentAt,symbol:f.symbol,direction:f.direction,
   directionalPressurePct:f.direction==='LONG'?d.p:-d.p,
   move:Object.fromEntries([5,15,30].map(h=>[h,f.windows[h].moveBps]))});
 }
 const common={...base,paired:all.length,eligible:rows.length,
  firstPairedAt:all.length?Math.min(...all.map(r=>r.sentAt)):null,
  lastPairedAt:all.length?Math.max(...all.map(r=>r.sentAt)):null,
  minRequired:V110_DEPTH_STUDY_POLICY.minEligible};
 if(rows.length<V110_DEPTH_STUDY_POLICY.minEligible)
  return {...common,status:'INSUFFICIENT_PAIRED_DEPTH'};
 const split=Math.floor(rows.length*7/10),train=rows.slice(0,split);
 const holdout=rows.slice(split).filter(r=>
  r.sentAt>=train.at(-1).sentAt+V110_DEPTH_STUDY_POLICY.embargoMinutes*MIN);
 const period={...common,trainN:train.length,holdoutN:holdout.length,
  trainDays:days(train),holdoutDays:days(holdout)};
 if(train.length<V110_DEPTH_STUDY_POLICY.minTrain||
   holdout.length<V110_DEPTH_STUDY_POLICY.minHoldout||
   days(train)<V110_DEPTH_STUDY_POLICY.minTrainDays||
   days(holdout)<V110_DEPTH_STUDY_POLICY.minHoldoutDays)
  return {...period,status:'INSUFFICIENT_INDEPENDENT_DEPTH_DAYS'};
 // ONE pre-registered policy. Never tune against holdout results.
 const select=rows=>rows.filter(r=>r.directionalPressurePct>=
  V110_DEPTH_STUDY_POLICY.directionalImbalanceThresholdPct);
 const baseTrain=metrics(train),candidateTrain=metrics(select(train));
 const baseHoldout=metrics(holdout),candidateHoldout=metrics(select(holdout));
 const approvedTraining=candidateTrain.n>=V110_DEPTH_STUDY_POLICY.minTrainSelected&&
  candidateTrain.n/train.length>=V110_DEPTH_STUDY_POLICY.minCoverage&&
  candidateTrain.favorable15mPct>=baseTrain.favorable15mPct+
   V110_DEPTH_STUDY_POLICY.minTrainHitLiftPoints&&
  candidateTrain.mean15mBps>=baseTrain.mean15mBps;
 if(!approvedTraining)return {...period,status:'NO_DEPTH_TRAINING_IMPROVEMENT',
  baselineTrain:baseTrain,candidateTrain};
 const validated=candidateHoldout.n>=V110_DEPTH_STUDY_POLICY.minHoldoutSelected&&
  candidateHoldout.n/holdout.length>=V110_DEPTH_STUDY_POLICY.minCoverage&&
  candidateHoldout.favorable15mPct>=baseHoldout.favorable15mPct+
   V110_DEPTH_STUDY_POLICY.minHoldoutHitLiftPoints&&
  candidateHoldout.mean15mBps>=baseHoldout.mean15mBps+
   V110_DEPTH_STUDY_POLICY.minHoldoutMeanLiftBps&&
  candidateHoldout.favorable30mPct>=baseHoldout.favorable30mPct;
 return {...period,status:validated?'DEPTH_SHADOW_CANDIDATE_PASSED':'DEPTH_HOLDOUT_REJECTED',
  baselineTrain:baseTrain,candidateTrain,baselineHoldout:baseHoldout,
  candidateHoldout,selectedPolicy:'DIRECTIONAL_PRESSURE_GE_12',
  recommendation:validated?'OWNER_REVIEW_REQUIRED':'KEEP_108',
  // Reusing a rolling holdout is not an independent final release test.
  forwardUntouchedHoldoutRequired:true};
}
