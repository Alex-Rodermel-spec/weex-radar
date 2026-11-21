// №110 prospective EARLY versus ALIGNED control: freeze BEFORE the future move.
// Reuses the existing 20m OIDC journal writer and 16-crypto 1m market data.
// Sample four crypto markets per 20m job: <=8 *additional* PUBLIC WEEX
// 1m/5m reads, no paid API, new cron, ntfy or trading privileges.
// The recorded control is an observed aligned state, NOT necessarily a
// delivered forecast. Missing/late data is UNKNOWN, never a fictitious win.
import {profileSymbols,marketForecastProfile} from './market-forecast-profiles.mjs';
import {readStandaloneForecast} from './standalone-forecast.mjs';
import {detectEarlyOneMinuteCandidate} from './v110-early-reversal-shadow.mjs';
import {freezeV5Independent} from './v110-v5-independent-journal.mjs';
import {freezeV110ForwardReceipt,scoreV110FrozenForwardReceipt}
 from './v110-forward-receipts.mjs';

const MIN=60_000,DAY=86_400_000;
const SOURCE='V110_OIDC_20M_SAMPLED_16_CRYPTO';
const KINDS=['ONE_MINUTE_OPPOSES_FIVE','ONE_MINUTE_LEADS_NEUTRAL_FIVE',
 'ONE_AND_FIVE_AHEAD_OF_TEN','THREE_TIMEFRAME_ALIGNMENT_CONTROL'];
const HORIZONS=[5,10,15];
const SYMBOLS=profileSymbols().filter(s=>marketForecastProfile(s)?.group.endsWith('CRYPTO'));
const ALLOWED=new Set(SYMBOLS), VALID_KINDS=new Set(KINDS);
const BIASES=new Set(['LONG_BIAS','SHORT_BIAS']);
const good=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const signed=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=10_000;
const clock=x=>Number.isSafeInteger(x)&&x>0;
const round=x=>Math.round(x*100)/100;
const rate=(n,d)=>d?Math.round(n/d*1000)/10:null;
const empty=()=>({status:'PENDING',signedBps:null});
const day=t=>new Date(t).toISOString().slice(0,10);
export const V110_EARLY_CONTROL_LIMIT=3500;
export const V110_EARLY_CONTROL_DAYS=14;
export const V110_EARLY_CONTROL_POLICY=Object.freeze({
 version:'v110-oidc-16crypto-rotating4-forward-v1',source:SOURCE,
 universeMarkets:16,sampledMarketsPer20m:4,
 extraPublicWeexKlineRequestsPerRunMax:8,
 usesExisting20mGitHubOIDC:true,
 usesExistingCryptoMinuteBarsForScoring:true,
 lookaheadAllowed:false,tradeGateChanges:0,noPaidServices:true,
 noNewCron:true,noNewNtfy:true,noOrders:true,
 horizonMinutes:HORIZONS,
 controlClass:'THREE_TIMEFRAME_ALIGNMENT_CONTROL_NOT_PROVEN_PHONE_DELIVERY',
 minimumGroupObserved:30,minimumGroupDays:3,
 minimumValidationDays:5,minimumValidationSymbols:3,
 requiresProspectiveUnseenRegime:true,automaticPromotion:false
});
if(SYMBOLS.length!==16)throw Error('V110_EARLY_CONTROL_EXPECTED_16_CRYPTO');

function normalize(row,now=Date.now()){
 if(!row||row.source!==SOURCE||!/^[a-f0-9]{24}$/.test(row.id||'')||
  !ALLOWED.has(row.symbol)||!VALID_KINDS.has(row.kind)||
  !BIASES.has(row.direction)||!good(row.referencePrice)||
  !clock(row.frozenAt)||row.frozenAt>now||
  row.frozenAt<=now-V110_EARLY_CONTROL_DAYS*DAY||
  !clock(row.oneClosedAt)||!clock(row.fiveClosedAt)||!clock(row.tenClosedAt)||
  row.oneClosedAt>row.frozenAt||row.fiveClosedAt>row.frozenAt||
  row.tenClosedAt>row.frozenAt||!row.horizons)return null;
 const horizons={};
 for(const h of HORIZONS){
  const x=row.horizons[h];
  if(!x||!['PENDING','NO_DATA','OBSERVED'].includes(x.status)||
   (x.status==='OBSERVED'?!signed(x.signedBps):x.signedBps!==null))
   return null;
  horizons[h]={status:x.status,
   signedBps:x.status==='OBSERVED'?round(x.signedBps):null};
 }
 return {source:SOURCE,id:row.id,symbol:row.symbol,
  kind:row.kind,direction:row.direction,
  referencePrice:row.referencePrice,frozenAt:row.frozenAt,
  oneClosedAt:row.oneClosedAt,fiveClosedAt:row.fiveClosedAt,
  tenClosedAt:row.tenClosedAt,
  horizons};
}
const newRow=(r,now)=>normalize({...r,source:SOURCE,
 horizons:Object.fromEntries(HORIZONS.map(h=>[h,empty()]))},now);

