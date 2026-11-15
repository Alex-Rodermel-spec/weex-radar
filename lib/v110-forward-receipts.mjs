// №110 — freeze public, already-read 1m/5m/10m evidence BEFORE future bars.
// Pure, no remote API, blob, ntfy, trader or trained weights. Existing Vercel
// diagnostics may log short receipts; server does NOT keep a durable study
// archive or automatically fetch/measure future prices in this change.
import {createHash} from 'node:crypto';
import {profileSymbols,marketForecastProfile} from './market-forecast-profiles.mjs';
import {evaluateEarlyTwoFullFuture5m} from './v110-early-reversal-shadow.mjs';
const MIN=60_000,FIVE=5*MIN;
const VALID_BIAS=new Set(['LONG_BIAS','SHORT_BIAS']);
const KINDS=new Set(['ONE_MINUTE_LEADS_NEUTRAL_FIVE',
 'ONE_MINUTE_OPPOSES_FIVE','ONE_AND_FIVE_AHEAD_OF_TEN',
 'THREE_TIMEFRAME_ALIGNMENT_CONTROL']);
const ALLOWED=new Set(profileSymbols());
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const clock=x=>Number.isSafeInteger(x)&&x>0;
const round=x=>Math.round(x*100)/100;
const sign=d=>d==='LONG_BIAS'?1:-1;
export const V110_FROZEN_FORWARD_RECEIPT_POLICY=Object.freeze({
 version:'v110-unsent-1m-forward-frozen-receipts-v1',
 fixedHorizonMinutes:[5,10,15],
 twoFullFuture5m:true,
 maxReceiptsPerNormalScan:32,
 maxReceiptsPerLogLine:8,
 existingMarketRequestsOnly:true,noNewPolling:true,noNewStorage:true,
 noNewPaidServices:true,noPhoneAlerts:true,noTrade:true,
 noLiveModelTraining:true,forwardResultsNotYetAutomatic:true,
 historicalLogRetentionNotGuaranteed:true
});
export function freezeV110ForwardReceipt(observation,kind,now=Date.now()){
 if(!KINDS.has(kind)||!clock(now)||!observation?.available||
  observation.exchange!=='WEEX'||!ALLOWED.has(observation.symbol)||
  !Array.isArray(observation.timeframes)||
  observation.timeframes.map(t=>t?.intervalMinutes).join(',')!=='1,5,10')
  return null;
 const [one,five,ten]=observation.timeframes;
 if(!VALID_BIAS.has(one.direction)||!finite(one.price)||
  ![one,five,ten].every(t=>clock(t.closedAt)&&t.closedAt<=now))
  return null;
 const atFive=Math.floor((now-1000)/FIVE)*FIVE;
 if(now-one.closedAt>2*MIN||five.closedAt!==atFive||
  now-ten.closedAt>11*MIN)return null;
 if(kind==='THREE_TIMEFRAME_ALIGNMENT_CONTROL'&&
  !(one.direction===five.direction&&one.direction===ten.direction))return null;
 if(kind==='ONE_MINUTE_LEADS_NEUTRAL_FIVE'&&five.direction!=='NEUTRAL')
  return null;
 if(kind==='ONE_MINUTE_OPPOSES_FIVE'&&
  !(VALID_BIAS.has(five.direction)&&one.direction!==five.direction))return null;
 if(kind==='ONE_AND_FIVE_AHEAD_OF_TEN'&&
  !(one.direction===five.direction&&one.direction!==ten.direction))return null;
 // Same source candle & direction remains the same observation if the cron
 // is retried; do not treat repeated requests as independent confirmations.
 const hash=createHash('sha256').update([
  'v110-frozen-v1',observation.symbol,kind,one.direction,
  one.closedAt,five.closedAt,one.price].join('|')).digest('hex').slice(0,24);
 return {id:hash,source:'V110_EXISTING_ALL32_FORECAST_SCAN',
  kind,symbol:observation.symbol,group:marketForecastProfile(observation.symbol).group,
  direction:one.direction,referencePrice:one.price,
  frozenAt:now,oneClosedAt:one.closedAt,fiveClosedAt:five.closedAt,
  tenClosedAt:ten.closedAt,notPublishedSignal:true,
  horizonMinutes:[5,10,15],noTrade:true};
}
function validReceipt(r,now){
 return r?.source==='V110_EXISTING_ALL32_FORECAST_SCAN'&&
  /^[a-f0-9]{24}$/.test(r?.id||'')&&KINDS.has(r.kind)&&
  VALID_BIAS.has(r.direction)&&ALLOWED.has(r.symbol)&&
  finite(r.referencePrice)&&clock(r.frozenAt)&&clock(now)&&now>=r.frozenAt&&
  clock(r.oneClosedAt)&&clock(r.fiveClosedAt)&&
  clock(r.tenClosedAt)&&r.oneClosedAt<=r.frozenAt&&
  r.fiveClosedAt<=r.frozenAt&&r.tenClosedAt<=r.frozenAt;
}
// Returns UNKNOWN (never a fabricated win) for missing candles, duplicate
// bars, OHLC corruption, unclosed bars, and any data missing at evaluation.
export function scoreV110FrozenForwardReceipt(r,minuteBars,now=Date.now()){
 const base={mode:'V110_UNSENT_1M_FORWARD_SCORE',id:r?.id||null,
  kind:r?.kind||null,symbol:r?.symbol||null,
  status:'INVALID_INPUT',horizons:{},twoFull5m:null,
  noTrade:true,ordersSent:0,live108Changes:0,
  warning:'Read-only historical movement after a frozen public WEEX snapshot. No fill, PnL, forecast publication or proof of predictor improvement.'};
 if(!validReceipt(r,now)||!Array.isArray(minuteBars)||minuteBars.length>500)
  return base;
 const start=Math.ceil(r.frozenAt/MIN)*MIN;
 const byTime=new Map(),duplicates=new Set();
 for(const b of minuteBars){
  if(!clock(b?.time)||b.time%MIN!==0||b.time<start||
   b.time+MIN>now-1000||!finite(b.open)||!finite(b.close)||
   (b.closeTime!==undefined&&b.closeTime!==b.time+MIN))continue;
  if(byTime.has(b.time))duplicates.add(b.time);
  else byTime.set(b.time,{time:b.time,open:b.open,close:b.close});
 }
 for(const t of duplicates)byTime.delete(t);
 const horizons={};
 for(const h of [5,10,15]){
  const starts=Array.from({length:h},(_,i)=>start+i*MIN);
  if(starts.some(t=>!byTime.has(t))){
   horizons[h]={status:'PENDING_OR_MISSING',signedBps:null,
    directionResult:'UNKNOWN'};continue;
  }
  const close=byTime.get(starts.at(-1)).close;
  const signedBps=round(sign(r.direction)*(close/r.referencePrice-1)*10000);
  horizons[h]={status:'OBSERVED',signedBps,
   directionResult:signedBps>0?'FAVORABLE':signedBps<0?'ADVERSE':'FLAT',
   closedAt:starts.at(-1)+MIN};
 }
 // The existing dedicated two-5m evaluator receives only validated UNIQUE
 // 1m candles. It rejects incomplete future 5m bodies after frozenAt.
 const future5m=evaluateEarlyTwoFullFuture5m({
  kind:r.kind,at:r.frozenAt,bias:r.direction,refPrice:r.referencePrice
 },[...byTime.values()],now);
 const allReady=[5,10,15].every(h=>horizons[h].status==='OBSERVED')&&
  future5m.status==='OBSERVED';
 return {...base,status:allReady?'OBSERVED':'PENDING_OR_MISSING',
  frozenAt:r.frozenAt,outcomeWindowStartsAt:start,
  horizons,twoFull5m:future5m};
}
export function summarizeV110FrozenForwardScores(rows){
 const valid=Array.isArray(rows)?rows.filter(x=>
  x?.mode==='V110_UNSENT_1M_FORWARD_SCORE'&&
  x.status==='OBSERVED'&&KINDS.has(x.kind)):[];
 const dedup=new Map();
 for(const x of valid)if(typeof x.id==='string'&&!dedup.has(x.id))
  dedup.set(x.id,x);
 const unique=[...dedup.values()];
 const byKind={};
 for(const kind of KINDS){
  const group=unique.filter(r=>r.kind===kind);
  const byHorizon={};
  for(const h of [5,10,15]){
   const seen=group.filter(r=>r.horizons?.[h]?.status==='OBSERVED'&&
    typeof r.horizons[h].signedBps==='number');
   const n=seen.length,positive=seen.filter(r=>r.horizons[h].signedBps>0).length;
   byHorizon[h]={observed:n,favorable:positive,
    favorablePct:n>=20?round(100*positive/n):null};
  }
  const two=group.filter(r=>r.twoFull5m?.status==='OBSERVED');
  byKind[kind]={observed:group.length,byHorizon,
   twoFull5mObserved:two.length,
   twoFull5mConfirmed:two.filter(r=>r.twoFull5m.twoCandleConfirmation===true).length,
   twoFull5mConfirmedPct:two.length>=20?
    round(100*two.filter(r=>r.twoFull5m.twoCandleConfirmation===true).length/two.length):null};
 }
 return {mode:'V110_UNSENT_1M_FROZEN_FORWARD_AGGREGATE',
  fullyObservedReceipts:unique.length,byKind,
  minForDescriptiveRate:20,noTrade:true,live108Changes:0,
  readyForLivePromotion:false,independentHoldoutVerified:false,
  note:'Requires explicitly paired frozen receipts and later fully closed WEEX bars. The 10m scan and its existing ephemeral logs do NOT automatically provide scored prospective outcomes or durable storage.'};
}
