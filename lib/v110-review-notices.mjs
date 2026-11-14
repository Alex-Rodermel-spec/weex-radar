// Shadow-study owner review notifications on the EXISTING private WEEX STATUS topic.
// Called only from the OIDC-authenticated 20-minute journal writer.
// A 3+2-day holdout is an exploratory screen, NOT a proven strategy improvement,
// permission to trade or evidence sufficient to alter live №108.
import {createHash} from 'node:crypto';
import {statusTopic} from './status-notices.mjs';
import {V110_HYPOTHESIS_IDS} from './v110-hypothesis-discovery.mjs';

const BASE='https://ntfy.sh/';
const RESEARCH_URL='https://weex-radar.vercel.app/forecast.html';
const round=(n,d=1)=>Number(n.toFixed(d));
const valid=n=>typeof n==='number'&&Number.isFinite(n);
const policyNames=new Set(['AVOID_CAUTION','AVOID_LATE',
 'AVOID_CHASE','AVOID_CAUTION_AND_CHASE']);
const stableId=(kind,policy)=>
 createHash('sha256').update('weex-v110-review-v1|'+kind+'|'+policy)
  .digest('hex').slice(0,32);

export const V110_REVIEW_NOTICE_POLICY=Object.freeze({
 version:'v110-owner-review-ntfy-status-v1',
 target:'DERIVED_PRIVATE_WEEX_STATUS',
 source:'EXISTING_OIDC_JOURNAL_WRITER',
 noNewCron:true,noPaidServices:true,noOrders:true,
 noAutomaticLiveChanges:true,
 approvalRequired:true,forwardUntouchedTestStillRequired:true,
 notProofOfProfitableTrading:true
});

// A candidate has passed existing internal screening gates, but it is ONLY
// worth starting a stronger prospective test. It is never "ready to deploy".
export function selectV110ReviewProposal(learning,depth,discovery){
 if(learning?.status==='SHADOW_CANDIDATE_PASSED'&&
  learning.recommendation==='OWNER_REVIEW_REQUIRED'&&
  learning.readyForLivePromotion===false&&
  policyNames.has(learning.chosenOnTrainingOnly)&&
  Number.isSafeInteger(learning.trainN)&&learning.trainN>=120&&
  Number.isSafeInteger(learning.holdoutN)&&learning.holdoutN>=50&&
  Number.isSafeInteger(learning.holdoutCandidate?.n)&&
  learning.holdoutCandidate.n>=25&&
  valid(learning.holdoutBaseline?.favorablePct)&&
  valid(learning.holdoutCandidate?.favorablePct)&&
  valid(learning.holdoutBaseline?.meanBps)&&
  valid(learning.holdoutCandidate?.meanBps)&&
  learning.holdoutCandidate.favorablePct>=learning.holdoutBaseline.favorablePct+5&&
  learning.holdoutCandidate.meanBps>=learning.holdoutBaseline.meanBps+2&&
  learning.holdoutCandidate.meanBps>0){
  const policy=learning.chosenOnTrainingOnly;
  return {kind:'FORECAST_SHADOW',policy,key:stableId('FORECAST_SHADOW',policy),
   trainN:learning.trainN,holdoutN:learning.holdoutN,
   candidateN:learning.holdoutCandidate.n,
   baselinePct:round(learning.holdoutBaseline.favorablePct),
   candidatePct:round(learning.holdoutCandidate.favorablePct),
   meanDiffBps:round(learning.holdoutCandidate.meanBps-
    learning.holdoutBaseline.meanBps)};
 }
 if(depth?.status==='DEPTH_SHADOW_CANDIDATE_PASSED'&&
  depth.recommendation==='OWNER_REVIEW_REQUIRED'&&
  depth.forwardUntouchedHoldoutRequired===true&&
  depth.selectedPolicy==='DIRECTIONAL_PRESSURE_GE_12'&&
  Number.isSafeInteger(depth.eligible)&&depth.eligible>=180&&
  Number.isSafeInteger(depth.holdoutN)&&depth.holdoutN>=50&&
  Number.isSafeInteger(depth.candidateHoldout?.n)&&depth.candidateHoldout.n>=25&&
  valid(depth.baselineHoldout?.favorable15mPct)&&
  valid(depth.candidateHoldout?.favorable15mPct)&&
  valid(depth.baselineHoldout?.mean15mBps)&&
  valid(depth.candidateHoldout?.mean15mBps)&&
  depth.candidateHoldout.favorable15mPct>=depth.baselineHoldout.favorable15mPct+5&&
  depth.candidateHoldout.mean15mBps>=depth.baselineHoldout.mean15mBps+2&&
  depth.candidateHoldout.mean15mBps>0){
  const policy=depth.selectedPolicy;
  return {kind:'DEPTH_SHADOW',policy,key:stableId('DEPTH_SHADOW',policy),
   trainN:depth.trainN,holdoutN:depth.holdoutN,
   candidateN:depth.candidateHoldout.n,
   baselinePct:round(depth.baselineHoldout.favorable15mPct),
   candidatePct:round(depth.candidateHoldout.favorable15mPct),
   meanDiffBps:round(depth.candidateHoldout.mean15mBps-
    depth.baselineHoldout.mean15mBps)};
 }
 if(discovery?.status==='SHADOW_HYPOTHESIS_PASSED'&&
  discovery.recommendation==='OWNER_REVIEW_FOR_FORWARD_TEST'&&
  discovery.requiresIndependentForwardTest===true&&
  V110_HYPOTHESIS_IDS.includes(discovery.selectedOnTrainingOnly)&&
  Number.isSafeInteger(discovery.eligible)&&discovery.eligible>=180&&
  Number.isSafeInteger(discovery.trainN)&&discovery.trainN>=120&&
  Number.isSafeInteger(discovery.holdoutN)&&discovery.holdoutN>=50&&
  Number.isSafeInteger(discovery.holdoutCandidate?.n)&&
  discovery.holdoutCandidate.n>=18&&
  valid(discovery.holdoutBaseline?.favorablePct)&&
  valid(discovery.holdoutCandidate?.favorablePct)&&
  valid(discovery.holdoutBaseline?.meanBps)&&
  valid(discovery.holdoutCandidate?.meanBps)&&
  discovery.holdoutCandidate.favorablePct>=
   discovery.holdoutBaseline.favorablePct+6&&
  discovery.holdoutCandidate.meanBps>=
   discovery.holdoutBaseline.meanBps+3&&
  discovery.holdoutCandidate.meanBps>0){
  const policy=discovery.selectedOnTrainingOnly;
  return {kind:'DIRECTION_HYPOTHESIS',policy,
   key:stableId('DIRECTION_HYPOTHESIS',policy),
   trainN:discovery.trainN,holdoutN:discovery.holdoutN,
   candidateN:discovery.holdoutCandidate.n,
   baselinePct:round(discovery.holdoutBaseline.favorablePct),
   candidatePct:round(discovery.holdoutCandidate.favorablePct),
   meanDiffBps:round(discovery.holdoutCandidate.meanBps-
    discovery.holdoutBaseline.meanBps)};
 }
 return null;
}