// Each market is selected independent of its future path or predicted side.
// Selection is fixed by wall-clock 20m slot and stable 16-crypto symbol order.
export function sampledV110EarlySymbols(now=Date.now()){
 if(!clock(now))return [];
 const start=(Math.floor(now/(20*MIN))*4)%SYMBOLS.length;
 return Array.from({length:4},(_,i)=>SYMBOLS[(start+i)%SYMBOLS.length]);
}
export async function collectV110EarlyControl(now=Date.now(),{
 reader=readStandaloneForecast,fetchImpl=fetch
}={}){
 const sample=sampledV110EarlySymbols(now);
 const base={status:'UNAVAILABLE',sampledAt:now,
  sampled:sample.length,valid:0,failed:0,early:0,control:0,
  fresh:[],v5Fresh:[],ordersSent:0,extraRequestsMax:8};
 if(!sample.length)return base;
 const fresh=[],v5Fresh=[],failed={count:0},valid={count:0};
 const results=await Promise.allSettled(sample.map(symbol=>
  reader(symbol,{fetchImpl,now})));
 for(let i=0;i<results.length;i++){
  const x=results[i];if(x.status!=='fulfilled'){failed.count++;continue;}
  const d=x.value;
  if(d?.available!==true||d.exchange!=='WEEX'||d.symbol!==sample[i]||
   !Array.isArray(d.timeframes)||d.timeframes.length!==3){
   failed.count++;continue;
  }
  const [one,five,ten]=d.timeframes;
  // Never train on a 5m regime based on a candle older than the latest
  // fully closed 5m at publication. The 1m is also genuinely recent.
  if(five.closedAt!==Math.floor((now-1000)/(5*MIN))*5*MIN||
   !clock(one.closedAt)||one.closedAt>now||now-one.closedAt>2*MIN||
   !clock(ten.closedAt)||now-ten.closedAt>11*MIN){
   failed.count++;continue;
  }
  valid.count++;
  // Freeze V5 on the same sampled closed-bar observations, INCLUDING
  // cases when the legacy algorithm is MIXED or no early kind exists.
  // This adds NO WEEX requests, ntfy sends or trade effects.
  const v5=freezeV5Independent(d,now);
  if(v5)v5Fresh.push(v5);
  const early=detectEarlyOneMinuteCandidate(d,now);
  const kind=early?.kind||
   (one.direction!=='NEUTRAL'&&one.direction===five.direction&&
    one.direction===ten.direction?
    'THREE_TIMEFRAME_ALIGNMENT_CONTROL':null);
  if(!kind||!VALID_KINDS.has(kind))continue;
  const r=freezeV110ForwardReceipt(d,kind,now);
  if(!r)continue;
  const frozen=newRow(r,now);
  if(frozen)fresh.push(frozen);
 }
 return {...base,status:failed.count?'PARTIAL_SAMPLED_SCAN':'SAMPLED_4_CRYPTO',
  valid:valid.count,failed:failed.count,fresh,v5Fresh,
  early:fresh.filter(r=>r.kind!=='THREE_TIMEFRAME_ALIGNMENT_CONTROL').length,
  control:fresh.filter(r=>r.kind==='THREE_TIMEFRAME_ALIGNMENT_CONTROL').length};
}

