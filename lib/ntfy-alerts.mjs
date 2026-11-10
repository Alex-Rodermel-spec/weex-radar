// Optional ntfy.sh delivery for Android without keeping Chrome open.
// Each topic is a random 128-bit bearer secret, stored privately in Vercel Blob.
// The public ntfy server is an independent third-party notification relay.
import {createHash} from 'node:crypto';
import {formatPhoneAlert} from './alert-presentation.mjs';
import {parseForecastMessage,normalizeFollowupCandles,evaluateForecast,
 forecastFollowupMessage,followupSequence} from './forecast-followup.mjs';
import {get,list,put,del} from '@vercel/blob';

const BASE='https://ntfy.sh/';
const topicOk=topic=>/^wr-[a-f0-9]{32}$/.test(topic||'');
// Owner-configured, private ntfy topic is a storage-independent Android relay.
// The value stays server-side: never include it in the page, logs, or an API response.
const configuredTopic=()=>{
 const topic=process.env.NTFY_TOPIC;
 return typeof topic==='string'&&/^[A-Za-z0-9_-]{16,64}$/.test(topic)?topic:null;
};
const subscriberOk=id=>/^[a-f0-9]{64}$/.test(id||'');
const rowPath=id=>'ntfy/subscribers/'+id+'.json';
const hash=s=>createHash('sha256').update(s).digest('hex');
const conflict=e=>/exist|already|conflict|409/i.test(String(e?.message||e));
const fresh=s=>s&&['LONG','SHORT'].includes(s.direction)&&
 Number.isFinite(s.expiresAt)&&s.expiresAt>Date.now()+12000&&
 Number.isFinite(s.candleCloseTime)&&['WEEX','Bybit'].includes(s.exchange);
 // Phone alerts are forecasts or manually reviewed WEEX entry candidates.
 // This is display eligibility, never exchange order authorization.
export const eligiblePhoneSignal=(s,kind)=>fresh(s)&&
 (kind==='early'?
   // Standalone 1m breakout stays available to research, not a second push.
   // Only a fully validated PRE_BREAK scenario is a directional forecast.
   s.exchange==='WEEX'&&s.level==='EARLY_WATCH'&&
   s.watchType==='PRE_BREAK'&&s.forecast?.mode==='PRE_BREAK_SCENARIO':
   kind==='confirmed'&&s.exchange==='WEEX'&&s.advisor?.status==='REVIEW'&&
   s.entryQuality?.ok===true&&s.costReview?.status==='PASS_ESTIMATE');

export async function readNtfy(id){
 if(!subscriberOk(id))return null;
 const blob=await get(rowPath(id),{access:'private'});
 if(!blob?.stream)return null;
 const row=JSON.parse(await new Response(blob.stream).text());
 return row.subscriberId===id&&topicOk(row.topic)?row:null;
}
export async function registerNtfy(id,topic){
 if(!subscriberOk(id)||!topicOk(topic))throw Error('Invalid subscriber or topic');
 await put(rowPath(id),JSON.stringify({subscriberId:id,topic,enabledAt:Date.now()}),
  {access:'private',allowOverwrite:true,contentType:'application/json'});
}
export async function listNtfy(){
 const page=await list({prefix:'ntfy/subscribers/',limit:20});
 const entries=await Promise.all(page.blobs.map(async blob=>{
  try{
   const row=await get(blob.pathname,{access:'private'});
   if(!row?.stream)return null;
   const data=JSON.parse(await new Response(row.stream).text());
   return subscriberOk(data.subscriberId)&&topicOk(data.topic)&&blob.pathname===rowPath(data.subscriberId)?data:null;
  }catch{return null;}
 }));
 return entries.filter(Boolean);
}
export async function publishNtfy(topic,{title,message,priority=4,click='https://weex-radar.vercel.app/',sequenceId=null}){
 if(!topicOk(topic)&&topic!==configuredTopic())throw Error('Invalid ntfy topic');
 if(sequenceId!==null&&!/^[a-f0-9]{32}$/.test(sequenceId))throw Error('Invalid ntfy sequence');
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),5500);
 try{
  const response=await fetch(BASE,{method:'POST',signal:ctrl.signal,
   headers:{'Content-Type':'application/json','User-Agent':'WEEX-RADAR/1.0'},
   body:JSON.stringify({topic,title,message,priority,click,...(sequenceId?{sequence_id:sequenceId}:{})})});
  if(!response.ok)throw Error('ntfy HTTP '+response.status);
  return true;
 }finally{clearTimeout(timer);}
}

