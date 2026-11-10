// WEEX RADAR cron: ntfy-only delivery. Market filtering is unchanged.
// Google Chrome and Telegram endpoints remain in the repo for backward
// compatibility, but are not imported or called by this scheduled workflow.
import {timingSafeEqual} from 'node:crypto';
import {jwtVerify,createRemoteJWKSet} from 'jose';
import {_test as marketSafety} from './signals.mjs';
import {observeEarlyPush} from '../lib/early-push.mjs';
import {ntfySend} from '../lib/ntfy-alerts.mjs';
import {adviseSymbol} from '../lib/advisor.mjs';
import {filterPhoneCandidates,PHONE_POLICY} from '../lib/directional-notification-policy.mjs';
import {checkEntryLevels} from '../lib/entry-quality.mjs';
import {summarizeFilterDiagnostics} from '../lib/filter-diagnostics.mjs';
import {assessNetCosts} from '../lib/net-costs.mjs';
import {monitorDispatch,snapshotMarkets,latestHeartbeat,githubBackupStandby} from '../lib/health-monitor.mjs';
const JWKS=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
function secureEquals(a,b){if(!a||!b)return false;let x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
async function authorized(req){
 const header=req.headers.authorization||'';
 if(header.startsWith('Bearer ')){
  try{
   const {payload}=await jwtVerify(header.substring(7),JWKS,{issuer:'https://token.actions.githubusercontent.com',audience:'weex-radar-push'});
   return payload.repository==='Alex-Rodermel-spec/weex-radar'&&payload.ref==='refs/heads/main'&&
    ['schedule','workflow_dispatch'].includes(payload.event_name)&&
    String(payload.workflow_ref||'')==='Alex-Rodermel-spec/weex-radar/.github/workflows/push-notifications.yml@refs/heads/main' ? 'github' : null;
  }catch{return false}
 }
 return secureEquals(req.headers['x-radar-cron-key'],process.env.PUSH_CRON_KEY) ? 'cron' : null;
}
// Audit scheduling without storing secrets, subscriber addresses or balances.
// Log each authorized run, including healthy scans with zero trading signals.
export function dispatchAudit(source,http,body,checkedAt=Date.now()){
 if(!['cron','github'].includes(source))throw Error('Unknown scheduler');
 return JSON.stringify({source,http,checkedAt,
   signals:Number.isSafeInteger(body?.signals)?body.signals:0,
   delivered:Number.isSafeInteger(body?.delivered)?body.delivered:0,
   failed:Number.isSafeInteger(body?.failed)?body.failed:0,
   subscribers:Number.isSafeInteger(body?.subscribers)?body.subscribers:null,
   duplicates:Number.isSafeInteger(body?.duplicates)?body.duplicates:0});
}
async function safeEarlyPush(){
 try{
  const early=await observeEarlyPush();
  // Audit scans even when no early signal is found.
  console.info('WEEX_RADAR_EARLY_DISPATCH '+JSON.stringify(early));
  return early;
 }catch(e){
  console.warn('WEEX_RADAR_EARLY_SCAN_FAILED '+String(e.message||e).slice(0,110));
  return {checked:0,earlySignals:0,delivered:0,failed:1};
 }
}
async function reply(res,source,http,body,markets=null){
 console.info('WEEX_RADAR_DISPATCH '+dispatchAudit(source,http,body));
 // Monitoring must NEVER stop normal signals or turn a healthy scan into HTTP 503.
 // Run after ntfy delivery has already been accepted and all scan work finished.
 try{await monitorDispatch({source,http,markets,early:body?.early,ntfy:body?.ntfy})}
 catch(e){console.warn('WEEX_RADAR_HEALTH_CHECK_FAILED '+String(e.message||e).slice(0,85))}
 return res.status(http).json(body);
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST'&&req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const source=await authorized(req);
 if(!source)return res.status(401).json({error:'Unauthorized'});
 // No Blob/VAPID/Telegram dependency; secret ntfy topic stays server-side.
 if(!process.env.PUSH_CRON_KEY)return res.status(503).json({error:'Cron not configured'});
 // The minute-by-minute cron is the PRIMARY source of notifications.
 // GitHub checks the heartbeat before any 1m/5m scan or ntfy send.
 // This prevents two concurrently running schedulers from posting the same
 // candle as two notifications. If cron is stale or monitoring is unavailable,
 // keep the existing GitHub emergency fallback.
 if(source==='github'){
  const heartbeat=await latestHeartbeat();
  if(githubBackupStandby(heartbeat)){
   console.info('WEEX_RADAR_GITHUB_STANDBY '+JSON.stringify({
    reason:'cron-heartbeat-recent',lastSeenAt:heartbeat.last.at
   }));
   return res.status(200).json({
    ok:true,standby:true,deliveryMode:'cron-primary/github-backup',
    signals:0,delivered:0,failed:0,duplicates:0,
    note:'Primary cron is active; GitHub backup correctly skipped this scan.'
   });
  }
 }
 // Start the silent 1m forecaster immediately. It must not delay
 // the confirmed 5m LONG/SHORT notification path; it never publishes ntfy.
 let healthMarkets=null;
 const earlyStartedAt=Date.now();
 const earlyPromise=safeEarlyPush().then(early=>{
  console.info('WEEX_RADAR_EARLY_RUNTIME '+JSON.stringify({
   elapsedMs:Date.now()-earlyStartedAt,checked:early.checked,
   earlySignals:early.earlySignals,failed:early.failed
  }));
  return early;
 });
 try{
  const response=await fetch('https://weex-radar.vercel.app/api/signals',{cache:'no-store',signal:AbortSignal.timeout(26000)});
  if(!response.ok)throw Error('Radar API '+response.status);
  const result=await response.json();
  if(!Number.isFinite(result.generatedAt)||Math.abs(Date.now()-result.generatedAt)>90000||!Array.isArray(result.symbols))throw Error('Stale/invalid scan');
  healthMarkets=snapshotMarkets(result.symbols);
  // Snapshot-only telemetry. No order, alert, storage or scan decision changes.
  console.info('WEEX_RADAR_FILTER_DIAGNOSTICS '+
    JSON.stringify(summarizeFilterDiagnostics(result.symbols)));
  // Early forecasts and historical forecast follow-ups remain
  // DIAGNOSTICS ONLY. No WAIT, SKIP, forecast or follow-up phone noise.
  const forecastFollowup={
   enabled:false,checked:0,sent:0,failed:0,pending:0,duplicates:0,
   reason:'LONG_SHORT_ONLY_PHONE_POLICY'
  };
  const candidates=result.symbols.filter(s=>s.status==='ok'&&['LONG','SHORT'].includes(s.direction)&&
    s.expiresAt>Date.now()+15000&&s.exchange&&s.candleCloseTime);
  // A cached or slow scan is NOT a live entry. Recheck exchange quotes immediately
  // before gateway delivery, and stop late 5-minute-candle alerts.
  const checked=await Promise.all(candidates.map(async signal=>{
    if(Date.now()-signal.candleCloseTime>90000)return null;
    try{
      const quote=await marketSafety.fetchCurrentQuote(signal.symbol,signal.exchange);
      const quality=marketSafety.currentPriceQuality(signal.direction,signal.price,
        Number(signal.indicators?.atr),quote.price);
      // A second live quote can invalidate the remaining R/R or nearby level.
      // Re-evaluate before any notification; never mix WEEX/Bybit prices.
      const entry=checkEntryLevels({
        direction:signal.direction,entry:quote.price,
        stop:Number(signal.stop),take:Number(signal.take),
        nearestLevel:signal.entryQuality?.nearestLevel??null
      });
      // Recalculate from current WEEX bid/ask. In LONG/SHORT-only mode,
      // missing or unfavorable modeled costs MUST block phone alerts.
      const costReview=assessNetCosts({
        exchange:signal.exchange,direction:signal.direction,
        entryMid:quote.price,stop:Number(signal.stop),take:Number(signal.take),
        bid:quote.bid,ask:quote.ask
      });
      if(!(quality.ok&&signal.entryQuality?.ok===true&&entry.ok))return null;
      const refreshed={...signal,livePrice:quote.price,entryQuality:entry,costReview};
      refreshed.advisor=adviseSymbol(refreshed,Date.now());
      return refreshed;
    }catch{return null}
  }));
  const withFreshQuote=checked.filter(Boolean);
  const review=filterPhoneCandidates(withFreshQuote,Date.now());
  const signals=review.accepted;
  const directionalDiagnostics={
   ...review.diagnostics,rawCandidates:candidates.length,
   recheckRejected:candidates.length-withFreshQuote.length,
   sentToNtfy:signals.length
  };
  console.info('WEEX_RADAR_DIRECTIONAL_GATE '+JSON.stringify(directionalDiagnostics));
  // Only fresh, cost-reviewed, manually REVIEW-rated 5m directional
  // candidates reach ntfy. This code neither trades nor changes WEEX leverage.
  const ntfyPromise=signals.length?ntfySend('confirmed',signals).catch(e=>{
   console.warn('WEEX_RADAR_NTFY_DISPATCH_FAILED '+String(e.message||e).slice(0,80));
   return {enabled:false,delivered:0,failed:1,duplicates:0};
  }):Promise.resolve({enabled:Boolean(process.env.NTFY_TOPIC),delivered:0,failed:0,duplicates:0});
  const [early,ntfy]=await Promise.all([earlyPromise,ntfyPromise]);
  return reply(res,source,200,{
   ok:true,deliveryMode:'ntfy-only',signals:signals.length,
   delivered:ntfy.delivered,failed:ntfy.failed,duplicates:ntfy.duplicates,
   early,ntfy,forecastFollowup,directionalDiagnostics,
   notificationPolicy:PHONE_POLICY.mode,
   telegram:{enabled:false},chrome:{enabled:false}
  },healthMarkets);
 }catch(e){
  // Even if the 5m scanner fails, finish independent 1m ntfy work.
  await earlyPromise;
  console.error('Push check failed:',e.message);
  return reply(res,source,503,{error:'Scan or notification delivery unavailable'},healthMarkets);
 }
}
