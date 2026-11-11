// On-demand, read-only system health. Served by /api/signals?mode=health
// to stay within Vercel Hobby's 12 Serverless Function limit.
import {summarizeFilterDiagnostics} from './filter-diagnostics.mjs';
import {fullForecastDiagnostics} from './full-forecast-diagnostics.mjs';
import {forecastTopic} from './forecast-ntfy.mjs';
import {assessHeartbeat,latestHeartbeat,ntfyGatewayHealth,
 snapshotMarkets,forecastGatewayHealth,HEARTBEAT_MS,STALE_MS} from './health-monitor.mjs';

export async function handleHealth(req,res,scanAll){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const now=Date.now();
 const [marketResult,heartbeatResult,ntfyResult,forecastResult]=await Promise.allSettled([
  scanAll(),latestHeartbeat(),ntfyGatewayHealth(),forecastGatewayHealth(forecastTopic())
 ]);
 const markets=marketResult.status==='fulfilled'?
  snapshotMarkets(marketResult.value):null;
 const recent=heartbeatResult.status==='fulfilled'?
  heartbeatResult.value:{configured:false,reachable:false,last:null};
 const cron=assessHeartbeat(recent.last,now);
 const ntfy=ntfyResult.status==='fulfilled'?
  ntfyResult.value:{configured:false,reachable:false,lastSignalAt:null};
 const forecastNtfy=forecastResult.status==='fulfilled'?
  forecastResult.value:{configured:Boolean(forecastTopic()),reachable:false,
   lastForecastAt:null,recentTwoHours:{total:0,STRONG:0,STANDARD:0,CAUTION:0},
   deliveryToPhoneVerified:false};
 const health={
  generatedAt:Date.now(),intervalMinutes:HEARTBEAT_MS/60000,
  cronStaleAfterMinutes:STALE_MS/60000,
  cron:{...cron,configured:recent.configured,monitorReachable:recent.reachable},
  markets:{...markets,reachable:markets!==null,
   ok:markets!==null&&markets.total===16&&markets.unavailable===0,
   sourcePolicy:'WEEX primary, Bybit fallback only on full exchange feed failures'},
  ntfy:{...ntfy,deliveryToPhoneVerified:false},
  forecastNotifications:{
   mode:'SEPARATE_NTFY_FORECAST_1_5_10',
   serverConfigured:Boolean(forecastTopic()),
   gatewayReachable:forecastNtfy.reachable,
   lastForecastAt:forecastNtfy.lastForecastAt,
   recentTwoHours:forecastNtfy.recentTwoHours,
   independentOfTradingSignals:true,
   cadenceMinutes:10,maxPerWindow:2,
   phoneSubscriptionVerified:false,
   deliveryToPhoneVerified:false,
   forecastsAreTradeSignals:false,
   note:'Only accepted messages on private forecast relay are counted. A quiet topic or empty history does NOT prove a broken scanner, nor phone delivery. Topic secret is not exposed.'
  },
  filterDiagnostics:marketResult.status==='fulfilled'?
   summarizeFilterDiagnostics(marketResult.value):null,
  fullDiagnostics:marketResult.status==='fulfilled'?
   fullForecastDiagnostics(marketResult.value,now):null,
  notes:{
   heartbeat:'Cron status comes from a private 15-minute monitor; it is not a one-minute SLA.',
   android:'ntfy server reachability or acceptance does NOT prove Android notification delivery.',
   github:'The separate GitHub schedule attempts a rate-limited alert when cron has been stale for 35 minutes; GitHub may be delayed.',
   trades:'No orders, account access, secrets, paid service or new registration.'
  }
 };
 return res.status(200).json(health);
}