// Reuse the EXACT already-tested frozen-receipt future-close scorer.
// Do not recalculate past EMA/RSI using a later bar; only the frozen direction.
export function mergeV110EarlyControl(previous,fresh,candles,now=Date.now()){
 if(!Array.isArray(previous)||!Array.isArray(fresh)||
  previous.length>V110_EARLY_CONTROL_LIMIT||fresh.length>4||!clock(now))
  throw Error('V110_EARLY_CONTROL_BAD_INPUT');
 const map=new Map();let added=0,updated=0,dropped=0;
 for(const x of previous){
  const r=normalize(x,now);
  if(!r){dropped++;continue}
  if(!map.has(r.id))map.set(r.id,r);
 }
 for(const x of fresh){
  const r=normalize(x,now);
  if(r&&!map.has(r.id)){map.set(r.id,r);added++}
 }
 for(const r of map.values()){
  const series=candles instanceof Map?candles.get(r.symbol):null;
  // A missing market feed can't count as a future win; beyond 125m it
  // becomes NO_DATA rather than remaining PENDING forever.
  const scored=Array.isArray(series)?
   scoreV110FrozenForwardReceipt(r,series,now):null;
  for(const h of HORIZONS){
   if(r.horizons[h].status!=='PENDING')continue;
   const x=scored?.horizons?.[h];
   if(x?.status==='OBSERVED'&&signed(x.signedBps)){
    r.horizons[h]={status:'OBSERVED',signedBps:round(x.signedBps)};
    updated++;
   }else if(now-r.frozenAt>=125*MIN){
    r.horizons[h]={status:'NO_DATA',signedBps:null};
    updated++;
   }
  }
 }
 const ordered=[...map.values()].sort((a,b)=>b.frozenAt-a.frozenAt||
  a.id.localeCompare(b.id));
 if(ordered.length>V110_EARLY_CONTROL_LIMIT){
  dropped+=ordered.length-V110_EARLY_CONTROL_LIMIT;
  ordered.length=V110_EARLY_CONTROL_LIMIT;
 }
 return {rows:ordered,changed:added>0||updated>0||dropped>0,
  added,updated,dropped};
}
function group(rows,now){
 const horizons={};
 for(const h of HORIZONS){
  const mature=rows.filter(r=>r.frozenAt+(h+2)*MIN<=now);
  const observations=mature.filter(r=>r.horizons[h].status==='OBSERVED');
  const favorable=observations.filter(r=>r.horizons[h].signedBps>0).length;
  const adverse=observations.filter(r=>r.horizons[h].signedBps<0).length;
  const distinctDays=new Set(observations.map(r=>day(r.frozenAt))).size;
  const n=observations.length;
  horizons[h]={matured:mature.length,observed:n,
   favorable,adverse,flat:n-favorable-adverse,
   pending:mature.filter(r=>r.horizons[h].status==='PENDING').length,
   noData:mature.filter(r=>r.horizons[h].status==='NO_DATA').length,
   distinctUtcDays:distinctDays,coveragePct:rate(n,mature.length),
   favorablePctDescriptive:n>=30&&distinctDays>=3?rate(favorable,n):null,
   meanSignedBpsDescriptive:n>=30&&distinctDays>=3?
    round(observations.reduce((s,r)=>s+r.horizons[h].signedBps,0)/n):null};
 }
 return {total:rows.length,horizons};
}
function panel(rows,now){
 const byKind=Object.fromEntries(KINDS.map(k=>[k,
  group(rows.filter(r=>r.kind===k),now)]));
 const early=rows.filter(r=>r.kind!=='THREE_TIMEFRAME_ALIGNMENT_CONTROL');
 const aligned=rows.filter(r=>r.kind==='THREE_TIMEFRAME_ALIGNMENT_CONTROL');
 const byDirection=Object.fromEntries(['LONG_BIAS','SHORT_BIAS'].map(d=>[d,{
  early:group(early.filter(r=>r.direction===d),now),
  control:group(aligned.filter(r=>r.direction===d),now)
 }]));
 return {all:group(rows,now),early:group(early,now),
  control:group(aligned,now),byKind,byDirection};
}
export function summarizeV110EarlyControl(rows,now=Date.now()){
 const base={mode:'V110_EARLY_VS_ALIGNED_PROSPECTIVE_16_CRYPTO',
  status:'RESEARCH_ONLY',policy:V110_EARLY_CONTROL_POLICY,
  archiveDays:V110_EARLY_CONTROL_DAYS,ordersSent:0,
  live108Changed:false,noAlerts:true,accuracyImproved:false,
  promoteLive:false,recommendation:'KEEP_108',
  note:'Prospective, time-sampled four-of-sixteen crypto observations at the existing 20m job, NOT all minute triggers. Aligned CONTROL is not proven delivered to ntfy. Movement is future closed-candle direction, not fills, profit or a risk-adjusted win rate. Coin selection rotates; samples can still be correlated.'};
 if(!Array.isArray(rows)||rows.length>V110_EARLY_CONTROL_LIMIT||!clock(now))
  return {...base,status:'INVALID_INPUT'};
 const clean=[],ids=new Set();
 for(const r of rows){
  const x=normalize(r,now);
  if(x&&!ids.has(x.id)){clean.push(x);ids.add(x.id)}
 }
 const days=[...new Set(clean.map(r=>day(r.frozenAt)))].sort();
 const full=panel(clean,now);
 // Fixed chronological holdout by complete UTC days. Show descriptive
 // contrast, but require a separate unseen prospective test before ANY gate.
 let split=null;
 if(days.length>=5){
  const cutoff=days[days.length-2];
  const train=panel(clean.filter(r=>day(r.frozenAt)<cutoff),now);
  const holdout=panel(clean.filter(r=>day(r.frozenAt)>=cutoff),now);
  const a=holdout.early.horizons[15],b=holdout.control.horizons[15];
  split={trainDays:days.length-2,holdoutStartUtcDay:cutoff,
   train,holdout,
   holdoutEarlyMinusControl15mPp:
    a.favorablePctDescriptive!==null&&b.favorablePctDescriptive!==null?
    round(a.favorablePctDescriptive-b.favorablePctDescriptive):null,
   note:'Same sampled hour slots, but not randomized and not trade fills.'};
 }
 return {...base,archivedCandidates:clean.length,distinctUtcDays:days.length,
  full,split,independentProspectiveProof:false};
}
