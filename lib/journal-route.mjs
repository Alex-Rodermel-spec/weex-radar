// Routes through GET /api/signals?mode=journal / journal-export.
// Hobby serverless function quota stays unchanged.
// Only authenticated GitHub workflow may receive encrypted archive data.
import {jwtVerify,createRemoteJWKSet} from 'jose';
import {evaluateV110Learning} from './v110-self-learning.mjs';
import {evaluateV110MLShadow} from './v110-ml-shadow.mjs';
import {evaluateV110FiveMinuteForecast} from './v110-forecast-5m-learning.mjs';
import {evaluateV110V5Forward} from './v110-v5-forward-audit.mjs';
import {mergeV5Independent,summarizeV5Independent} from './v110-v5-independent-journal.mjs';
import {evaluateV110TwoFiveMinuteContinuation} from './v110-two-5m-continuation.mjs';
import {evaluateV110All32MarketAudit} from './v110-all32-market-audit.mjs';
import {evaluateV110DepthStudy} from './v110-depth-study.mjs';
import {evaluateV110Hypotheses} from './v110-hypothesis-discovery.mjs';
import {evaluateV110FixedForwardStudy} from './v110-forward-study.mjs';
import {evaluateV110DirectionDiagnostics} from './v110-direction-diagnostics.mjs';
import {evaluateV110ForecastEvidence} from './v110-forecast-evidence-audit.mjs';
import {evaluateV110ForecastCostHurdle} from './v110-forecast-cost-hurdle.mjs';
import {evaluateV110GlobalSessions} from './v110-global-sessions-shadow.mjs';
import {evaluateV110MultiHorizonChase} from './v110-multihorizon-chase-study.mjs';
import {evaluateLongStandardForward} from './v110-long-standard-forward.mjs';
import {notifyV110Review} from './v110-review-notices.mjs';
import {
 mergeJournal,encryptJournal,decryptJournalArchive,summarizeJournal
} from './journal-core.mjs';
import {mergeEarlyArchive} from './early-journal.mjs';
import {recentEarlyResearch} from './early-study-route.mjs';
import {mergeForecastArchive,recentForecastResearch,recoverArchivedForecasts} from './forecast-journal.mjs';
import {mergeConfirmedDirectionArchive,recentConfirmedDirectionResearch} from './confirmed-direction-journal.mjs';
import {collectV110FollowerJournal,mergeV110FollowerJournal,summarizeV110FollowerJournal} from './v110-follower-journal.mjs';
import {collectV110EarlyControl,mergeV110EarlyControl,summarizeV110EarlyControl} from './v110-early-control-journal.mjs';

const REPO='Alex-Rodermel-spec/weex-radar';
const WORKFLOW=REPO+'/.github/workflows/signal-journal.yml@refs/heads/main';
const ARCHIVE='https://raw.githubusercontent.com/'+REPO+
 '/journal-data/data/journal.enc.json';
const QUALITY='https://weex-radar.vercel.app/api/signals?mode=quality';
const JWKS=createRemoteJWKSet(new URL(
 'https://token.actions.githubusercontent.com/.well-known/jwks'
));
const JSON_LIMIT=2_200_000;
const headers=res=>{
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
};

async function authorizeJournal(req){
 const auth=req.headers?.authorization||'';
 if(!auth.startsWith('Bearer '))return false;
 try{
  const {payload}=await jwtVerify(auth.slice(7),JWKS,{
   issuer:'https://token.actions.githubusercontent.com',
   audience:'weex-radar-journal'
  });
  return payload.repository===REPO&&
   payload.ref==='refs/heads/main'&&
   payload.workflow_ref===WORKFLOW&&
   ['schedule','workflow_dispatch','push'].includes(payload.event_name);
 }catch{return false}
}

