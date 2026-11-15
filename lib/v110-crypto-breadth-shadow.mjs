// №110 read-only market breadth from forecast observations ALREADY fetched.
// Do NOT mix FX, equity, gold/silver with the CRYPTO breadth denominator.
// Source is last FULLY CLOSED 5m WEEX candle for 16 crypto assets within
// an existing 10-minute forecast scan of ALL 32 Radar instruments.
// No new fetches, notifications, storage, model weights, trade decisions.
import {marketForecastProfile,profileSymbols} from './market-forecast-profiles.mjs';
const MIN=60000,FIVE=5*MIN,valid=n=>typeof n==='number'&&Number.isFinite(n);
const CRYPTO_GROUPS=new Set(['MAJOR_CRYPTO','ALT_CRYPTO','MEME_CRYPTO']);
const all=profileSymbols();
const crypto=all.filter(s=>CRYPTO_GROUPS.has(marketForecastProfile(s)?.group));
if(all.length!==32||crypto.length!==16)throw Error('V110_BREADTH_UNIVERSE_NOT_32_16');
const round=(n,digits=2)=>Number(n.toFixed(digits));
const median=rows=>{
 if(!rows.length)return null;
 const sorted=rows.slice().sort((a,b)=>a-b),n=sorted.length;
 return round(n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2);
};
const scoreBps=n=>n>0?'UP':n<0?'DOWN':'FLAT';
const isDirection=d=>d==='LONG_BIAS'||d==='SHORT_BIAS';
export const V110_CRYPTO_BREADTH_POLICY=Object.freeze({
 version:'v110-crypto16-breadth-same-scan-v1',
 allRadarInstruments:32,
 actualCryptoInstruments:16,
 cryptoGroupNames:['MAJOR_CRYPTO','ALT_CRYPTO','MEME_CRYPTO'],
 input:'EXISTING_10M_FORECAST_SCAN_ALREADY_FETCHED_CLOSED_WEEX_5M_CANDLES',
 coverageForRegime:'ALL_16_VALID_AND_SAME_5M_CLOSE',
 regimeRule:'AT_LEAST_12_OF_16_5M_CANDLE_BODIES_SAME_SIGN',
 thresholdFixedNotOptimized:true,
 noNewsOrFearIndexReadings:true,
 noClaimsAbout24hBubbleReturns:true,
 noNewRequests:true,noNewCron:true,noNewStorage:true,
 noLiveFilters:true,noAlerts:true,noOrders:true,noPaidApi:true,
 notPredictiveAccuracy:true
});
function validSnapshot(d,now){
 if(!d||d.available!==true||d.exchange!=='WEEX'||
  !crypto.includes(d.symbol)||!Array.isArray(d.timeframes)||
  d.timeframes.map(t=>t?.intervalMinutes).join(',')!=='1,5,10')return false;
 const [one,five,ten]=d.timeframes;
 if([one,five,ten].some(t=>!Number.isSafeInteger(t.closedAt)||
  t.closedAt<=0||t.closedAt>now))return false;
 if(now-one.closedAt>2*MIN||now-five.closedAt>11*MIN||
  now-ten.closedAt>11*MIN)return false;
 if(five.closedAt%FIVE!==0)return false;
 if(!valid(five.lastCandleBodyBps)||Math.abs(five.lastCandleBodyBps)>10000)return false;
 if(!['LONG_BIAS','SHORT_BIAS','NEUTRAL'].includes(one.direction)||
  !['LONG_BIAS','SHORT_BIAS','NEUTRAL'].includes(five.direction))return false;
 return true;
}
function groupSummary(rows,group){
 const included=rows.filter(x=>marketForecastProfile(x.symbol)?.group===group);
 const changes=included.map(x=>x.timeframes[1].lastCandleBodyBps);
 return {expected:crypto.filter(s=>marketForecastProfile(s)?.group===group).length,
  observed:included.length,
  fiveMinuteCandlesUp:changes.filter(n=>n>0).length,
  fiveMinuteCandlesDown:changes.filter(n=>n<0).length,
  flat:changes.filter(n=>n===0).length,
  medianClosedFiveMinuteBodyBps:median(changes)};
}
export function summarizeV110CryptoBreadth(snapshots,now=Date.now()){
 const report={mode:'V110_CRYPTO16_MARKET_BREADTH_SHADOW',
  policy:V110_CRYPTO_BREADTH_POLICY,
  status:'INSUFFICIENT_CONCURRENT_CLOSED_BARS',
  observedAt:now,
  universe:{radarTotal:32,cryptoTotal:16,nonCryptoTotal:16,
   eligibleGroups:['MAJOR_CRYPTO','ALT_CRYPTO','MEME_CRYPTO']},
  eligibleCryptoObservations:0,missingCryptoCount:16,
  invalidOrDuplicateCrypto:0,cohortClosedAt:null,
  closed5m:{up:0,down:0,flat:0,medianBodyBps:null,regime:'UNKNOWN',
   upPct:null,downPct:null},
  fiveMinuteIndicatorBias:{long:0,short:0,neutral:0},
  oneMinuteOpposesFiveMinute:0,oneMinuteLeadsNeutralFiveMinute:0,
  majorMarket:{btc5mBodyBps:null,eth5mBodyBps:null,
   btcFiveBias:'UNKNOWN',ethFiveBias:'UNKNOWN'},
  byGroup:{},xrpRelativeToCryptoMedianBps:null,
  noTrade:true,ordersSent:0,changesToLiveRadar:0,paidApiCalls:0,
  warning:'Only 16 of 32 Radar instruments are crypto. This samples one fully closed WEEX 5m body per crypto market on the existing 10m forecast scan. Not the Crypto Bubbles 24h period, market capitalization, Fear & Greed index, market-wide universe or future performance.'};
 if(!Array.isArray(snapshots)||!Number.isSafeInteger(now)||now<=0)
  return {...report,status:'INVALID_INPUT'};
 const seen=new Set(),accepted=[];
 for(const d of snapshots){
  if(!d||!crypto.includes(d.symbol))continue;
  if(seen.has(d.symbol)){report.invalidOrDuplicateCrypto++;continue}
  seen.add(d.symbol);
  if(validSnapshot(d,now))accepted.push(d);
  else report.invalidOrDuplicateCrypto++;
 }
 // Never combine 5m candle closes belonging to different time boundaries.
 const byClose=new Map();
 for(const d of accepted){
  const close=d.timeframes[1].closedAt;
  if(!byClose.has(close))byClose.set(close,[]);
  byClose.get(close).push(d);
 }
 // Most common existing 5m boundary, deterministically choose latest on tie.
 const ordered=[...byClose].sort((a,b)=>b[1].length-a[1].length||b[0]-a[0]);
 const group=ordered[0]?.[1]||[];
 report.cohortClosedAt=ordered[0]?.[0]||null;
 report.eligibleCryptoObservations=group.length;
 report.missingCryptoCount=16-group.length;
 const five=group.map(d=>d.timeframes[1]);
 const changes=five.map(t=>t.lastCandleBodyBps);
 report.closed5m.up=changes.filter(x=>x>0).length;
 report.closed5m.down=changes.filter(x=>x<0).length;
 report.closed5m.flat=changes.filter(x=>x===0).length;
 report.closed5m.medianBodyBps=median(changes);
 for(const t of five){
  if(t.direction==='LONG_BIAS')report.fiveMinuteIndicatorBias.long++;
  else if(t.direction==='SHORT_BIAS')report.fiveMinuteIndicatorBias.short++;
  else report.fiveMinuteIndicatorBias.neutral++;
 }
 for(const d of group){
  const [one,five]=d.timeframes;
  if(isDirection(one.direction)&&isDirection(five.direction)&&
   one.direction!==five.direction)report.oneMinuteOpposesFiveMinute++;
  if(isDirection(one.direction)&&five.direction==='NEUTRAL')
   report.oneMinuteLeadsNeutralFiveMinute++;
 }
 for(const g of ['MAJOR_CRYPTO','ALT_CRYPTO','MEME_CRYPTO'])
  report.byGroup[g]=groupSummary(group,g);
 const btc=group.find(d=>d.symbol==='BTCUSDT'),eth=group.find(d=>d.symbol==='ETHUSDT');
 report.majorMarket={
  btc5mBodyBps:btc?.timeframes[1].lastCandleBodyBps??null,
  eth5mBodyBps:eth?.timeframes[1].lastCandleBodyBps??null,
  btcFiveBias:btc?.timeframes[1].direction||'UNKNOWN',
  ethFiveBias:eth?.timeframes[1].direction||'UNKNOWN'};
 const xrp=group.find(d=>d.symbol==='XRPUSDT');
 if(xrp&&report.closed5m.medianBodyBps!==null)
  report.xrpRelativeToCryptoMedianBps=round(
   xrp.timeframes[1].lastCandleBodyBps-report.closed5m.medianBodyBps);
 // Fail closed on incomplete breadth; never infer 12/16 majority if only
 // a selectively available, biased subset of 16 markets was readable.
 if(group.length!==16)return {...report,status:'INCOMPLETE_CRYPTO16_COHORT'};
 report.status='COMPLETE_CRYPTO16_SAME_5M_CLOSE';
 report.closed5m.upPct=round(100*report.closed5m.up/16,1);
 report.closed5m.downPct=round(100*report.closed5m.down/16,1);
 report.closed5m.regime=report.closed5m.down>=12?'BROAD_CRYPTO16_DOWN_5M':
  report.closed5m.up>=12?'BROAD_CRYPTO16_UP_5M':'MIXED_CRYPTO16_5M';
 return report;
}
