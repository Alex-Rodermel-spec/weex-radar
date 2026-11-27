// V110 observational cost-hurdle benchmark for actually PUBLISHED forecasts.
// Uses archived, fully closed future candles ONLY after publication.
// Zero spread, no funding/market impact/latency, and NO fill: this is an
// optimistic scenario, NOT strategy P&L or a tradable backtest.
// No ntfy, API keys, market requests, orders, or changes to #108.
import {DEFAULT_TAKER_FEE_BPS,DEFAULT_SLIPPAGE_BPS} from './net-costs.mjs';

const MIN=60_000,DAY=24*60*MIN;
const HORIZONS=Object.freeze([5,15]);
const FEE=DEFAULT_TAKER_FEE_BPS,SLIP=DEFAULT_SLIPPAGE_BPS;
export const FORECAST_COST_HURDLE=Object.freeze({
 feeBpsEachSide:FEE,slippageBpsEachSide:SLIP,
 modeledRoundTripBps:2*(FEE+SLIP),
 spreadBpsIncluded:0,fundingIncluded:false,marketImpactIncluded:false,
 referencePriceIsExecutable:false
});
const rnd=n=>Math.round(n*100)/100;
const pct=(n,d)=>d>=20?rnd(100*n/d):null;
const validRow=(r,now)=>r&&/^[a-f0-9]{32}$/.test(r.id||'')&&
 /^[A-Z0-9]{2,24}$/.test(r.symbol||'')&&
 ['LONG','SHORT'].includes(r.direction)&&
 Number.isSafeInteger(r.sentAt)&&r.sentAt>0&&r.sentAt<=now&&
 r.sentAt>now-30*DAY&&r.windows&&typeof r.windows==='object';
function section(rows,now){
 const horizons={};
 for(const h of HORIZONS){
  const matured=rows.filter(r=>r.sentAt+(h+5)*MIN<=now);
  let observed=0,noData=0,pending=0,invalid=0,above=0,grossSum=0,netSum=0;
  for(const r of matured){
   const w=r.windows[h];
   if(w?.status==='NO_DATA'){noData++;continue}
   if(w?.status==='PENDING'){pending++;continue}
   if(w?.status!=='OBSERVED'||typeof w.moveBps!=='number'||
    !Number.isFinite(w.moveBps)||Math.abs(w.moveBps)>10000){invalid++;continue}
   observed++;
   grossSum+=w.moveBps;
   netSum+=w.moveBps-FORECAST_COST_HURDLE.modeledRoundTripBps;
   if(w.moveBps>FORECAST_COST_HURDLE.modeledRoundTripBps)above++;
  }
  horizons[h]={
   matured:matured.length,immature:rows.length-matured.length,
   observed,noData,pending,invalid,
   coveragePct:matured.length?rnd(100*observed/matured.length):null,
   referenceCostHurdleBps:FORECAST_COST_HURDLE.modeledRoundTripBps,
   aboveHurdleCloseCount:above,
   aboveHurdleClosePct: pct(above,observed),
   meanSignedCloseMoveBps:observed>=20?rnd(grossSum/observed):null,
   meanZeroSpreadBenchmarkBps:observed>=20?rnd(netSum/observed):null
  };
 }
 return {
  publishedAlerts:rows.length,
  distinctUtcDays:new Set(rows.map(r=>new Date(r.sentAt).toISOString().slice(0,10))).size,
  distinctSymbols:new Set(rows.map(r=>r.symbol)).size,horizons
 };
}
export function evaluateV110ForecastCostHurdle(rows,now=Date.now()){
 const base={
  mode:'V110_FORECAST_ZERO_SPREAD_COST_HURDLE',
  status:'OBSERVATIONAL_ONLY',source:'ENCRYPTED_PUBLISHED_FORECAST_ARCHIVE',
  reference:FORECAST_COST_HURDLE,horizonsMinutes:HORIZONS,
  maturityGraceMinutes:5,descriptiveMinimumObserved:20,
  noOrders:true,automaticTrading:false,live108Changed:false,
  notRealizedPnl:true,noIndependentProfitabilityProof:true,
  warning:'Forecast printed candle price is NOT an executable entry. This subtracts a hypothetical 22 bps fee/slippage round trip from subsequent signed CLOSE movement, assuming ZERO spread and fills at that reference. It omits actual spread, funding, market impact, latency, liquidation, stops, order fill probabilities, and correlated crypto exposures. Even a positive result is NOT a viable trading strategy or a validated advantage.'
 };
 if(!Array.isArray(rows)||rows.length>5000||
  !Number.isSafeInteger(now)||now<=0)return {...base,status:'INVALID_INPUT'};
 const unique=new Map();let invalid=0,duplicate=0;
 for(const r of rows){
  if(!validRow(r,now)){invalid++;continue}
  if(unique.has(r.id)){duplicate++;continue}
  unique.set(r.id,r);
 }
 const sorted=[...unique.values()].sort((a,b)=>a.sentAt-b.sentAt||a.id.localeCompare(b.id));
 const last=new Map(),spaced=[];
 for(const r of sorted){
  if(!last.has(r.symbol)||r.sentAt-last.get(r.symbol)>=30*MIN)
   spaced.push(r);
  last.set(r.symbol,r.sentAt);
 }
 return {...base,inputRows:rows.length,validUnique:sorted.length,
  invalidRows:invalid,duplicateIds:duplicate,
  all:section(sorted,now),
  byDirection:Object.fromEntries(['LONG','SHORT'].map(dir=>
   [dir,section(sorted.filter(r=>r.direction===dir),now)])),
  byStrength:Object.fromEntries(['STRONG','STANDARD','CAUTION'].map(s=>
   [s,section(sorted.filter(r=>r.strength===s),now)])),
  sameSymbolSpaced30m:section(spaced,now),
  independentValidation:false,
  interpretation:'A signed candle close exceeding this optimistic estimated fee/slippage hurdle is not a filled winning trade. This audit cannot select an algorithm, enter a trade, or estimate true expectancy.'};
}
