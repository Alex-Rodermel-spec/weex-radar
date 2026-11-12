// Historical read-only, per-symbol replay of the existing forecast and its
// three SHADOW-only alternatives on the SAME fully closed public WEEX bars.
// Does not use the user's journal, public trading orders, credentials or
// paid market feeds. No future candles enter any forecast decision.
import {buildStandaloneForecast,fetchPublicForecastBars}
 from './standalone-forecast.mjs';
import {marketForecastProfile} from './market-forecast-profiles.mjs';
const MIN=60_000,FIVE=5*MIN;
const MODES=['live','emaRsi','emaBollinger','fiveMinutePriority'];
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const pct=(numerator,denominator)=>denominator?
 Number((numerator/denominator*100).toFixed(1)):null;
const round=n=>Number(n.toFixed(2));
const bias=d=>d==='LONG_BIAS'?1:d==='SHORT_BIAS'?-1:0;
export const FILTER_REPLAY_POLICY=Object.freeze({
 version:'2026-11-12-closed-30m-filter-replay-v1',
 maxFetchedCandlesPerTimeframe:125,
 maxMarketRequestsPerCall:2,
 minClosed1mBars:66,forwardMinutes:[5,15,30],
 sampleSpacingMinutes:5,maxSamplesPerSymbol:10,
 modelChangesLiveAlerts:false,ordersSent:0
});
function aggregate(items){
 const total=items.length,selected=items.filter(x=>x.direction!=='MIXED');
 const result={totalSnapshots:total,candidates:selected.length,
  coveragePct:pct(selected.length,total),
  newlyAdmitted:selected.filter(x=>x.baseline==='MIXED').length,
  excludedPreviouslyAllowed:items.filter(x=>x.baseline!=='MIXED'&&
   x.direction==='MIXED').length,
  reversedDirection:items.filter(x=>x.baseline!=='MIXED'&&
   x.direction!=='MIXED'&&x.direction!==x.baseline).length,
  alreadyMoved10bps5m:selected.filter(x=>x.prior5mBps>=10).length};
 for(const h of [5,15,30]){
  const key='at'+h+'m';
  const good=selected.filter(x=>x['m'+h]>0).length;
  const bad=selected.filter(x=>x['m'+h]<0).length;
  const flat=selected.length-good-bad;
  result[key]={observed:selected.length,favorable:good,adverse:bad,flat,
   favorablePct:pct(good,selected.length),
   meanDirectionBps:selected.length?
    round(selected.reduce((sum,x)=>sum+x['m'+h],0)/selected.length):null};
 }
 const reached=selected.filter(x=>Number.isSafeInteger(x.firstFavorable10bps));
 const favorableFirst=selected.filter(x=>x.firstFavorable10bps!==null&&
  (x.firstAdverse10bps===null||x.firstFavorable10bps<x.firstAdverse10bps)).length;
 const adverseFirst=selected.filter(x=>x.firstAdverse10bps!==null&&
  (x.firstFavorable10bps===null||x.firstAdverse10bps<x.firstFavorable10bps)).length;
 result.firstFavorable10bps={reached:reached.length,
  reachedPct:pct(reached.length,selected.length),
  within5:reached.filter(x=>x.firstFavorable10bps<=5).length,
  favorableFirst,adverseFirst};
 return result;
}
export function replayFilterOutcomes(one,five,{symbol,now=Date.now()}={}){
 if(!marketForecastProfile(symbol)||!Array.isArray(one)||one.length<100||
  !Array.isArray(five)||five.length<110||
  !Number.isSafeInteger(now)||one.at(-1).closeTime>now-1000)
  return {available:false,reason:'INSUFFICIENT_CLOSED_WEEX_HISTORY',
   symbol,ordersSent:0};
 const samples=[];
 for(let i=Math.max(65,one.length-101);i+30<one.length;i++){
  const reference=one[i],asOf=reference?.closeTime;
  if(!Number.isSafeInteger(asOf)||asOf%FIVE!==0)continue;
  if(![1,5,15,30].every(n=>finite(one[i+n]?.close)&&
    one[i+n].closeTime===asOf+n*MIN))continue;
  const f=five.filter(x=>x.closeTime<=asOf);
  // The next 30 candles are deliberately unavailable to the forecast.
  const d=buildStandaloneForecast(one.slice(0,i+1),f,asOf+1500,symbol);
  if(!d.available)continue;
  const baseline=d.combinedDirection;
  const variants={live:baseline,...d.filterOverlapStudy.decisions};
  const prior=one[i-5]?.close;
  const signalRows={};
  for(const mode of MODES){
   const direction=variants[mode],sign=bias(direction);
   const item={baseline,direction,
    prior5mBps:sign&&finite(prior)&&prior>0?
     round(sign*(reference.close-prior)/prior*10000):null};
   for(const h of [5,15,30])item['m'+h]=sign?
    round(sign*(one[i+h].close-reference.close)/reference.close*10000):null;
   let firstFavorable10bps=null,firstAdverse10bps=null;
   if(sign){
    for(let k=1;k<=30;k++){
     const move=sign*(one[i+k].close-reference.close)/reference.close*10000;
     if(firstFavorable10bps===null&&move>=10)firstFavorable10bps=k;
     if(firstAdverse10bps===null&&move<=-10)firstAdverse10bps=k;
    }
   }
   item.firstFavorable10bps=firstFavorable10bps;
   item.firstAdverse10bps=firstAdverse10bps;
   signalRows[mode]=item;
  }
  samples.push({closedAt:asOf,variants:signalRows});
  if(samples.length>=FILTER_REPLAY_POLICY.maxSamplesPerSymbol)break;
 }
 return {available:samples.length>0,symbol,
  group:marketForecastProfile(symbol).group,
  protocol:FILTER_REPLAY_POLICY.version,
  snapshots:samples.length,
  oldestSampleAt:samples[0]?.closedAt||null,
  newestSampleAt:samples.at(-1)?.closedAt||null,
  models:Object.fromEntries(MODES.map(k=>[k,
   aggregate(samples.map(x=>x.variants[k]))])),
  noLookahead:true,ordersSent:0,
  limitations:'Historical price-direction observations only. 5m-spaced overlapping 30m outcomes are correlated; selection bias and transaction costs are not measured. The simplified models are NOT live or validated.'};
}
export async function handleForecastFilterReplay(req,res,allowed,{fetchImpl=fetch,now=Date.now()}={}){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const symbol=req.query?.symbol;
 if(typeof symbol!=='string'||!Array.isArray(allowed)||!allowed.includes(symbol))
  return res.status(400).json({error:'Unsupported WEEX forecast market'});
 try{
  const [one,five]=await Promise.all([
   fetchPublicForecastBars(symbol,'1m',MIN,now,fetchImpl),
   fetchPublicForecastBars(symbol,'5m',FIVE,now,fetchImpl)]);
  return res.status(200).json(replayFilterOutcomes(one,five,{symbol,now}));
 }catch(e){
  console.warn('WEEX_FORECAST_ABLATION_UNAVAILABLE '+symbol+' '+
   String(e.message||e).slice(0,70));
  return res.status(503).json({symbol,
   error:'Closed WEEX replay data unavailable',available:false,ordersSent:0});
 }
}
