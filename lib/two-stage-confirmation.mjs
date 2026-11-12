// WEEX RADAR: an ordinary pre-break forecast must precede a STRONG 5m alert.
// The matching proof is a REAL previously published ntfy message, not an
// indicator assumption or a replayed scenario reconstructed after the fact.
// Fail closed: missing history/evidence DOWNGRADES strength, never creates orders.
import {createHash} from 'node:crypto';
import {marketForecastProfile} from './market-forecast-profiles.mjs';
import {normalizeV110Minutes,validateV110MinuteContinuation} from './v110-minute-continuation.mjs';

const MINUTE=60_000,TEN_MINUTES=10*MINUTE,WINDOW=15*MINUTE;
const MAX_HISTORY_BYTES=250_000;
const BASE='https://ntfy.sh/';
const valid=x=>typeof x==='number'&&Number.isFinite(x);
const RULES=Object.freeze({
 MAJOR_CRYPTO:Object.freeze({minVolumeRatio:1.15,maxFiveMinuteMoveBps:28}),
 ALT_CRYPTO:Object.freeze({minVolumeRatio:1.20,maxFiveMinuteMoveBps:45}),
 MEME_CRYPTO:Object.freeze({minVolumeRatio:1.30,maxFiveMinuteMoveBps:75}),
 METALS:Object.freeze({minVolumeRatio:1.10,maxFiveMinuteMoveBps:25}),
 FX_DERIVED:Object.freeze({minVolumeRatio:1.05,maxFiveMinuteMoveBps:15}),
 EQUITY_DERIVED:Object.freeze({minVolumeRatio:1.20,maxFiveMinuteMoveBps:45})
});
export const TWO_STAGE_POLICY=Object.freeze({
 version:'2026-11-12-v110-1m-post-early-confirmation',
 earlyWindowMinutes:15,
 directionTimeframe:'5m',
 strengthIsProbability:false,
 publicHistoryMaxBytes:MAX_HISTORY_BYTES,
 marketRules:RULES,
 noAutoTrade:true,ordersSent:0
});
const digest=s=>createHash('sha256').update(s).digest('hex').slice(0,32);
// EXACTLY the earlier ntfy "early PRE_BREAK" sequence hashing convention.
export function expectedPrebreakIds(signal){
 if(!signal||signal.exchange!=='WEEX'||!['LONG','SHORT'].includes(signal.direction)||
  !Number.isSafeInteger(signal.candleCloseTime))return [];
 const first=Math.floor((signal.candleCloseTime-WINDOW)/TEN_MINUTES);
 const last=Math.floor((signal.candleCloseTime-MINUTE)/TEN_MINUTES);
 const ids=[];
 for(let bucket=first;bucket<=last;bucket++)
  ids.push(digest('early|'+['WEEX',signal.symbol,signal.direction,
   'PRE_BREAK',bucket].join('|')));
 return ids;
}
function parseScenario(row,side){
 // ntfy sends rounded human readable levels. They are validation thresholds,
 // never executable order prices. Explicit directions prevent accidental swaps.
 const p=row.message.match(/^🔑 Подтверждение:\s*(выше|ниже)\s+([0-9]+(?:[.,][0-9]+)?)\s*$/mu);
 const c=row.message.match(/^❌ Отмена сценария:\s*(выше|ниже)\s+([0-9]+(?:[.,][0-9]+)?)\s*$/mu);
 if(!p||!c)return null;
 if((side==='LONG'&&(p[1]!=='выше'||c[1]!=='ниже'))||
    (side==='SHORT'&&(p[1]!=='ниже'||c[1]!=='выше')))return null;
 const trigger=Number(p[2].replace(',','.')),invalidation=Number(c[2].replace(',','.'));
 if(!valid(trigger)||!valid(invalidation)||trigger<=0||invalidation<=0||
    (side==='LONG'?trigger<=invalidation:trigger>=invalidation))
  return null;
 return {trigger,invalidation};
}
function linkedMessage(signal,rows,now){
 // Crucial: the newest *either direction* PRE_BREAK cancels the older
 // same-side forecast. We never use an older LONG to confirm after a newer SHORT.
 let latest=null;
 for(const row of rows){
  if(row?.event!=='message'||!Number.isSafeInteger(row.time)||
   typeof row.title!=='string'||typeof row.message!=='string')continue;
  const sentAt=row.time*1000;
  if(sentAt<signal.candleCloseTime-WINDOW||sentAt>=signal.candleCloseTime||
   sentAt>now)continue;
  for(const direction of ['LONG','SHORT']){
   const ids=new Set(expectedPrebreakIds({...signal,direction}));
   if(!ids.has(row.sequence_id)||
      !row.title.startsWith('🔮 ПРОГНОЗ · '+signal.symbol+' '+direction+' · 🔵 ОБЫЧНЫЙ'))
    continue;
   if(latest===null||sentAt>=latest.sentAt){
    latest={direction,sentAt,levels:parseScenario(row,direction)};
   }
  }
 }
 return latest;
}
export function classifyTwoStageConfirmation(signal,rows=[],now=Date.now(),minutes=null){
 if(!signal||signal.level!=='STRONG')return signal;
 const profile=marketForecastProfile(signal.symbol);
 const limits=RULES[profile?.group];
 const base={mode:'EARLY_THEN_CONFIRMED_5M',group:profile?.group||null,
  confirmedAt:signal.candleCloseTime||null,earlySentAt:null,
  observedEarlyAlert:false,noAutoTrade:true};
 const downgrade=reason=>({...signal,level:'NORMAL',
  twoStage:{...base,stage:'ORDINARY_5M',reason}});
 if(!limits||signal.exchange!=='WEEX'||signal.status!=='ok'||
  !['LONG','SHORT'].includes(signal.direction)||
  !Number.isSafeInteger(signal.candleCloseTime)||
  signal.candleCloseTime% (5*MINUTE)!==0||
  signal.candleCloseTime>now||now-signal.candleCloseTime>90_000)
  return downgrade('MISSING_FRESH_CLOSED_5M');
 // The existing scanner separately checks current quote, retest, R/R and costs.
 // Never let the extra label bypass those checks.
 if(signal.entryQuality?.ok!==true||signal.advisor?.status!=='REVIEW'||
  signal.costReview?.status!=='PASS_ESTIMATE'||
  signal.retest?.[signal.direction]?.status==='FAILED')
  return downgrade('ENTRY_NOT_VERIFIED');
 const volume=signal.indicators?.volumeRatio;
 const move=signal.closedFiveMinuteMoveBps;
 if(!valid(volume)||volume<limits.minVolumeRatio)
  return downgrade('VOLUME_NOT_CONFIRMED_FOR_GROUP');
 if(!valid(move)||move<0||move>limits.maxFiveMinuteMoveBps)
  return downgrade('FIVE_MINUTE_CANDLE_ALREADY_EXTENDED');
 const early=linkedMessage(signal,Array.isArray(rows)?rows:[],now);
 if(early===null)return downgrade('NO_PRIOR_DELIVERED_ORDINARY_FORECAST');
 if(early.direction!==signal.direction)
  return downgrade('LATER_OPPOSITE_EARLY_FORECAST');
 if(!early.levels)return downgrade('EARLY_SCENARIO_LEVELS_MISSING');
 const path=validateV110MinuteContinuation(signal,{
  sentAt:early.sentAt,...early.levels},minutes);
 if(!path.ok)return downgrade(path.reason);
 return {...signal,twoStage:{...base,stage:'CONFIRMED_AFTER_EARLY',
  observedEarlyAlert:true,earlySentAt:early.sentAt,
  minuteContinuation:path.reason,
  reason:'CLOSED_5M_PUBLISHED_EARLY_AND_1M_CONTINUATION'}};
}
export async function linkConfirmedForecasts(signals,{
 now=Date.now(),env=process.env,fetchImpl=fetch,
 fetchMinuteImpl=fetch,minuteCandlesBySymbol=null
}={}){
 const list=Array.isArray(signals)?signals:[];
 const strong=list.filter(s=>s?.level==='STRONG');
 const base={signals:list,examined:strong.length,linked:0,downgraded:0,
  historyAvailable:null,ordersSent:0};
 if(!strong.length)return base;
 const topic=env?.NTFY_TOPIC;
 if(typeof topic!=='string'||!/^[A-Za-z0-9_-]{16,64}$/.test(topic)){
  const mapped=list.map(s=>classifyTwoStageConfirmation(s,[],now));
  return {...base,signals:mapped,downgraded:strong.length,
   historyAvailable:false,reason:'NO_CONFIGURED_OWNER_TOPIC'};
 }
 let rows=[],historyAvailable=false;
 try{
  const response=await fetchImpl(BASE+encodeURIComponent(topic)+
   '/json?poll=1&since=20m',{
    method:'GET',cache:'no-store',signal:AbortSignal.timeout(3500),
    headers:{Accept:'application/x-ndjson'}
   });
  if(!response.ok)throw Error('Early history HTTP '+response.status);
  const body=await response.text();
  if(body.length>MAX_HISTORY_BYTES)throw Error('Early history too large');
  for(const line of body.split(/\r?\n/).slice(-500)){
   if(!line.trim())continue;
   try{
    const row=JSON.parse(line);
    if(row?.topic===topic&&row.event==='message')rows.push(row);
   }catch{/* A malformed row is never proof of an early alert. */}
  }
  historyAvailable=true;
 }catch(e){
  // Missing history cannot promote an unmatched 5m signal into STRONG.
  console.warn('WEEX_TWO_STAGE_HISTORY_UNAVAILABLE '+
   String(e.message||e).slice(0,55));
 }
 // Only actually linked strong candidates need one extra PUBLIC WEEX 1m
 // request per distinct symbol. No access to accounts, paid feeds or orders.
 const minuteMap=minuteCandlesBySymbol instanceof Map?
  minuteCandlesBySymbol:new Map();
 if(!(minuteCandlesBySymbol instanceof Map)&&rows.length){
  const needed=[...new Set(strong.filter(s=>
   linkedMessage(s,rows,now)?.direction===s.direction).map(s=>s.symbol))].slice(0,6);
  await Promise.all(needed.map(async symbol=>{
   try{
    const signal=strong.find(s=>s.symbol===symbol);
    const url='https://api-contract.weex.com/capi/v3/market/klines?symbol='+
     encodeURIComponent(symbol)+'&interval=1m&limit=30';
    const resp=await fetchMinuteImpl(url,{
     cache:'no-store',signal:AbortSignal.timeout(3200),
     headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-V110/1.0'}});
    if(!resp.ok)throw Error('WEEX_1M_UNAVAILABLE');
    const body=await resp.text();
    if(body.length>90000)throw Error('WEEX_1M_RESPONSE_TOO_LARGE');
    const parsed=JSON.parse(body);
    minuteMap.set(symbol,normalizeV110Minutes(
     Array.isArray(parsed)?parsed:parsed?.data,signal.candleCloseTime));
   }catch(e){
    console.warn('WEEX_V110_MINUTE_UNAVAILABLE '+symbol+' '+
     String(e.message||e).slice(0,44));
   }
  }));
 }
 const mapped=list.map(s=>classifyTwoStageConfirmation(
  s,rows,now,minuteMap.get(s.symbol)||null));
 const linked=mapped.filter(s=>s.twoStage?.stage==='CONFIRMED_AFTER_EARLY').length;
 return {...base,signals:mapped,linked,downgraded:strong.length-linked,
  historyAvailable};
}
