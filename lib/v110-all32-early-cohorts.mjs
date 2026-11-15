// №110: representative SAME-SCAN 1m-leading-5m candidate census across all
// 32 configured WEEX instruments. Consumes existing read-only forecast data
// every normal 10m snapshot, INCLUDING UNSENT / neutral 5m cases.
// No forecasts, alert routing, outcomes, storage, polling or trade decisions.
import {detectEarlyOneMinuteCandidate} from './v110-early-reversal-shadow.mjs';
import {freezeV110ForwardReceipt} from './v110-forward-receipts.mjs';
import {marketForecastProfile,profileSymbols} from './market-forecast-profiles.mjs';

const MIN=60_000,FIVE=5*MIN;
const SYMBOLS=profileSymbols(),ALLOWED=new Set(SYMBOLS);
const KINDS=['ONE_MINUTE_OPPOSES_FIVE','ONE_MINUTE_LEADS_NEUTRAL_FIVE',
 'ONE_AND_FIVE_AHEAD_OF_TEN'];
const GROUPS=['MAJOR_CRYPTO','ALT_CRYPTO','MEME_CRYPTO','METALS',
 'FX_DERIVED','EQUITY_DERIVED'];
const BIAS=new Set(['LONG_BIAS','SHORT_BIAS','NEUTRAL']);
const emptySides=()=>({LONG:0,SHORT:0});
const emptyKinds=()=>Object.fromEntries(KINDS.map(k=>[k,{total:0,...emptySides()}]));
const label=direction=>direction==='LONG_BIAS'?'LONG':'SHORT';
export const V110_ALL32_EARLY_COHORT_POLICY=Object.freeze({
 version:'v110-all32-concurrent-early-1m-vs-5m-census-v1',
 configuredInstruments:32,
 groupSizes:{MAJOR_CRYPTO:2,ALT_CRYPTO:11,MEME_CRYPTO:3,
  METALS:3,FX_DERIVED:6,EQUITY_DERIVED:7},
 source:'EXISTING_10MIN_FORECAST_SCAN_ALL_AVAILABLE_UNSENT_SNAPSHOTS',
 fiveMinuteCloseRule:'LATEST_EXPECTED_FULLY_CLOSED_5M_CANDLE',
 oneMinuteLeadsNeutralFiveCounted:true,
 comparisonsAreAtOneTimeOnly:true,
 futureOutcomesNotMeasured:true,
 noNewNetworkRequests:true,noNewCron:true,noNewStorage:true,
 noNewAlerts:true,noLiveSignalsChanged:true,noPaidModels:true,
 ordersSent:0,trainingWeightsChanged:false
});
function validSnapshot(d,now,latest5m){
 if(!d||!ALLOWED.has(d.symbol)||d.available!==true||
  d.exchange!=='WEEX'||!Array.isArray(d.timeframes)||
  d.timeframes.map(x=>x?.intervalMinutes).join(',')!=='1,5,10')return false;
 const [one,five,ten]=d.timeframes;
 if([one,five,ten].some(x=>!BIAS.has(x.direction)||
  !Number.isSafeInteger(x.closedAt)||x.closedAt<=0||x.closedAt>now))
  return false;
 // Trend forecasting can use 5m bars several minutes old. An EARLY
 // cross-timeframe observation must not be based on a stale 5m candle.
 if(five.closedAt!==latest5m||now-one.closedAt>2*MIN||
  now-ten.closedAt>11*MIN)return false;
 return true;
}
export function summarizeV110All32EarlyCohorts(snapshots,now=Date.now()){
 const expectedClose=Number.isSafeInteger(now)&&now>0?
  Math.floor((now-1000)/FIVE)*FIVE:null;
 const result={mode:'V110_ALL32_1M_EARLY_REVERSAL_CENSUS',
  policy:V110_ALL32_EARLY_COHORT_POLICY,
  sampledAt:now,expected5mCloseAt:expectedClose,
  status:'INVALID_INPUT',universe:32,submittedSnapshots:0,
  validSameClose:0,missingOrStale:32,duplicateSymbols:0,
  oneMinuteBias:{long:0,short:0,neutral:0},
  fiveMinuteBias:{long:0,short:0,neutral:0},
  candidateKinds:emptyKinds(),totalEarlyCandidates:0,
  fullThreeTimeframeAlignment:0,oneMinuteNeutral:0,
  byGroup:Object.fromEntries(GROUPS.map(g=>[g,{
   expected:V110_ALL32_EARLY_COHORT_POLICY.groupSizes[g],
   observed:0,earlyCandidates:0,leadsNeutralFive:0,opposesFive:0
  }])),
  frozenForwardReceipts:[],receiptsFrozenCount:0,
  noFutureCandleUsed:true,prospectiveOutcomesMeasured:false,
  noLiveEffect:true,noTrade:true,ordersSent:0,
  caveat:'A single concurrent 10-minute sample, not minute-by-minute capture, not subsequent accuracy or a trade. Missing/stale markets are UNKNOWN; no denominator inflation. Selected ntfy screenshots are a separate biased channel.'};
 if(!Array.isArray(snapshots)||!Number.isSafeInteger(now)||now<=0||
  SYMBOLS.length!==32)return result;
 result.submittedSnapshots=snapshots.length;
 const groups=new Map();
 for(const d of snapshots){
  if(!ALLOWED.has(d?.symbol))continue;
  if(!groups.has(d.symbol))groups.set(d.symbol,[]);
  groups.get(d.symbol).push(d);
 }
 for(const [symbol,items] of groups){
  if(items.length!==1){result.duplicateSymbols++;continue;}
  const d=items[0];
  if(!validSnapshot(d,now,expectedClose))continue;
  const [one,five,ten]=d.timeframes;
  result.validSameClose++;
  const category=marketForecastProfile(symbol)?.group;
  const group=result.byGroup[category];
  if(!group)continue;
  group.observed++;
  if(one.direction==='LONG_BIAS')result.oneMinuteBias.long++;
  else if(one.direction==='SHORT_BIAS')result.oneMinuteBias.short++;
  else result.oneMinuteBias.neutral++;
  if(five.direction==='LONG_BIAS')result.fiveMinuteBias.long++;
  else if(five.direction==='SHORT_BIAS')result.fiveMinuteBias.short++;
  else result.fiveMinuteBias.neutral++;
  const early=detectEarlyOneMinuteCandidate(d,now);
  if(early&&KINDS.includes(early.kind)){
   const item=result.candidateKinds[early.kind];
   item.total++;item[label(early.bias)]++;
   result.totalEarlyCandidates++;group.earlyCandidates++;
   const frozen=freezeV110ForwardReceipt(d,early.kind,now);
   if(frozen)result.frozenForwardReceipts.push(frozen);
   if(early.kind='ONE_MINUTE_LEADS_NEUTRAL_FIVE')group.leadsNeutralFive++;
   if(early.kind==='ONE_MINUTE_OPPOSES_FIVE')group.opposesFive++;
  }else if(one.direction==='NEUTRAL')result.oneMinuteNeutral++;
  else if(one.direction===five.direction&&one.direction===ten.direction&&
   one.direction!=='NEUTRAL'){
   result.fullThreeTimeframeAlignment++;
   const baseline=freezeV110ForwardReceipt(d,'THREE_TIMEFRAME_ALIGNMENT_CONTROL',now);
   if(baseline)result.frozenForwardReceipts.push(baseline);
  }
 }
 result.missingOrStale=32-result.validSameClose;
 result.receiptsFrozenCount=result.frozenForwardReceipts.length;
 result.status=result.validSameClose===32&&result.duplicateSymbols===0?
  'COMPLETE_32_CLOSED_5M':'INCOMPLETE_32_CLOSED_5M';
 return result;
}
