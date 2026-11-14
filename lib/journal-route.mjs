// Routes through GET /api/signals?mode=journal / journal-export.
// Hobby serverless function quota stays unchanged.
// Only authenticated GitHub workflow may receive encrypted archive data.
import {jwtVerify,createRemoteJWKSet} from 'jose';
import {evaluateV110Learning} from './v110-self-learning.mjs';
import {evaluateV110MLShadow} from './v110-ml-shadow.mjs';
import {evaluateV110TwoFiveMinuteContinuation} from './v110-two-5m-continuation.mjs';
import {evaluateV110All32MarketAudit} from './v110-all32-market-audit.mjs';
import {evaluateV110DepthStudy} from './v110-depth-study.mjs';
import {evaluateV110Hypotheses} from './v110-hypothesis-discovery.mjs';
import {evaluateV110FixedForwardStudy} from './v110-forward-study.mjs';
import {evaluateV110DirectionDiagnostics} from './v110-direction-diagnostics.mjs';
import {evaluateLongStandardForward} from './v110-long-standard-forward.mjs';
import {notifyV110Review} from './v110-review-notices.mjs';
import {
 mergeJournal,encryptJournal,decryptJournalArchive,summarizeJournal
} from './journal-core.mjs';
import {mergeEarlyArchive} from './early-journal.mjs';
import {recentEarlyResearch} from './early-study-route.mjs';
import {mergeForecastArchive,recentForecastResearch,recoverArchivedForecasts} from './forecast-journal.mjs';
import {mergeConfirmedDirectionArchive,recentConfirmedDirectionResearch} from './confirmed-direction-journal.mjs';

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
 if(response.status===404)return {exists:false,rows:[],earlyRows:[],forecastRows:[],confirmedAuditRows:[]};
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
  const {exists,rows,earlyRows,forecastRows,confirmedAuditRows}=await readJournal(now);
  if(mode==='journal'){
   return res.status(200).json({
    state:exists?'READY':'EMPTY',persistent:exists,
    encryptedAtRest:true,repositoryContentsArePublic:true,
    ...summarizeJournal(rows,now,earlyRows,forecastRows,confirmedAuditRows),
    // Aggregate SHADOW result from existing decrypted rows; no rows leak.
    learningShadow:evaluateV110Learning(forecastRows,now),
    // Trained on original encrypted journal rows, results only in aggregate.
    mlShadow:evaluateV110MLShadow(forecastRows,now),
    // First two fully subsequent CLOSED 5m periods after each published forecast.
    twoClosed5mShadow:evaluateV110TwoFiveMinuteContinuation(forecastRows,now),
    // Across ALL 32 instruments, including markets with no published alerts.
    all32MarketAudit:evaluateV110All32MarketAudit(forecastRows,confirmedAuditRows,now),
    depthShadowStudy:evaluateV110DepthStudy(forecastRows,now),
    hypothesisDiscovery:evaluateV110Hypotheses(forecastRows,now),
    forwardStudy:evaluateV110FixedForwardStudy(forecastRows,now),
    directionDiagnostics:evaluateV110DirectionDiagnostics(forecastRows,now),
    longStandardForward:evaluateLongStandardForward(forecastRows,now)
   });
  }
  if(mode!=='journal-export')return res.status(400).json({error:'Bad mode'});
  // Reuse the EXISTING OIDC-authorized 20-minute GitHub writer. No new job,
  // secrets, trading calls or storage service. The early collector is read-only.
  // A temporary ntfy or WEEX failure must not erase existing early history.
  const [current,research,forecasts,recovery]=await Promise.all([
   recentQuality(),recentEarlyResearch(now).catch(()=>null),
   recentForecastResearch(now).catch(e=>{
    // Safe diagnostics only: never log a private ntfy topic or archive data.
    const m=String(e?.message||e).replace(/wr-[a-f0-9]{32}/g,'[private-topic]');
    console.warn('WEEX_RADAR_JOURNAL_FORECAST_READ_FAILED '+m.slice(0,75));
    return null;
   }),
   // Repair missing historical candle results without modifying the original
   // alert or exposing decrypted forecast details to the GitHub writer.
   recoverArchivedForecasts(forecastRows,now).catch(()=>null)
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
  // Aggregate diagnostic only; shows whether forecast ntfy observations were ingested.
  console.info('WEEX_RADAR_JOURNAL_INGEST '+JSON.stringify({
   forecastSeen:forecasts?.seen??null,forecastEvaluated:forecasts?.rows?.length??null,
   historyAttempted:recovery?.attempted??null,historyFailed:recovery?.failed??null,
   historyRecovered:recovery?.rows?.length??null,
   forecastFailedMarkets:forecasts?.missingMarkets??null,
   forecastAdded:forecastMerged.added,forecastUpdated:forecastMerged.updated,
   forecastStored:forecastMerged.rows.length,confirmedStored:merged.rows.length
  }));
  if(!merged.changed&&!earlyMerged.changed&&!forecastMerged.changed&&!confirmedMerged.changed)return res.status(200).json({
   ok:true,changed:false,existing:rows.length,received:current.length,
   existingEarly:earlyRows.length,receivedEarly:research?.study?.rows?.length??0,
   existingForecasts:forecastRows.length,receivedForecasts:forecasts?.rows?.length??0,
   existingConfirmedAudits:confirmedAuditRows.length,receivedConfirmedAudits:confirmedStudy?.rows?.length??0
  });
  const envelope=encryptJournal(merged.rows,process.env,earlyMerged.rows,forecastMerged.rows,confirmedMerged.rows);
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
   confirmedAuditTotal:confirmedMerged.rows.length
  });
 }catch(e){
  console.warn('WEEX_RADAR_JOURNAL_ERROR '+String(e?.message||e).slice(0,75));
  return res.status(503).json({
   error:'Журнал временно недоступен. Сканер и уведомления работают независимо.'
  });
 }
}