// ntfy keeps a short-lived message cache, so it can track sent sequences even
// while Vercel Blob storage is suspended. Read only on real signal candidates.
// A conditional forecast is one scenario per market/direction per 10-minute
// window, rather than one loud notification for every qualifying 1m candle.
const sequenceForSignal=(kind,signal)=>{
 const prediction=kind==='early'&&signal.watchType==='PRE_BREAK';
 const candle=prediction?Math.floor(signal.candleCloseTime/600000):signal.candleCloseTime;
 return hash(kind+'|'+[signal.exchange,signal.symbol,signal.direction,
  prediction?'PRE_BREAK':'BREAKOUT',candle].join('|')).slice(0,32);
};
const berlinTime=stamp=>new Date(stamp).toLocaleTimeString('ru-RU',{
 timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
});
async function recentNtfySequences(topic){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),3500);
 try{
  const response=await fetch(BASE+encodeURIComponent(topic)+'/json?poll=1&since=10m',{
   method:'GET',signal:ctrl.signal,cache:'no-store'
  });
  if(!response.ok)throw Error('ntfy history HTTP '+response.status);
  const body=await response.text();
  if(body.length>250000)throw Error('ntfy history response exceeded safe limit');
  const ids=new Set();
  for(const line of body.split(/\r?\n/)){
   if(!line.trim())continue;
   try{
    const row=JSON.parse(line);
    if(row.event==='message'&&row.topic===topic&&/^[a-f0-9]{32}$/.test(row.sequence_id||''))ids.add(row.sequence_id);
   }catch{}
  }
  return ids;
 }finally{clearTimeout(timer);}
}
async function sendEnvironmentNtfy(kind,signals,topic){
 const result={enabled:true,delivered:0,failed:0,duplicates:0};
 const now=Date.now();
 const candidates=signals.filter(s=>eligiblePhoneSignal(s,kind)&&
  typeof s.symbol==='string'&&/^[A-Z0-9]{2,24}$/.test(s.symbol)&&
  s.candleCloseTime<=now&&
  now-s.candleCloseTime<=(kind==='early'?45000:90000)&&
  (kind!=='early'||s.level==='EARLY_WATCH'));
 // Preserve priority for actual breakouts, allow at most two unconfirmed
 // pre-break forecasts per scan to limit speculative Android alerts.
 const eligible=kind==='early'?[
  ...candidates.filter(s=>s.watchType!=='PRE_BREAK').slice(0,6),
  ...candidates.filter(s=>s.watchType==='PRE_BREAK').slice(0,2)
 ].slice(0,6):candidates.slice(0,6);
 if(!eligible.length)return result;
 let previous=new Set();
 try{previous=await recentNtfySequences(topic);}
 catch(e){
  // Keep critical alerts flowing if ntfy history is unavailable.
  // The stable sequence ID still groups updates on Android, but a repeat
  // may sound again during a history outage.
  console.warn('WEEX_RADAR_NTFY_HISTORY_UNAVAILABLE '+String(e.message||e).slice(0,70));
 }
 for(const s of eligible){
  const id=sequenceForSignal(kind,s);
  if(previous.has(id)){result.duplicates++;continue;}
  const stampedAt=Date.now();
  if(s.expiresAt<=stampedAt+12000)continue;
  const isEarly=kind==='early';
  const title=formatPhoneAlert(s,{early:isEarly}).title;
  const rawPrice=Number(s.livePrice||s.price||s.closePrice);
  const price=Number.isFinite(rawPrice)&&rawPrice>0?rawPrice.toPrecision(6):'—';
  const candleAt=berlinTime(s.candleCloseTime),sentAt=berlinTime(stampedAt);
  const lagSec=Math.max(0,Math.round((stampedAt-s.candleCloseTime)/1000));
  const deadline=berlinTime(s.expiresAt);
  const rr=Number(s.entryQuality?.rr);
  const entryText=!isEarly&&Number.isFinite(rr)&&rr>0?
    ' · R/R '+rr.toFixed(2)+':1':'';
  const shadowText=!isEarly&&s.shadowFilter?.mode==='SHADOW'?
    (s.shadowFilter.warning?' · ТЕСТ: ПРОПУСТИТЬ':' · ТЕСТ: БЕЗ ЗАМЕЧАНИЙ'):'';
  const retest=s.retest?.[s.direction];
  const cost=s.costReview;
  const costText=isEarly||cost?.mode!=='SHADOW_COSTS'?'':cost.status==='COSTS_EXCEED_TP'?
    ' · ⚠️ РАСХОДЫ: TP меньше комиссий/спреда/проскальзывания (модель)':
    cost.status==='LOW_NET_RR'?
    ' · ⚠️ РАСХОДЫ: NET R/R '+cost.netRR.toFixed(2)+':1, меньше 1,5 (модель)':
    ' · NET R/R '+cost.netRR.toFixed(2)+':1 (модель)';
  const retestText=isEarly?'':retest?.status==='CONFIRMED'&&retest.trendAligned===true?
    ' · 5м РЕТЕСТ: УРОВЕНЬ УДЕРЖАН':
    retest?.status==='FAILED'?' · 5м РЕТЕСТ: УРОВЕНЬ НЕ УДЕРЖАН':
    ' · 5м РЕТЕСТ: ЕЩЁ НЕ ПОДТВЕРЖДЁН';
  // Display-only status. Preserve original scanner eligibility and
  // ntfy deduplication; never use the label to suppress a notification.
  const body=formatPhoneAlert(s,{early:isEarly,deadline}).message+
    '\n🕒 Свеча '+candleAt+' · отправка '+sentAt+' · задержка '+lagSec+'с';
  const click=s.exchange==='WEEX'?
   (isEarly?'https://weex-radar.vercel.app/tradingview.html?symbol='+encodeURIComponent(s.symbol)+'&interval=1':
    'https://weex-radar.vercel.app/trade.html?symbol='+encodeURIComponent(s.symbol)):
   'https://weex-radar.vercel.app/';
  try{
   await publishNtfy(topic,{title,message:body,priority:isEarly?4:5,click,sequenceId:id});
   result.delivered++;
   previous.add(id); // Prevent duplicates within one batch, too.
   console.info('WEEX_RADAR_NTFY_SENT '+JSON.stringify({kind,symbol:s.symbol,
    exchange:s.exchange,candleCloseTime:new Date(s.candleCloseTime).toISOString(),
    sentAt:new Date(stampedAt).toISOString(),scanLagMs:stampedAt-s.candleCloseTime,
    accepted:true,mode:'environment'}));
  }catch(e){
   result.failed++;
   console.warn('WEEX_RADAR_NTFY_FAILED '+String(e.message||e).slice(0,80));
  }
 }
 if(result.duplicates)console.info('WEEX_RADAR_NTFY_DUPLICATES_SKIPPED '+JSON.stringify({kind,count:result.duplicates}));
 return result;
}