export async function readJournal(now=Date.now(),fetchImpl=fetch){
 // GitHub's raw CDN can cache a 404 from before the first write. Bust that
 // negative cache on each report instead of pretending the archive is empty.
 const url=ARCHIVE+'?v='+now;
 const response=await fetchImpl(url,{
  signal:AbortSignal.timeout(6500),cache:'no-store',
  headers:{Accept:'application/json'}
 });
 if(response.status===404)return {exists:false,rows:[],earlyRows:[],forecastRows:[],confirmedAuditRows:[],leadLagRows:[],earlyControlRows:[],v5IndependentRows:[]};
 if(!response.ok)throw Error('JOURNAL_ARCHIVE_UNAVAILABLE');
 const size=Number(response.headers?.get?.('content-length')||0);
 if(size>JSON_LIMIT)throw Error('JOURNAL_ARCHIVE_TOO_LARGE');
 const raw=await response.text();
 if(raw.length>JSON_LIMIT)throw Error('JOURNAL_ARCHIVE_TOO_LARGE');
 const envelope=JSON.parse(raw);
 return {exists:true,...decryptJournalArchive(envelope)};
}
async function recentQuality(fetchImpl=fetch){
 const r=await fetchImpl(QUALITY,{
  signal:AbortSignal.timeout(19000),cache:'no-store',
  headers:{Accept:'application/json'}
 });
 if(!r.ok)throw Error('JOURNAL_QUALITY_UNAVAILABLE');
 const result=await r.json();
 if(!Array.isArray(result.signals)||result.source!=='sent ntfy confirmed alerts (WEEX only)'||
   result.signals.length>200)throw Error('JOURNAL_QUALITY_INVALID');
 return result.signals;
}

