// Research ONLY: earliest 1m indicator bias diverges from 5m and/or 10m.
// Triggered by user-selected, free ntfy chart request using current WEEX
// CLOSED candles; the image itself is never decoded or interpreted.
// A candidate is NOT a LONG/SHORT entry; never modify trade gates.
const MIN=60000,FIVE=5*MIN;
const BIAS=new Set(['LONG_BIAS','SHORT_BIAS']);
const VALID=new Set([...BIAS,'NEUTRAL']);
const validTime=x=>Number.isSafeInteger(x)&&x>0;
const validPrice=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const roundBps=x=>Math.round(x*100)/100;
const sign=d=>d==='LONG_BIAS'?1:-1;
const favorable=(bps)=>bps>0?'FAVORABLE':bps<0?'ADVERSE':'FLAT';
export const V110_EARLY_REVERSAL_SHADOW_POLICY=Object.freeze({
 version:'v110-1m-leads-5m-early-reversal-shadow-v1',
 minSamplesForDescriptivePct:20,
 futureOnly5mCandles:2,
 horizonsMinutes:[5,10,15],
 chartSamplesAreSelectedNotRandom:true,
 oneMinuteDirectionNotTradePermission:true,
 noImagesDownloaded:true,noPaidModels:true,noNewWEEXRequests:true,
 noLiveAlerts:true,noStrategyChanges:true,ordersSent:0
});

// Returns null unless every input is complete and cross-timeframe divergence
// really existed at the prediction time. May also classify 1m-leading 10m,
// but only the 1m-leading-5m class is evaluated as an 'early' 5m candidate.
export function detectEarlyOneMinuteCandidate(forecast,at=Date.now()){
 if(!forecast?.available||forecast.exchange!=='WEEX'||
  !Array.isArray(forecast.timeframes)||
  forecast.timeframes.map(x=>x?.intervalMinutes).join(',')!=='1,5,10'||
  !validTime(at))return null;
 const [one,five,ten]=forecast.timeframes;
 if(!BIAS.has(one.direction)||!VALID.has(five.direction)||
  !VALID.has(ten.direction)||!
  [one,five,ten].every(x=>validTime(x.closedAt)&&x.closedAt<=at)||
  !validPrice(one.price)||at-one.closedAt>120_000||
  at-five.closedAt>11*MIN||at-ten.closedAt>11*MIN)
  return null;
 if(five.direction===one.direction&&ten.direction===one.direction)return null;
 const firstFiveLag=five.direction!==one.direction;
 const kind=firstFiveLag?
  (five.direction==='NEUTRAL'?'ONE_MINUTE_LEADS_NEUTRAL_FIVE':
   'ONE_MINUTE_OPPOSES_FIVE'):
  'ONE_AND_FIVE_AHEAD_OF_TEN';
 // We measure 5m reversal class separately from 10m-only late alignment.
 const supportedKind=['ONE_MINUTE_LEADS_NEUTRAL_FIVE',
  'ONE_MINUTE_OPPOSES_FIVE','ONE_AND_FIVE_AHEAD_OF_TEN'].includes(kind);
 if(!supportedKind)return null;
 return {kind,at,symbol:forecast.symbol,
  bias:one.direction,oneMinuteBody:one.lastCandleBody||'UNKNOWN',
  fiveMinuteBiasAtPrediction:five.direction,
  tenMinuteBiasAtPrediction:ten.direction,
  oneMinuteRsi:typeof one.rsi14==='number'?one.rsi14:null,
  fiveMinuteRsi:typeof five.rsi14==='number'?five.rsi14:null,
  refPrice:one.price,oneClosedAt:one.closedAt,
  fiveClosedAt:five.closedAt,tenClosedAt:ten.closedAt,
  risk:'UNVALIDATED_EARLY_REVERSAL_HYPOTHESIS',
  headlinePermission:false,noTrade:true};
}
// Require full FUTURE 5m candles whose OPEN is after the prediction.
// Partial 5m candle containing notification is excluded, as are unseen gaps.
export function evaluateEarlyTwoFullFuture5m(candidate,oneMinuteBars,now=Date.now()){
 const out={mode:'V110_EARLY_1M_TWO_FULL_5M_SHADOW',
  status:'INVALID_INPUT',noTrade:true,ordersSent:0,
  firstFull5m:null,secondFull5m:null,twoCandleConfirmation:null};
 if(!candidate||!BIAS.has(candidate.bias)||!validTime(candidate.at)||
  !validPrice(candidate.refPrice)||!Array.isArray(oneMinuteBars)||
  !validTime(now))return out;
 const start=Math.ceil(candidate.at/FIVE)*FIVE;
 const byTime=new Map();
 for(const b of oneMinuteBars){
  if(!validTime(b?.time)||b.time<start||
   b.time+MIN>now-1000||!validPrice(b.open)||!validPrice(b.close))continue;
  byTime.set(b.time,b);
 }
 const windows=[];
 for(let w=0;w<2;w++){
  const candleStarts=Array.from({length:5},(_,i)=>start+w*FIVE+i*MIN);
  if(candleStarts.some(t=>!byTime.has(t))){
   windows.push({status:'PENDING_OR_MISSING'});continue;
  }
  const candles=candleStarts.map(t=>byTime.get(t));
  const dirMove=roundBps(sign(candidate.bias)*
    (candles[4].close/candles[0].open-1)*10000);
  const closeMove=roundBps(sign(candidate.bias)*
    (candles[4].close/candidate.refPrice-1)*10000);
  windows.push({status:'OBSERVED',signedBodyBps:dirMove,
   signedCloseVsPredictionBps:closeMove,
   bodyResult:favorable(dirMove),
   closeAt:candleStarts[4]+MIN});
 }
 const complete=windows.every(x=>x.status==='OBSERVED');
 return {...out,status:complete?'OBSERVED':'PENDING_OR_MISSING',
  candidateKind:candidate.kind,referenceAt:candidate.at,
  firstCompleteFiveMinuteCandleStartAt:start,
  firstFull5m:windows[0],secondFull5m:windows[1],
  twoCandleConfirmation:complete?
   (windows[0].signedBodyBps>0&&windows[1].signedBodyBps>0&&
    windows[1].signedCloseVsPredictionBps>0):null,
  note:'Two entire 5m candle bodies after the frozen observation; no trade fill, independent accuracy or profit.'};
}
export function summarizeEarlyOneMinuteStudies(rows){
 const good=Array.isArray(rows)?rows.filter(x=>x?.mode==='V110_EARLY_1M_TWO_FULL_5M_SHADOW'):[];
 const result={mode:'V110_EARLY_1M_PROSPECTIVE_SHADOW_AGGREGATE',
  observations:good.length,noLiveChanges:true,readyForPromotion:false,
  samplesSelectedByOwner:true,byKind:{}};
 for(const kind of ['ONE_MINUTE_OPPOSES_FIVE',
  'ONE_MINUTE_LEADS_NEUTRAL_FIVE','ONE_AND_FIVE_AHEAD_OF_TEN']){
  const r=good.filter(x=>x.candidateKind===kind);
  const observed=r.filter(x=>x.status==='OBSERVED');
  const both=observed.filter(x=>x.twoCandleConfirmation===true).length;
  result.byKind[kind]={total:r.length,observed:observed.length,
   pendingOrMissing:r.length-observed.length,
   twoFull5mConfirmed:both,
   confirmedPct:observed.length>=20?
    Math.round(1000*both/observed.length)/10:null};
 }
 return result;
}
