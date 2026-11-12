// V110 research-only historical replay: existing early PRE_BREAK vs 5m
// obstacle/rejection shadow filters on the SAME PREVIOUS CLOSED WEEX candles.
// The market quote is approximated by the latest completed 1m close, not a
// replay of the live bid/ask or actual ntfy delivered notices. No live change.
import {preBreakCandidate,forecastPreBreak} from '../lib/forecast-watch.mjs';
import {earlyLevelShadow,EARLY_LEVEL_SHADOW_POLICY} from '../lib/early-level-shadow.mjs';
import {marketForecastProfile} from '../lib/market-forecast-profiles.mjs';
const MIN=60_000,MAX_BODY=1_000_000,DATA_ENDPOINT=
 'https://api-contract.weex.com/capi/v3/market/klines';
const ALLOWED_INTERVALS=Object.freeze({'1m':1000,'5m':300,'15m':180});
const num=x=>typeof x==='number'&&Number.isFinite(x);
const rounded=(v,d=2)=>num(v)?Number(v.toFixed(d)):null;
const pct=(n,d)=>d?rounded(100*n/d,1):null;
const sign=s=>s==='LONG'?1:-1;
export const EARLY_REPLAY_POLICY=Object.freeze({
 version:'2026-11-12-v110-early-shadow-v1',
 oldestMinutesLimit:1000,sampleEveryMinutes:1,
 sameSymbolTenMinuteDedup:true,
 futureMinuteHorizons:[5,15],
 marketRequestsPerCall:3,liveDeliveryUnchanged:true,noOrders:true
});
async function fetchRows(symbol,interval,now,fetchImpl){
 const url=DATA_ENDPOINT+'?symbol='+encodeURIComponent(symbol)+
   '&interval='+interval+'&limit='+ALLOWED_INTERVALS[interval];
 const response=await fetchImpl(url,{
  cache:'no-store',signal:AbortSignal.timeout(9000),
  headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-RESEARCH/1.0'}
 });
 if(!response.ok)throw Error('WEEX_RESEARCH_HTTP_'+response.status);
 const raw=await response.text();
 if(raw.length>MAX_BODY)throw Error('WEEX_RESEARCH_TOO_LARGE');
 const data=JSON.parse(raw);
 if(!Array.isArray(data)&&!Array.isArray(data?.data))
  throw Error('WEEX_RESEARCH_INVALID_DATA');
 return normalizeReplayRows(Array.isArray(data)?data:data.data,
  Number(interval.slice(0,-1))*MIN,now);
}
export function normalizeReplayRows(raw,period,now){
 if(!Array.isArray(raw)||!Number.isSafeInteger(now)||raw.length>1500||
  ![MIN,5*MIN,15*MIN].includes(period))return [];
 const unique=new Map();
 for(const row of raw){
  if(!Array.isArray(row)||row.length<6)continue;
  const [time,open,high,low,close,volume]=row.slice(0,6).map(Number);
  if(!Number.isSafeInteger(time)||time%period!==0||
   time+period>now-1000||time<now-10*86400000||
   ![open,high,low,close,volume].every(num)||open<=0||low<=0||
   close<=0||volume<0||high<Math.max(open,close,low)||
   low>Math.min(open,close))continue;
  unique.set(time,{time,closeTime:time+period,open,high,low,close,volume});
 }
 return [...unique.values()].sort((a,b)=>a.time-b.time);
}
function aggregate(rows){
 const out={count:rows.length};
 for(const h of EARLY_REPLAY_POLICY.futureMinuteHorizons){
  const available=rows.filter(x=>num(x['m'+h]));
  const favorable=available.filter(x=>x['m'+h]>0).length;
  const adverse=available.filter(x=>x['m'+h]<0).length;
  out['at'+h+'m']={observed:available.length,favorable,adverse,
   flat:available.length-favorable-adverse,
   favorablePct:pct(favorable,available.length),
   meanDirectionBps:available.length?rounded(available.reduce(
    (sum,x)=>sum+x['m'+h],0)/available.length):null};
 }
 out.pre5mAlready10bps=rows.filter(x=>x.pre5Bps>=10).length;
 out.first10bpsFavorableBeforeAdverse=rows.filter(x=>
  x.firstFavorable10!==null&&
  (x.firstAdverse10===null||x.firstFavorable10<x.firstAdverse10)).length;
 out.first10bpsAdverseBeforeFavorable=rows.filter(x=>
  x.firstAdverse10!==null&&
  (x.firstFavorable10===null||x.firstAdverse10<x.firstFavorable10)).length;
 return out;
}
export function replayEarlyLevelShadow(one,five,fifteen,{symbol}={}){
 const profile=marketForecastProfile(symbol);
 if(!profile||![one,five,fifteen].every(Array.isArray)||
  one.length<140||five.length<80||fifteen.length<80)
  return {available:false,reason:'INSUFFICIENT_CLOSED_WEEX_HISTORY',symbol};
 const baseline=[],clear=[],caution=[],unknown=[];
 const recentBySymbolDirectionBucket=new Set();
 const lookup=new Map(one.map((row,i)=>[row.closeTime,i]));
 let candidateCount=0,fullCount=0,missingOutcome=0,continuitySkipped=0;
 // 5m/15m context has >= 60 prior closed bars; future 15m must be present.
 for(let i=125;i+15<one.length;i++){
  const candle=one[i],asOf=candle.closeTime;
  // Assert full 1m continuity over the long trend lookback and forward window.
  const rows1=one.slice(i-124,i+16);
  if(rows1.length!==140||rows1.some((r,k)=>k>0&&
    r.time!==rows1[k-1].closeTime)){continuitySkipped++;continue;}
  const old5=five.filter(r=>r.closeTime<=asOf).slice(-125);
  const old15=fifteen.filter(r=>r.closeTime<=asOf).slice(-125);
  if(old5.length<60||old15.length<60)continue;
  const checkedAt=asOf+1000;
  const pre=preBreakCandidate(one.slice(i-124,i+1),old15,checkedAt);
  if(!pre)continue;
  candidateCount++;
  // Historical candle close approximates quote available immediately AFTER close.
  const f=forecastPreBreak(one.slice(i-124,i+1),old5,old15,candle.close,checkedAt);
  if(!f)continue;
  fullCount++;
  const bucket=Math.floor(asOf/(10*MIN));
  const key=symbol+'|'+f.direction+'|'+bucket;
  if(recentBySymbolDirectionBucket.has(key))continue;
  recentBySymbolDirectionBucket.add(key);
  const signed=sign(f.direction),reference=candle.close;
  const item={time:asOf,side:f.direction};
  const old5price=one[i-5]?.close;
  item.pre5Bps=num(old5price)?rounded(10000*signed*
    (reference-old5price)/old5price):null;
  for(const minutes of EARLY_REPLAY_POLICY.futureMinuteHorizons){
   const index=lookup.get(asOf+minutes*MIN);
   item['m'+minutes]=index===undefined?null:rounded(10000*signed*
     (one[index].close-reference)/reference);
  }
  if(item.m15===null){missingOutcome++;continue;}
  item.firstFavorable10=null;item.firstAdverse10=null;
  for(let k=1;k<=15;k++){
   const move=10000*signed*(one[i+k].close-reference)/reference;
   if(item.firstFavorable10===null&&move>=10)item.firstFavorable10=k;
   if(item.firstAdverse10===null&&move<=-10)item.firstAdverse10=k;
  }
  const shadow=earlyLevelShadow(
    {...pre,triggerPrice:f.triggerPrice},old5,symbol);
  item.shadow=shadow.status;item.reason=shadow.reason;
  baseline.push(item);
  if(shadow.status==='CAUTION')caution.push(item);
  else if(shadow.status==='CLEAR')clear.push(item);
  else unknown.push(item);
 }
 return {available:true,symbol,group:profile.group,
  protocol:EARLY_REPLAY_POLICY.version,shadow:EARLY_LEVEL_SHADOW_POLICY.version,
  priorClosedBars:{one:one.length,five:five.length,fifteen:fifteen.length},
  earlyCheapCandidates:candidateCount,fullPrebreakCandidates:fullCount,
  continuitySkipped,missingOutcome,
  baseline:aggregate(baseline),noObstacleOrRejection:aggregate(clear),
  obstacleOrRejection:aggregate(caution),uncertainEvidence:aggregate(unknown),
  cautionReasons:Object.fromEntries([...new Set(caution.map(x=>x.reason))].map(
   reason=>[reason,caution.filter(x=>x.reason===reason).length])),
  actualNtfyNotReplayed:true,priceProxy:'last fully closed 1m candle, not historical bid/ask',
  correlatedOutcomes:true,liveDeliveryUnchanged:true,noOrders:true};
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const symbol=req.query?.symbol;
 if(typeof symbol!=='string'||!marketForecastProfile(symbol))
  return res.status(400).json({error:'Unsupported WEEX research symbol'});
 try{
  const now=Date.now();
  const [one,five,fifteen]=await Promise.all([
   fetchRows(symbol,'1m',now,fetch),
   fetchRows(symbol,'5m',now,fetch),
   fetchRows(symbol,'15m',now,fetch)
  ]);
  return res.status(200).json(replayEarlyLevelShadow(
   one,five,fifteen,{symbol}));
 }catch(e){
  console.warn('WEEX_EARLY_SHADOW_REPLAY '+symbol+' '+String(e.message||e).slice(0,75));
  return res.status(503).json({available:false,symbol,
   reason:'PUBLIC_WEEX_REPLAY_UNAVAILABLE',noOrders:true});
 }
}
