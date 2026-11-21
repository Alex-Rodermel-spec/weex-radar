// V110 NEWS → FORECAST observational join. NEWS is NOT an input to live
// signals. An issue comment posted after a forecast cannot retroactively
// represent news available at its publication. Existing encrypted forecast
// outcomes are read on demand; no new market requests, cron or private rows.
import {parseV110NewsComment} from './v110-news-shadow.mjs';

const MIN=60_000,DAY=86_400_000,WINDOW=30*MIN,LOOKBACK=14*DAY;
const ASSETS=Object.freeze({
 BTC:{symbol:'BTCUSDT',keys:['BTC','CRYPTO','ALL']},
 XRP:{symbol:'XRPUSDT',keys:['XRP','CRYPTO','ALL']},
 GOLD_PROXY:{symbol:'XAUTUSDT',keys:['GOLD','ALL']}
});
const number=n=>typeof n==='number'&&Number.isFinite(n);
const clock=n=>Number.isSafeInteger(n)&&n>0;
const day=t=>new Date(t).toISOString().slice(0,10);
const round=n=>Math.round(n*100)/100;
const rate=(v,n)=>n>=30?round(v/n*100):null;
const EMPTY=Object.freeze({observed:0,favorable:0,adverse:0,flat:0,missing:0,favorablePct:null,meanDirectionalBps:null});
export const NEWS_FORECAST_JOIN_POLICY=Object.freeze({
 version:'v110-news-forecast-chronological-join-v1',
 researchOnly:true,primaryForecastHorizonMinutes:5,
 lookbackDays:14,afterNewsMinutes:30,
 requireVerifiedOriginalTimeAnnotation:true,
 requireGithubCommentPublishedBeforeForecast:true,
 requireDetectionBeforeForecast:true,
 requireDetectionWithinMinutes:5,
 minDistinctEvents:10,minPairsObserved:30,minDistinctUtcDays:5,
 onlyActuallyPublishedForecasts:true,
 goldIsXautProxyNotSpot:true,
 noExtraMarketRequests:true,noNewCron:true,
 noLiveForecastChanges:true,noLive108Changes:true,noTradingOrders:true,
 noAutomaticPromotion:true
});
function readEvents(comments,now){
 const unique=new Map();
 for(const c of comments){
  if(!c||typeof c.body!=='string')continue;
  const posted=Date.parse(c.created_at||'');
  if(!clock(posted)||posted>now||posted<=now-LOOKBACK)continue;
  for(const x of parseV110NewsComment(c.body)){
   // The source assertion is NOT independently re-verified by this endpoint.
   if(!x.primaryTimeVerified||x.planned||!x.impactAssets.length||
    x.detectedAt<x.publishedAt||x.detectedAt-x.publishedAt>5*MIN||
    x.publishedAt<=now-LOOKBACK||x.publishedAt>now||
    posted<x.detectedAt||!x.marketImpact)continue;
   if(!unique.has(x.eventId))unique.set(x.eventId,{
    ...x,commentPostedAt:posted
   });
  }
 }
 return [...unique.values()].sort((a,b)=>a.publishedAt-b.publishedAt||
  a.eventId.localeCompare(b.eventId));
}
function normalizeForecasts(rows,now){
 const seen=new Set(),lastBySymbol=new Map(),result=[];
 for(const r of [...rows].filter(x=>x&&
  typeof x.id==='string'&&/^[a-f0-9]{32}$/.test(x.id)&&
  Object.values(ASSETS).some(a=>a.symbol===x.symbol)&&
  ['LONG','SHORT'].includes(x.direction)&&clock(x.sentAt)&&
  x.sentAt<=now&&x.sentAt>now-LOOKBACK).sort((a,b)=>
   a.sentAt-b.sentAt||a.id.localeCompare(b.id))){
  if(seen.has(r.id))continue;
  seen.add(r.id);
  const prev=lastBySymbol.get(r.symbol);
  if(prev!==undefined&&r.sentAt-prev<30*MIN)continue;
  lastBySymbol.set(r.symbol,r.sentAt);
  result.push(r);
 }
 return result;
}
function metrics(rows){
 let favorable=0,adverse=0,flat=0,missing=0,sum=0;
 for(const r of rows){
  const w=r.windows?.[5];
  if(w?.status!=='OBSERVED'||!number(w.moveBps)){
   missing++;continue;
  }
  sum+=w.moveBps;
  if(w.moveBps>0)favorable++;
  else if(w.moveBps<0)adverse++;
  else flat++;
 }
 const observed=favorable+adverse+flat;
 return {observed,favorable,adverse,flat,missing,
  favorablePct:rate(favorable,observed),
  meanDirectionalBps:observed>=30?round(sum/observed):null};
}
export function evaluateNewsForecastJoin(comments,forecasts,now=Date.now()){
 const p=NEWS_FORECAST_JOIN_POLICY;
 const base={
  mode:'V110_NEWS_FORECAST_RESEARCH_ASSOCIATION',
  policy:p,source:'PUBLIC_GITHUB_ISSUE_62_AND_ENCRYPTED_PUBLISHED_FORECASTS',
  status:'INSUFFICIENT_PRE_EVENT_PROOF',
  recommendation:'KEEP_108_AND_KEEP_V4',
  newsChangesPrediction:false,ordersSent:0,automaticPromotion:false,
  warning:'Editorial impact and primary timestamp are author assertions, NOT independently validated in this endpoint. GitHub comment time proves only when the annotation was public, not when a human/AI first read the underlying news. Neither direction causality nor early price movement is proven. Missing prices are not wins. Non-news controls are unrandomized and may differ in regime and symbol. XAUTUSDT is a gold proxy, NOT spot XAUUSD.'
 };
 if(!Array.isArray(comments)||comments.length>100||
  !Array.isArray(forecasts)||forecasts.length>5000||!clock(now))
  return {...base,status:'INVALID_INPUT'};
 const events=readEvents(comments,now);
 const rows=normalizeForecasts(forecasts,now);
 const paired=new Set(),eventsMatched=new Set();
 const byAsset=Object.fromEntries(Object.keys(ASSETS).map(k=>[k,[]]));
 const linked=[];
 // A forecast is considered "post-news" only if the annotation itself was
 // ALREADY publicly posted before the forecast was sent. No retroactive tags.
 for(const e of events){
  for(const [asset,meta] of Object.entries(ASSETS)){
   if(!meta.keys.some(k=>e.impactAssets.includes(k)))continue;
   const start=Math.max(e.detectedAt,e.commentPostedAt);
   if(start>=e.detectedAt+WINDOW)continue;
   const match=rows.find(r=>r.symbol===meta.symbol&&!paired.has(r.id)&&
    r.sentAt>=start&&r.sentAt<e.detectedAt+WINDOW);
   if(!match)continue;
   paired.add(match.id);eventsMatched.add(e.eventId);
   linked.push(match);byAsset[asset].push(match);
  }
 }
 const controls=rows.filter(r=>!paired.has(r.id)&&
  !events.some(e=>r.sentAt>=e.detectedAt&&
   r.sentAt<e.detectedAt+WINDOW&&Object.values(ASSETS).some(meta=>
    meta.symbol===r.symbol&&meta.keys.some(k=>e.impactAssets.includes(k)))));
 const eventM=metrics(linked),controlM=metrics(controls);
 const days=new Set(linked.map(r=>day(r.sentAt))).size;
 const sampleEnough=eventsMatched.size>=p.minDistinctEvents&&
  eventM.observed>=p.minPairsObserved&&days>=p.minDistinctUtcDays;
 return {...base,status:sampleEnough?'DESCRIPTIVE_ONLY_NOT_CAUSAL':
  'INSUFFICIENT_PRE_EVENT_PROOF',
  structuredEligibleNewsEvents:events.length,
  newsEventsWithPostCommentForecast:eventsMatched.size,
  actuallyPublishedForecastsConsidered:rows.length,
  eventLinkedForecasts:linked.length,
  eventLinkedDistinctUtcDays:days,
  eventLinkedAt5m:eventM,unexposedControlsAt5m:controlM,
  byAsset:Object.fromEntries(Object.entries(byAsset).map(([asset,x])=>
   [asset,{alerts:x.length,at5m:metrics(x)}])),
  independentForwardValidated:false,
  accuracyImproved:false};
}
export async function handleNewsForecastJoin(req,res,{
 fetchImpl=fetch,archiveReader,now=Date.now()
}={}){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{
  const endpoint='https://api.github.com/repos/Alex-Rodermel-spec/weex-radar/issues/62/comments?per_page=100&page=1';
  const response=await fetchImpl(endpoint,{cache:'no-store',
   signal:AbortSignal.timeout(7500),
   headers:{Accept:'application/vnd.github+json',
    'User-Agent':'WEEX-V110-NEWS-FORECAST-SHADOW/1.0'}});
  if(!response.ok)throw Error('NEWS_SOURCE_UNAVAILABLE');
  const raw=await response.text();
  if(raw.length>175000)throw Error('NEWS_TOO_LARGE');
  const comments=JSON.parse(raw);
  if(!Array.isArray(comments))throw Error('NEWS_INVALID_LIST');
  const load=archiveReader||(await import('./journal-route.mjs')).readJournal;
  const archive=await load(now);
  const result=evaluateNewsForecastJoin(comments,archive.forecastRows,now);
  return res.status(200).json(result);
 }catch(err){
  console.warn('V110_NEWS_FORECAST_RESEARCH_UNAVAILABLE '+
   String(err?.message||err).slice(0,65));
  return res.status(503).json({mode:'V110_NEWS_FORECAST_RESEARCH_ASSOCIATION',
   status:'SOURCE_UNAVAILABLE',newsChangesPrediction:false,
   ordersSent:0,automaticPromotion:false});
 }
}