export function formatV110ReviewProposal(p){
 if(!p||!['FORECAST_SHADOW','DEPTH_SHADOW','DIRECTION_HYPOTHESIS'].includes(p.kind)||
  !policyNames.has(p.policy)&&p.kind==='FORECAST_SHADOW'||
  !V110_HYPOTHESIS_IDS.includes(p.policy)&&p.kind==='DIRECTION_HYPOTHESIS')return null;
 const label=p.kind==='FORECAST_SHADOW'?'прогнозов':
  p.kind==='DIRECTION_HYPOTHESIS'?'направлений LONG/SHORT':'ликвидности';
 return {
  title:'🧠 №110 · КАНДИДАТ · ПРОВЕРИТЬ',
  message:'🔎 Исследование '+label+': '+p.policy+'\n'+
   '📊 Историческая проверка: '+p.baselinePct+'% → '+
    p.candidatePct+'% (n='+p.candidateN+')\n'+
   'Среднее изменение: '+(p.meanDiffBps>=0?'+':'')+
    p.meanDiffBps+' bps\n'+
   '⚠️ НЕ доказанная прибыль. Нужен независимый forward-тест, '+
    'проверка расходов и ручное одобрение.\n'+
   '№108 и реальные сделки НЕ изменены.',
  priority:3,click:RESEARCH_URL,sequence_id:p.key
 };
}
export async function notifyV110Review({learning,depth,discovery,env=process.env,fetchImpl=fetch}={}){
 const p=selectV110ReviewProposal(learning,depth,discovery);
 if(!p)return {action:'no-qualified-candidate'};
 if(env.VERCEL_ENV!=='production')return {action:'disabled-preview'};
 const topic=statusTopic(env);
 if(!topic)return {action:'no-status-channel'};
 const obj=formatV110ReviewProposal(p);
 if(!obj)return {action:'invalid-candidate'};
 // Best-effort topic-history deduplication. A relay outage cannot break
 // journal writes. Stable sequence_id may also dedupe provider-side.
 const check=await fetchImpl(BASE+encodeURIComponent(topic)+
  '/json?poll=1&since=7d',{cache:'no-store',
   signal:AbortSignal.timeout(4500),
   headers:{Accept:'application/x-ndjson'}});
 if(!check.ok)throw Error('REVIEW_HISTORY_UNAVAILABLE');
 const history=await check.text();
 if(history.length>200000)throw Error('REVIEW_HISTORY_TOO_LARGE');
 for(const line of history.split(/\r?\n/)){
  if(!line.trim())continue;
  try{
   const row=JSON.parse(line);
   if(row.event==='message'&&row.topic===topic&&
    row.sequence_id===p.key)return {action:'already-notified',kind:p.kind};
  }catch{}
 }
 const sent=await fetchImpl('https://ntfy.sh',{method:'POST',
  signal:AbortSignal.timeout(5000),
  headers:{'Content-Type':'application/json','User-Agent':'WEEX-RADAR-V110-REVIEW/1.0'},
  body:JSON.stringify({...obj,topic})});
 if(!sent.ok)throw Error('REVIEW_STATUS_SEND_FAILED');
 return {action:'sent',kind:p.kind,policy:p.policy};
}
