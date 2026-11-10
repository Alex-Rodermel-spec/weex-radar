// Public, read-only diagnostic detail for ALL base WEEX scan results.
// Diagnostics record why a market did not qualify, without inventing LONG/SHORT,
// claiming profitable forecasts, or changing trading/risk filters.
import {STAGES,summarizeFilterDiagnostics} from './filter-diagnostics.mjs';
import {PHONE_POLICY} from './directional-notification-policy.mjs';
const numberOrNull=n=>Number.isFinite(n)?n:null;
export function fullForecastDiagnostics(markets,now=Date.now()){
 const all=Array.isArray(markets)?markets:[];
 const filter=summarizeFilterDiagnostics(all);
 const items=all.map(s=>{
  const indicators=s?.indicators||{};
  const stage=STAGES.includes(s?.filterDiagnostic?.stage)?
   s.filterDiagnostic.stage:s?.status==='ok'?'unknown':'data_unavailable';
  return {
   symbol:typeof s?.symbol==='string'?s.symbol:null,
   exchange:s?.exchange||null,status:s?.status||'unavailable',
   direction:['LONG','SHORT'].includes(s?.direction)?s.direction:null,
   stage,reason:typeof s?.reason==='string'?s.reason.slice(0,170):null,
   signalLevel:s?.level||null,score:numberOrNull(s?.score),
   price:numberOrNull(s?.livePrice??s?.price),
   candleCloseTime:numberOrNull(s?.candleCloseTime),
   expiresAt:numberOrNull(s?.expiresAt),
   rsi5:numberOrNull(indicators.rsi),
   atr5:numberOrNull(indicators.atr),
   volumeRatio5:numberOrNull(indicators.volumeRatio),
   trend15:indicators.trend15||null,
   entryQualityOk:s?.entryQuality?.ok===true,
   retest:s?.direction?s?.retest?.[s.direction]?.status??null:null,
   estimatedCostStatus:s?.costReview?.status||null,
   estimatedNetRR:numberOrNull(s?.costReview?.netRR),
   detectedLate:Boolean(s?.candleCloseTime&&now-s.candleCloseTime>90000)
  };
 });
 return {
  mode:'READ_ONLY_FULL_FORECAST_DIAGNOSTICS',
  generatedAt:now,observedMarkets:all.length,
  stages:filter,markets:items,
  phonePolicy:PHONE_POLICY,
  modelLimitations:{
   coverage:'Only the 16 core 5m/15m live scanner markets; 50 additional pairs remain experimental PAPER research.',
   forecast:'1m/5m/15m early forecasts are silent; market-level 5m filter diagnosis is visible.',
   certainty:'Indicators cannot establish future profit or guaranteed direction.',
   economics:'Fee/spread estimates do not guarantee fill, P&L or liquidation pricing.',
   android:'ntfy server acceptance does not verify Android delivery.'
  },
  notATrade:true,ordersSent:0
 };
}
