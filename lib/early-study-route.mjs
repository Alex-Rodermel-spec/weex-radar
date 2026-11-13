// On-demand, read-only research of EARLY WATCH messages.
// No push, orders, trading credentials, changes to filters or durable writes.
import {_test as radar} from '../api/signals.mjs';
import {parseConfirmedNotification} from './signal-quality.mjs';
import {parseEarlyNotification,normalizeEarlyCandles,
 summarizeEarlyStudy} from './early-study.mjs';
import {summarizePublishedPreBreak} from './published-early-audit.mjs';
import {auditObservedEarlyPairs,OBSERVED_PAIR_POLICY} from './v110-observed-early-pairs.mjs';
import {normalizeReplayRows} from '../api/early-level-replay.mjs';
import {forecastTopic} from './forecast-ntfy.mjs';
import {parseStandaloneNtfyMessage,summarizeStandaloneForecastNotices}
 from './v110-standalone-forecast-audit.mjs';
const WINDOW_MINUTES=110,MAX_HISTORY_BYTES=250000,MAX_EARLY=80;
const MINUTE=60000;
function configuredTopic(){
 const topic=process.env.NTFY_TOPIC;
 return typeof topic==='string'&&/^[A-Za-z0-9_-]{16,64}$/.test(topic)?topic:null;
}
async function notifications(topic,now,fetchImpl=fetch){
 const url='https://ntfy.sh/'+encodeURIComponent(topic)+'/json?poll=1&since='+WINDOW_MINUTES+'m';
 const r=await fetchImpl(url,{signal:AbortSignal.timeout(7000),cache:'no-store',
  headers:{Accept:'application/x-ndjson'}});
 if(!r.ok)throw Error('NTFY_RESEARCH_UNAVAILABLE');
 const text=await r.text();
 if(text.length>MAX_HISTORY_BYTES)throw Error('NTFY_RESEARCH_TOO_LARGE');
 const early=[],confirmed=[],start=now-WINDOW_MINUTES*MINUTE;
 for(const line of text.split(/\r?\n/)){
  if(!line.trim())continue;
  let row;try{row=JSON.parse(line)}catch{continue}
  if(row.topic!==topic)continue;
  const watch=parseEarlyNotification(row);
  if(watch&&radar.SYMBOLS.includes(watch.symbol)&&
    watch.sentAt>=start&&watch.sentAt<=now+5000)early.push(watch);
  const regular=parseConfirmedNotification(row);
  if(regular&&radar.SYMBOLS.includes(regular.symbol)&&
    regular.sentAt>=start&&regular.sentAt<=now+5000)confirmed.push(regular);
 }
 const seen=new Set(),unique=[];
 for(const entry of early.sort((a,b)=>b.sentAt-a.sentAt)){
  if(seen.has(entry.key))continue;
  seen.add(entry.key);unique.push(entry);
 }
 return {early:unique.slice(0,MAX_EARLY),confirmed,
  truncated:unique.length>MAX_EARLY};
}
async function candles(symbol,now,fetchImpl=fetch){
 const url='https://api-contract.weex.com/capi/v3/market/klines?symbol='+
  encodeURIComponent(symbol)+'&interval=1m&limit=125';
 const response=await fetchImpl(url,{signal:AbortSignal.timeout(7000),
  cache:'no-store',headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-RESEARCH/1.0'}});
 if(!response.ok)throw Error('WEEX_RESEARCH_UNAVAILABLE');
 const body=await response.text();
 if(body.length>200000)throw Error('WEEX_RESEARCH_TOO_LARGE');
 const json=JSON.parse(body);
 return normalizeEarlyCandles(Array.isArray(json)?json:json?.data,now);
}
async function recentMarketCandles(symbols,now){
 const result=new Map();let next=0;
 async function worker(){
  while(next<symbols.length){
   const symbol=symbols[next++];
   try{result.set(symbol,await candles(symbol,now))}
   catch{result.set(symbol,null)}
  }
 }
 await Promise.all(Array.from({length:Math.min(6,symbols.length)},()=>worker()));
 return result;
}
// Shared read-only sample collector. Public pages receive aggregates only;
// the existing OIDC-authorized encrypted journal writer may archive rows.
export async function recentEarlyResearch(now=Date.now(),{includePrivateInputs=false}={}){
 const topic=configuredTopic();
 if(!topic)throw Error('EARLY_RESEARCH_TOPIC_UNAVAILABLE');
 const {early,confirmed,truncated}=await notifications(topic,now);
 const markets=await recentMarketCandles([...new Set(early.map(a=>a.symbol))],now);
 const study=summarizeEarlyStudy(early,markets,confirmed,now);
 // Use exactly the SAME real ntfy notices and market candles as the old
 // direction-only journal. Aggregates only; no extra WEEX/ntfy API calls.
 study.publishedPreBreak=summarizePublishedPreBreak(early,markets,now);
 return {study,truncated,...(includePrivateInputs?
  {__privateInputs:{early,markets}}:{})};
}
async function researchFrame(symbol,interval,now,fetchImpl=fetch){
 const duration=interval==='5m'?5*MINUTE:15*MINUTE;
 const limit=125;
 const url='https://api-contract.weex.com/capi/v3/market/klines?symbol='+
  encodeURIComponent(symbol)+'&interval='+interval+'&limit='+limit;
 const response=await fetchImpl(url,{
  signal:AbortSignal.timeout(6500),cache:'no-store',
  headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-RESEARCH/1.0'}
 });
 if(!response.ok)throw Error('ANCHOR_PUBLIC_WEEX_UNAVAILABLE');
 const raw=await response.text();
 if(raw.length>240000)throw Error('ANCHOR_PUBLIC_WEEX_TOO_LARGE');
 const payload=JSON.parse(raw);
 return normalizeReplayRows(Array.isArray(payload)?payload:payload?.data,duration,now);
}
async function recentActualAnchoredStudy(early,markets,now){
 const eligible=early.filter(a=>a.watchType==='PRE_BREAK'&&
  Number.isSafeInteger(a.sentAt)&&
  now-a.sentAt>=0&&
  now-a.sentAt<=OBSERVED_PAIR_POLICY.maxNoticeAgeMinutes*MINUTE&&
  Number.isFinite(a.trigger)&&Number.isFinite(a.invalidation))
  .sort((a,b)=>b.sentAt-a.sentAt);
 const symbols=[...new Set(eligible.slice(0,OBSERVED_PAIR_POLICY.maxNotices)
  .map(a=>a.symbol))].slice(0,OBSERVED_PAIR_POLICY.maxSymbols);
 const five=new Map(),fifteen=new Map();
 // Maximum eight additional PUBLIC OHLC GET requests, on explicit GET only.
 await Promise.all(symbols.map(async symbol=>{
  const [bars5,bars15]=await Promise.allSettled([
   researchFrame(symbol,'5m',now),researchFrame(symbol,'15m',now)
  ]);
  if(bars5.status==='fulfilled')five.set(symbol,bars5.value);
  if(bars15.status==='fulfilled')fifteen.set(symbol,bars15.value);
 }));
 return {available:true,extraPublicRequestsMax:8,
  ...auditObservedEarlyPairs(eligible,markets,five,fifteen,now)};
}
// Forecast channel is separate from the early/confirmed channel.
// Its actual historical notices never masquerade as delivered PRE_BREAKs.
async function actualStandaloneForecastStudy(now,fetchImpl=fetch){
 const topic=forecastTopic();
 if(!topic)throw Error('FORECAST_RESEARCH_TOPIC_MISSING');
 const response=await fetchImpl('https://ntfy.sh/'+encodeURIComponent(topic)+
  '/json?poll=1&since='+WINDOW_MINUTES+'m',{
  signal:AbortSignal.timeout(6000),cache:'no-store',
  headers:{Accept:'application/x-ndjson'}
 });
 if(!response.ok)throw Error('FORECAST_RESEARCH_HISTORY_UNAVAILABLE');
 const body=await response.text();
 if(body.length>MAX_HISTORY_BYTES)throw Error('FORECAST_RESEARCH_TOO_LARGE');
 const notices=[],seen=new Set();
 for(const line of body.split(/\r?\n/)){
  if(!line.trim())continue;
  let raw;try{raw=JSON.parse(line)}catch{continue}
  if(raw.topic!==topic)continue;
  const notice=parseStandaloneNtfyMessage(raw,topic);
  if(!notice||!radar.SYMBOLS.includes(notice.symbol)||
   notice.sentAt<now-WINDOW_MINUTES*MINUTE||
   notice.sentAt>now+5000||seen.has(notice.key))continue;
  seen.add(notice.key);notices.push(notice);
 }
 const recent=notices.sort((a,b)=>b.sentAt-a.sentAt).slice(0,40);
 const symbols=[...new Set(recent.map(a=>a.symbol))].slice(0,8);
 const usable=recent.filter(a=>symbols.includes(a.symbol));
 const candlesBySymbol=await recentMarketCandles(symbols,now);
 return {available:true,maxPublicWeexRequests:8,windowMinutes:WINDOW_MINUTES,
  sampleTruncated:notices.length>recent.length||symbols.length<
   new Set(recent.map(a=>a.symbol)).size,
  ...summarizeStandaloneForecastNotices(usable,candlesBySymbol,now)};
}
export async function handleEarlyStudy(req,res){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const topic=configuredTopic();
 if(!topic)return res.status(503).json({error:'ntfy не настроен для исследования.'});
 const now=Date.now();
 try{
  const {study,truncated,__privateInputs}=await recentEarlyResearch(now,
   {includePrivateInputs:true});
  // Extra OHLC checks exist ONLY on this manual, read-only study endpoint;
  // no new market calls in the 20-minute encrypted journal background job.
  // A preview without NTFY_TOPIC cannot fabricate live notice evidence.
  const observedAnchored=await recentActualAnchoredStudy(
   __privateInputs.early,__privateInputs.markets,now).catch(()=>null);
  const standaloneForecast=await actualStandaloneForecastStudy(now).catch(
   ()=>null);
  return res.status(200).json({generatedAt:now,
   source:'actual ntfy WEEX early alerts, not hypothetical scanner candidates',
   windowMinutes:WINDOW_MINUTES,durableStorage:false,
   sampleTruncated:truncated,verifiedPhoneDelivery:false,
   description:'5/15/30m direction of closed candles after the alert, versus rounded displayed alert price.',
   limitations:'Not a trade backtest: no executions, fees, spreads, leverage, or liquidation. A correct direction does not imply a profitable entry. Partial alert minute excluded. The ntfy cache is short-lived.',
   // Individual watches remain server-side; public dashboard sees aggregates only.
   ...Object.fromEntries(Object.entries(study).filter(([key])=>key!=='rows')),
   observedAnchored:observedAnchored||{mode:'REAL_NTFY_ANCHORED_5M_SHADOW',
    available:false,reason:'PUBLIC_WEEX_HISTORY_UNAVAILABLE',
    noOrders:true},
   standaloneForecast:standaloneForecast||{
    mode:'ACTUAL_SEPARATE_NTFY_FORECAST_AUDIT',available:false,
    reason:'PRIVATE_FORECAST_HISTORY_NOT_AVAILABLE_IN_THIS_DEPLOYMENT',
    notificationsSent:0,noAutotrading:true
   }
  });
 }catch(e){
  console.warn('WEEX_RADAR_EARLY_STUDY_ERROR '+String(e?.message||e).slice(0,65));
  return res.status(503).json({error:'Исследование временно недоступно; отправка сигналов работает независимо.'});
 }
}
