// №110: retrospective quality diagnostics for ALL 32 WEEX instruments,
// including markets with no archived notifications. No orders or extra calls.
// Not a ranking of profitable markets, and does not include unsent candidates.
import {profileSymbols,marketForecastProfile} from './market-forecast-profiles.mjs';

export const V110_ALL32_AUDIT_POLICY=Object.freeze({
 version:'v110-all32-retrospective-archive-v1',
 lookbackDays:90,
 marketUniverse:'EXACT_CURRENT_32_MARKETS',
 forecastThresholdForPct:20,
 confirmedThresholdForPct:20,
 noLiveChanges:true,noOrders:true,noMarketRequests:true,
 noNewCron:true,noPaidServices:true,noRawRowsExposed:true,
 noAutoPromotion:true,
 warning:'Only actually published forecasts/confirmed alerts: missed and suppressed forecasts are not observed. Percentages describe signed close-to-reference movement, NOT actual trade profit or proof of predictive advantage.'
});
const DAY=86400000,finite=n=>typeof n==='number'&&Number.isFinite(n);
const pct=(f,n)=>n>=20?Number((100*f/n).toFixed(1)):null;
const sides=['LONG','SHORT'],strengths=['STRONG','STANDARD','CAUTION'];
function goodRow(r,now,allowed){
 return r&&typeof r.id==='string'&&/^[a-f0-9]{32}$/.test(r.id)&&
  allowed.has(r.symbol)&&sides.includes(r.direction)&&
  Number.isSafeInteger(r.sentAt)&&r.sentAt>now-90*DAY&&r.sentAt<=now&&
  r.windows&&typeof r.windows==='object';
}
function normalizeRows(rows,now,allowed){
 if(!Array.isArray(rows)||rows.length>5000)return [];
 const dedupe=new Map();
 for(const r of rows){
  if(!goodRow(r,now,allowed))continue;
  if(!dedupe.has(r.id))dedupe.set(r.id,r);
 }
 return [...dedupe.values()];
}
function summarizeRecords(list,confirmed=false){
 const n=list.length;
 const summary={published:n,
  LONG:0,SHORT:0,STRONG:0,STANDARD:0,CAUTION:0,
  pre5m:{known:0,alreadyMovedAtLeast10bps:0,alreadyMovedPct:null,
   meanSignedBps:null},
  after5m:{observed:0,favorable:0,adverse:0,flat:0,pending:0,noData:0,
   favorablePct:null,meanSignedBps:null},
  after15m:{observed:0,favorable:0,adverse:0,flat:0,pending:0,noData:0,
   favorablePct:null,meanSignedBps:null},
  after30m:{observed:0,favorable:0,adverse:0,flat:0,pending:0,noData:0,
   favorablePct:null,meanSignedBps:null}};
 let priorSum=0;
 const moved={5:0,15:0,30:0},sum={5:0,15:0,30:0};
 for(const r of list){
  summary[r.direction]++;
  if(strengths.includes(r.strength))summary[r.strength]++;
  if(finite(r.preMove5mBps)){
   summary.pre5m.known++;
   if(r.preMove5mBps>=10)summary.pre5m.alreadyMovedAtLeast10bps++;
   priorSum+=r.preMove5mBps;
  }
  for(const h of [5,15,30]){
   const w=r.windows?.[h],s=summary['after'+h+'m'];
   if(w?.status==='OBSERVED'&&finite(w.moveBps)&&Math.abs(w.moveBps)<=1e6){
    s.observed++;
    if(w.moveBps>0)s.favorable++;
    else if(w.moveBps<0)s.adverse++;
    else s.flat++;
    moved[h]++;sum[h]+=w.moveBps;
   }else if(w?.status==='NO_DATA')s.noData++;
   else s.pending++;
  }
 }
 if(summary.pre5m.known){
  summary.pre5m.meanSignedBps=Number((priorSum/summary.pre5m.known).toFixed(2));
  summary.pre5m.alreadyMovedPct=pct(summary.pre5m.alreadyMovedAtLeast10bps,summary.pre5m.known);
 }
 for(const h of [5,15,30]){
  const s=summary['after'+h+'m'];
  s.favorablePct=pct(s.favorable,s.observed);
  if(moved[h])s.meanSignedBps=Number((sum[h]/moved[h]).toFixed(2));
 }
 if(confirmed)summary.note='Confirmed here means a sent 5m LONG/SHORT ntfy, not a filled position or verified TP/SL outcome.';
 return summary;
}
export function evaluateV110All32MarketAudit(forecastRows,confirmedRows,now=Date.now()){
 const symbols=profileSymbols();
 if(symbols.length!==32||new Set(symbols).size!==32||
  !Number.isSafeInteger(now)||now<=0)return {status:'INVALID_UNIVERSE_OR_CLOCK'};
 const allowed=new Set(symbols),
  forecast=normalizeRows(forecastRows,now,allowed),
  confirmed=normalizeRows(confirmedRows,now,allowed);
 const markets=symbols.map(symbol=>{
  const group=marketForecastProfile(symbol)?.group;
  const published=summarizeRecords(forecast.filter(r=>r.symbol===symbol));
  const tradeAlerts=summarizeRecords(confirmed.filter(r=>r.symbol===symbol),true);
  return {symbol,group,forecast:published,confirmed:tradeAlerts,
   sampleAdequate15m:published.after15m.observed>=20,
   hasObservedForecasts:published.published>0,
   hasConfirmedAlert:tradeAlerts.published>0};
 });
 const totals={forecast:summarizeRecords(forecast),
  confirmed:summarizeRecords(confirmed,true)};
 const noForecastMarkets=markets.filter(m=>m.forecast.published===0).map(m=>m.symbol);
 const noConfirmedMarkets=markets.filter(m=>m.confirmed.published===0).map(m=>m.symbol);
 return {mode:'V110_ALL32_ARCHIVE_QUALITY_AUDIT',
  policy:V110_ALL32_AUDIT_POLICY,status:'DESCRIPTIVE_ONLY',
  liveScanStateIndependentOfThisArchive:true,
  marketsInUniverse:32,marketsWithArchivedForecasts:32-noForecastMarkets.length,
  marketsWithConfirmedAlerts:32-noConfirmedMarkets.length,
  marketsWithoutArchivedForecasts:noForecastMarkets,
  marketsWithoutConfirmedAlerts:noConfirmedMarkets,
  totals,markets,ordersSent:0,liveChanges:0,paidApiCalls:0,
  recommendation:'KEEP_108',proofOfProfitableTrading:false,
  futurePredictionApproved:false};
}