export async function ntfySend(kind,signals){
 // Prefer an owner-controlled server-side topic when Blob is over quota.
 // This branch performs NO Blob operations and needs no Chrome tab.
 const directTopic=configuredTopic();
 if(directTopic&&['confirmed','early'].includes(kind)&&Array.isArray(signals))
  return sendEnvironmentNtfy(kind,signals,directTopic);
 const subscriptions=await listNtfy();
 const enabled=subscriptions.length>0;
 const result={enabled,delivered:0,failed:0,duplicates:0};
 if(!enabled||!['confirmed','early'].includes(kind)||!Array.isArray(signals)||!signals.length)return result;
 for(const subscriber of subscriptions){
  const pending=[];
  for(const s of signals.filter(s=>eligiblePhoneSignal(s,kind)).slice(0,6)){
   const mark='ntfy/markers/'+hash(subscriber.subscriberId+'|'+kind+'|'+s.exchange+'|'+s.symbol+'|'+s.candleCloseTime+'|'+s.direction)+'.txt';
   try{
    await put(mark,'1',{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'text/plain'});
    pending.push({mark,signal:s});
   }catch(e){if(conflict(e)){result.duplicates++;continue;}throw e;}
  }
  if(!pending.length)continue;
  const chosen=pending.map(p=>p.signal),s=chosen[0];
  const expiresAt=Math.min(...chosen.map(x=>x.expiresAt));
  if(expiresAt<Date.now()+12000){
   for(const p of pending)if(p.mark)try{await del(p.mark)}catch{}
   continue;
  }
  const isEarly=kind==='early';
  const title=chosen.length>1
   ?(isEarly?'🔮 ПРОГНОЗЫ':'🟢 ТОРГОВЫЕ ВХОДЫ')+' · '+chosen.length+' монет'
   :formatPhoneAlert(s,{early:isEarly}).title;
  const deadline=new Date(expiresAt).toLocaleTimeString('ru-RU',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit'});
  const message=chosen.length===1?
   formatPhoneAlert(s,{early:isEarly,deadline}).message:
   chosen.map(x=>formatPhoneAlert(x,{early:isEarly}).title).join('\n')+
   '\n⏰ До '+deadline+' · Проверь актуальную цену.';
  const click=chosen.length===1&&s.exchange==='WEEX'?
   (isEarly?'https://weex-radar.vercel.app/tradingview.html?symbol='+encodeURIComponent(s.symbol)+'&interval=1':
    'https://weex-radar.vercel.app/trade.html?symbol='+encodeURIComponent(s.symbol)):
   'https://weex-radar.vercel.app/';
  try{
   await publishNtfy(subscriber.topic,{title,message,priority:isEarly?4:5,click});
   result.delivered++;
   console.info('WEEX_RADAR_NTFY_SENT '+JSON.stringify({kind,count:chosen.length,accepted:true,mode:'subscribers'}));
  }catch(e){
   result.failed++;
   for(const p of pending)if(p.mark)try{await del(p.mark)}catch{}
   console.warn('WEEX_RADAR_NTFY_FAILED '+String(e.message||e).slice(0,80));
  }
 }
 return result;
}

// Follow-up on actual ntfy PRE_BREAK forecasts. Read-only and independent
// from live 1m EARLY WATCH / confirmed notifications; never calls trade routes.
export async function followupSentForecasts({
 now=Date.now(),fetchImpl=fetch,publish=publishNtfy,topic=configuredTopic(),
 markets=[]
}={}){
 const result={enabled:Boolean(topic),checked:0,sent:0,failed:0,
  pending:0,duplicates:0};
 if(!topic)return result;
 const url=BASE+encodeURIComponent(topic)+'/json?poll=1&since=10m';
 const response=await fetchImpl(url,{method:'GET',cache:'no-store',
  signal:AbortSignal.timeout(3500)});
 if(!response.ok)throw Error('ntfy history HTTP '+response.status);
 const raw=await response.text();
 if(raw.length>250000)throw Error('ntfy history oversized');
 const rows=[];
 for(const line of raw.split(/\r?\n/).slice(-400)){
  if(!line.trim())continue;
  try{const item=JSON.parse(line);if(item.topic===topic)rows.push(item)}
  catch{/* malformed ntfy line is never promoted to a forecast */}
 }
 const deliveredIds=new Set(rows.map(row=>row.sequence_id)
  .filter(id=>/^[a-f0-9]{32}$/.test(id||'')));
 const forecasts=[];
 const seen=new Set();
 for(const row of rows.slice().reverse()){
  const item=parseForecastMessage(row,now);
  if(!item||seen.has(item.id))continue;
  seen.add(item.id);
  if(deliveredIds.has(followupSequence(item))){result.duplicates++;continue;}
  // Existing early-watch sender already dedupes each 10-minute forecast.
  if(now-item.sentAt<60000)continue;
  forecasts.push(item);
  if(forecasts.length===4)break;
 }
 // Bound external WEEX requests and notifications; no new service or cron.
 await Promise.all(forecasts.map(async forecast=>{
  result.checked++;
  try{
   const marketUrl='https://api-contract.weex.com/capi/v3/market/klines?symbol='+
    encodeURIComponent(forecast.symbol)+'&interval=1m&limit=25';
   const r=await fetchImpl(marketUrl,{method:'GET',cache:'no-store',
    signal:AbortSignal.timeout(6500),headers:{Accept:'application/json'}});
   if(!r.ok)throw Error('WEEX 1m HTTP '+r.status);
   const data=await r.json();
   const candles=normalizeFollowupCandles(Array.isArray(data)?data:data?.data,now);
   const evaluated=evaluateForecast(forecast,candles,now);
   if(evaluated.status==='PENDING'||evaluated.status==='NO_DATA'){
    result.pending++;return;
   }
   const related=Array.isArray(markets)?markets.find(x=>x?.symbol===forecast.symbol):null;
   const notice=forecastFollowupMessage(forecast,evaluated,related,now);
   if(!notice){result.pending++;return;}
   // Reject a second send if prior history already contained this stable ID.
   const sequenceId=followupSequence(forecast);
   if(deliveredIds.has(sequenceId)){result.duplicates++;return}
   await publish(topic,{title:notice.title,message:notice.message,
    priority:notice.decision==='REVIEW'?5:evaluated.status==='BREAKOUT'?4:2,
    click:'https://weex-radar.vercel.app/advisor.html',sequenceId});
   deliveredIds.add(sequenceId);
   result.sent++;
   console.info('WEEX_RADAR_FORECAST_FOLLOWUP '+JSON.stringify({
    symbol:forecast.symbol,direction:forecast.direction,
    outcome:evaluated.status,decision:notice.decision,
    ageSeconds:Math.floor((now-forecast.sentAt)/1000)
   }));
  }catch(e){
   result.failed++;
   console.warn('WEEX_RADAR_FORECAST_FOLLOWUP_FAILED '+
    String(e.message||e).slice(0,75));
  }
 }));
 return result;
}

export const _test={topicOk,subscriberOk,fresh,configuredTopic,sequenceForSignal,berlinTime};