export async function handleJournal(req,res,mode){
 headers(res);
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 if(mode==='journal-export'){
  if(!await authorizeJournal(req))return res.status(401).json({
   error:'Unauthorized journal writer'
  });
 }
 const now=Date.now();
 try{
  const {exists,rows,earlyRows,forecastRows,confirmedAuditRows,leadLagRows,earlyControlRows,v5IndependentRows}=await readJournal(now);
  if(mode==='journal'){
   return res.status(200).json({
    state:exists?'READY':'EMPTY',persistent:exists,
    encryptedAtRest:true,repositoryContentsArePublic:true,
    ...summarizeJournal(rows,now,earlyRows,forecastRows,confirmedAuditRows),
    // Aggregate SHADOW result from existing decrypted rows; no rows leak.
    learningShadow:evaluateV110Learning(forecastRows,now),
    // Trained on original encrypted journal rows, results only in aggregate.
    mlShadow:evaluateV110MLShadow(forecastRows,now),
    // V110 5m-horizon validation of published LONG vs SHORT forecasts.
    forecast5mLearning:evaluateV110FiveMinuteForecast(forecastRows,now),
    // Compare ONLY V5 decisions captured in actual original ntfy publication.
    forecastV5Forward:evaluateV110V5Forward(forecastRows,now),
    // Independent rotating 16-crypto cohort: includes V5-only unsent candidates.
    forecastV5Independent:summarizeV5Independent(v5IndependentRows,now),
    // First two fully subsequent CLOSED 5m periods after each published forecast.
    twoClosed5mShadow:evaluateV110TwoFiveMinuteContinuation(forecastRows,now),
    // Across ALL 32 instruments, including markets with no published alerts.
    all32MarketAudit:evaluateV110All32MarketAudit(forecastRows,confirmedAuditRows,now),
    depthShadowStudy:evaluateV110DepthStudy(forecastRows,now),
    hypothesisDiscovery:evaluateV110Hypotheses(forecastRows,now),
    forwardStudy:evaluateV110FixedForwardStudy(forecastRows,now),
    directionDiagnostics:evaluateV110DirectionDiagnostics(forecastRows,now),
    forecastEvidenceAudit:evaluateV110ForecastEvidence(forecastRows,now),
    // Price hurdle only: not actual fills, realized P&L or automated trades.
    forecastCostHurdle:evaluateV110ForecastCostHurdle(forecastRows,now),
    globalSessionsShadow:evaluateV110GlobalSessions(forecastRows,now),
    multiHorizonChaseAudit:evaluateV110MultiHorizonChase(forecastRows,now),
    leadLagForwardStudy:summarizeV110FollowerJournal(leadLagRows,now),
    earlyControlForwardStudy:summarizeV110EarlyControl(earlyControlRows,now),
    longStandardForward:evaluateLongStandardForward(forecastRows,now)
   });
  }
  if(mode!=='journal-export')return res.status(400).json({error:'Bad mode'});
  // Reuse the EXISTING OIDC-authorized 20-minute GitHub writer. No new job,
  // secrets, trading calls or storage service. The early collector is read-only.
  // A temporary ntfy or WEEX failure must not erase existing early history.
  const [current,research,forecasts,recovery,followerScan,earlyControlScan]=await Promise.all([
   recentQuality(),recentEarlyResearch(now).catch(()=>null),
   recentForecastResearch(now).catch(e=>{
    // Safe diagnostics only: never log a private ntfy topic or archive data.
    const m=String(e?.message||e).replace(/wr-[a-f0-9]{32}/g,'[private-topic]');
    console.warn('WEEX_RADAR_JOURNAL_FORECAST_READ_FAILED '+m.slice(0,75));
    return null;
   }),
   // Repair missing historical candle results without modifying the original
   // alert or exposing decrypted forecast details to the GitHub writer.
   recoverArchivedForecasts(forecastRows,now).catch(()=>null),
   // Separate 16-crypto public 1m read only on the EXISTING encrypted
   // 20-minute OIDC writer. Missing data never interrupts journal persistence.
   collectV110FollowerJournal(now).catch(()=>null),
   // Four rotating crypto markets per existing 20m OIDC run; at most
   // eight additional public WEEX candle reads, no new scanning cron.
   collectV110EarlyControl(now).catch(()=>null)
  ]);
  const confirmedStudy=await recentConfirmedDirectionResearch(current,now).catch(()=>null);
  const merged=mergeJournal(rows,current,now);
  const earlyMerged=mergeEarlyArchive(earlyRows,research?.study?.rows??[],now);
  const freshForecastMerged=mergeForecastArchive(forecastRows,forecasts?.rows??[],now);
  const recoveredForecastMerged=mergeForecastArchive(freshForecastMerged.rows,recovery?.rows??[],now);
  const forecastMerged={
   ...recoveredForecastMerged,
   changed:freshForecastMerged.changed||recoveredForecastMerged.changed,
   added:freshForecastMerged.added+recoveredForecastMerged.added,
   updated:freshForecastMerged.updated+recoveredForecastMerged.updated,
   dropped:freshForecastMerged.dropped+recoveredForecastMerged.dropped
  };
  const confirmedMerged=mergeConfirmedDirectionArchive(confirmedAuditRows,confirmedStudy?.rows??[],now);
  const leadLagMerged=mergeV110FollowerJournal(leadLagRows,
   followerScan?.fresh??[],followerScan?.candles??null,now);
  const earlyControlMerged=mergeV110EarlyControl(earlyControlRows,
   earlyControlScan?.fresh??[],followerScan?.candles??null,now);
  const v5IndependentMerged=mergeV5Independent(v5IndependentRows,
   earlyControlScan?.v5Fresh??[],followerScan?.candles??null,now);
  // Existing OIDC-authorized journal worker evaluates again as new alerts
  // arrive, without changing the encrypted archive, alerts, or trading.
  const shadow=evaluateV110Learning(forecastMerged.rows,now);
  const ml=evaluateV110MLShadow(forecastMerged.rows,now);
  const two5m=evaluateV110TwoFiveMinuteContinuation(forecastMerged.rows,now);
  const depthStudy=evaluateV110DepthStudy(forecastMerged.rows,now);
  const ideas=evaluateV110Hypotheses(forecastMerged.rows,now);
  // The EXISTING OIDC-authenticated writer opportunistically alerts only
  // on statistically screened research candidates. A failed relay must
  // NEVER hold up encrypted journal persistence or alter №108.
  try{
   // Only newly crossing a study review gate can generate a notice. A
   // previous already-qualified archive must not ping every 20m even if
   // ntfy retention expires, while fresh candidates still need review.
   const previousShadow=evaluateV110Learning(forecastRows,now);
   const previousDepth=evaluateV110DepthStudy(forecastRows,now);
   const previousIdeas=evaluateV110Hypotheses(forecastRows,now);
   const newlyQualifiedLearning=previousShadow.recommendation!=='OWNER_REVIEW_REQUIRED'?
    shadow:null;
   const newlyQualifiedDepth=previousDepth.recommendation!=='OWNER_REVIEW_REQUIRED'?
    depthStudy:null;
   const newlyQualifiedIdeas=previousIdeas.recommendation!=='OWNER_REVIEW_FOR_FORWARD_TEST'?
    ideas:null;
   const review=await notifyV110Review({
    learning:newlyQualifiedLearning,depth:newlyQualifiedDepth,
    discovery:newlyQualifiedIdeas
   });
   if(review.action==='sent')console.info('WEEX_RADAR_V110_REVIEW_SENT '+
    JSON.stringify({kind:review.kind,policy:review.policy,ordersSent:0}));
  }catch(e){
   console.warn('WEEX_RADAR_V110_REVIEW_UNAVAILABLE '+
    String(e?.message||e).slice(0,60));
  }
  console.info('WEEX_RADAR_V110_DEPTH_SHADOW '+JSON.stringify({
   status:depthStudy.status,paired:depthStudy.paired,
   eligible:depthStudy.eligible,recommendation:depthStudy.recommendation,
   liveChanges:0,ordersSent:0
  }));
  console.info('WEEX_RADAR_V110_HYPOTHESIS_SHADOW '+JSON.stringify({
   status:ideas.status,eligible:ideas.eligible,
   selectedOnTrainingOnly:ideas.selectedOnTrainingOnly??null,
   recommendation:ideas.recommendation,liveChanges:0,ordersSent:0
  }));
  console.info('WEEX_RADAR_V110_TWO_CLOSED_5M '+JSON.stringify({
   status:two5m.status,matured:two5m.matured,
   bothConfirmed:two5m.complete?.bothAndNetPositiveFromNotice??0,
   liveChanges:0,ordersSent:0
  }));
  console.info('WEEX_RADAR_V110_ML_SHADOW '+JSON.stringify({
   status:ml.status,eligible:ml.eligible,
   trainN:ml.trainN??null,holdoutN:ml.holdoutN??null,
   trained:ml.modelTrained,ordersSent:0,paidApiCalls:0,liveChanges:0
  }));
  console.info('WEEX_RADAR_V110_RESEARCH_ONLY '+JSON.stringify({
   status:shadow.status,eligible:shadow.eligible,
   recommendation:shadow.recommendation,trainN:shadow.trainN??null,
   holdoutN:shadow.holdoutN??null,liveChanges:0,ordersSent:0
  }));
  // Prospective follower study is independent and never changes #108.
  // No individual frozen prices/coins are logged to protect study archive.
  const followerSummary=summarizeV110FollowerJournal(leadLagMerged.rows,now);
  console.info('WEEX_RADAR_V110_FOLLOWER_JOURNAL '+JSON.stringify({
   status:followerScan?.status??'COLLECTION_UNAVAILABLE',
   validCrypto:followerScan?.validMarkets??0,
   frozen:followerScan?.frozen??0,
   added:leadLagMerged.added,updated:leadLagMerged.updated,
   archived:followerSummary.archivedCandidates??0,
   observed5mLong:followerSummary.byDirection?.LONG?.horizons?.[5]?.observed??0,
   observed5mShort:followerSummary.byDirection?.SHORT?.horizons?.[5]?.observed??0,
   ordersSent:0,live108Changes:0
  }));
  console.info('WEEX_RADAR_V110_V5_INDEPENDENT '+JSON.stringify({
   scanned:earlyControlScan?.valid??0,
   frozen:earlyControlScan?.v5Fresh?.length??0,
   archived:v5IndependentMerged.rows.length,
   added:v5IndependentMerged.added,updated:v5IndependentMerged.updated,
   v5At5m:summarizeV5Independent(v5IndependentMerged.rows,now).v5FiveMinute?.observed??0,
   ordersSent:0,liveForecastChanged:false
  }));
  // Only aggregate quality/counts leave the protected journal. The frozen
  // coin, direction, and reference price remain AES-GCM encrypted.
  console.info('WEEX_RADAR_V110_EARLY_CONTROL '+JSON.stringify({
   status:earlyControlScan?.status??'SCAN_UNAVAILABLE',
   sampled:earlyControlScan?.sampled??0,
   valid:earlyControlScan?.valid??0,
   added:earlyControlMerged.added,updated:earlyControlMerged.updated,
   archived:earlyControlMerged.rows.length,
   observed15m:summarizeV110EarlyControl(earlyControlMerged.rows,now)
    .full?.all?.horizons?.[15]?.observed??0,
   liveChanges:0,ordersSent:0
  }));
  // Aggregate diagnostic only; shows whether forecast ntfy observations were ingested.
  console.info('WEEX_RADAR_JOURNAL_INGEST '+JSON.stringify({
   forecastSeen:forecasts?.seen??null,forecastEvaluated:forecasts?.rows?.length??null,
   historyAttempted:recovery?.attempted??null,historyFailed:recovery?.failed??null,
   historyRecovered:recovery?.rows?.length??null,
   forecastFailedMarkets:forecasts?.missingMarkets??null,
   forecastAdded:forecastMerged.added,forecastUpdated:forecastMerged.updated,
   forecastStored:forecastMerged.rows.length,confirmedStored:merged.rows.length
  }));
  if(!merged.changed&&!earlyMerged.changed&&!forecastMerged.changed&&!confirmedMerged.changed&&
    !leadLagMerged.changed&&!earlyControlMerged.changed&&
    !v5IndependentMerged.changed)return res.status(200).json({
   ok:true,changed:false,existing:rows.length,received:current.length,
   existingEarly:earlyRows.length,receivedEarly:research?.study?.rows?.length??0,
   existingForecasts:forecastRows.length,receivedForecasts:forecasts?.rows?.length??0,
   existingConfirmedAudits:confirmedAuditRows.length,receivedConfirmedAudits:confirmedStudy?.rows?.length??0,
   existingLeadLag:leadLagRows.length,followerMarkets:followerScan?.validMarkets??0,
   existingEarlyControl:earlyControlRows.length,earlyControlMarkets:earlyControlScan?.valid??0,
   existingV5Independent:v5IndependentRows.length,v5Sampled:earlyControlScan?.v5Fresh?.length??0
  });
  const envelope=encryptJournal(merged.rows,process.env,earlyMerged.rows,
   forecastMerged.rows,confirmedMerged.rows,leadLagMerged.rows,
   earlyControlMerged.rows,v5IndependentMerged.rows);
  const contentBase64=Buffer.from(JSON.stringify(envelope)+'\n').toString('base64');
  return res.status(200).json({
   ok:true,changed:true,contentBase64,
   added:merged.added,updated:merged.updated,dropped:merged.dropped,
   total:merged.rows.length,
   earlyAdded:earlyMerged.added,earlyUpdated:earlyMerged.updated,
   earlyDropped:earlyMerged.dropped,earlyTotal:earlyMerged.rows.length,
   forecastAdded:forecastMerged.added,forecastUpdated:forecastMerged.updated,
   forecastDropped:forecastMerged.dropped,forecastTotal:forecastMerged.rows.length,
   confirmedAuditAdded:confirmedMerged.added,confirmedAuditUpdated:confirmedMerged.updated,
   confirmedAuditTotal:confirmedMerged.rows.length,
   leadLagAdded:leadLagMerged.added,leadLagUpdated:leadLagMerged.updated,
   leadLagDropped:leadLagMerged.dropped,leadLagTotal:leadLagMerged.rows.length,
   earlyControlAdded:earlyControlMerged.added,
   earlyControlUpdated:earlyControlMerged.updated,
   earlyControlDropped:earlyControlMerged.dropped,
   earlyControlTotal:earlyControlMerged.rows.length,
   v5IndependentAdded:v5IndependentMerged.added,
   v5IndependentUpdated:v5IndependentMerged.updated,
   v5IndependentDropped:v5IndependentMerged.dropped,
   v5IndependentTotal:v5IndependentMerged.rows.length
  });
 }catch(e){
  console.warn('WEEX_RADAR_JOURNAL_ERROR '+String(e?.message||e).slice(0,75));
  return res.status(503).json({
   error:'Журнал временно недоступен. Сканер и уведомления работают независимо.'
  });
 }
}
