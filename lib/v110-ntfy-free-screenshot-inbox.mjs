// Free ntfy screenshot-request intake for the RESEARCH-ONLY №110.
// Images are NEVER downloaded, decoded or interpreted: caption selects a market,
// and the existing public closed-candle WEEX forecast provides the observation.
// No paid AI API, no trading, no changes to №108 gates or orders.
import {createHash} from 'node:crypto';
import {get,list,put,del} from '@vercel/blob';
import {readStandaloneForecast,fetchPublicForecastBars} from './standalone-forecast.mjs';
import {publishNtfy} from './ntfy-alerts.mjs';
import {inspectNtfyScreenshotMessage,evaluateFrozenScreenshotHypothesis} from './v110-ntfy-screenshot-shadow.mjs';
import {profileSymbols} from './market-forecast-profiles.mjs';

const MIN=60000,ROOT='research/v110-ntfy-free/',MAX_DAILY=2;
const clamp=s=>String(s||'').slice(0,180);
const sha=s=>createHash('sha256').update(s).digest('hex');
const permitted=new Set(profileSymbols());
export const FREE_SCREENSHOT_POLICY=Object.freeze({
 mode:'NTFY_SCREENSHOT_CAPTION_WEEX_FREE_SHADOW',
 visionModel:false,paidModelCalls:0,rawImageDownloads:0,rawImageRetention:false,
 requiresCaption:true,maxPerUtcDay:MAX_DAILY,
 noAutoTrade:true,noChangeTo108:true,unverifiedPublicNtfyTopic:true
});
const dayStamp=now=>new Date(now).toISOString().slice(0,10);
const intakePath=(now,id)=>ROOT+'intake/'+dayStamp(now)+'/'+sha(id).slice(0,32)+'.json';
const pendingPath=id=>ROOT+'pending/'+sha(id).slice(0,32)+'.json';
const donePath=id=>ROOT+'done/'+dayStamp(Date.now())+'/'+sha(id).slice(0,32)+'.json';
const idFor=(tag,id)=>sha('v110-free-ntfy|'+tag+'|'+id).slice(0,32);

export function parseScreenshotCaption(row){
 const txt=[row?.title,row?.message,row?.attachment?.name].filter(x=>typeof x==='string')
  .join(' ').toUpperCase().replace(/М/g,'M').slice(0,500);
 // Ensure unambiguous supported ticker; never turn XPIN into XRP.
 const tickers=[...new Set((txt.match(/(?:^|[^A-Z0-9])([0-9A-Z]{2,20}USDT)(?=$|[^A-Z0-9])/g)||[])
  .map(m=>m.replace(/^[^A-Z0-9]+/,'').match(/([0-9A-Z]{2,20}USDT)/)?.[1]).filter(Boolean))];
 const tfs=[...new Set((txt.match(/(?:^|[^0-9A-Z])(1|5|15)\s*M(?=$|[^A-Z0-9])/g)||[])
  .map(m=>Number(m.match(/(1|5|15)\s*M/)?.[1])).filter(Boolean))];
 if(tickers.length!==1||!permitted.has(tickers[0]))return {ok:false,reason:'NO_SINGLE_SUPPORTED_SYMBOL'};
 if(tfs.length!==1)return {ok:false,reason:'NO_SINGLE_TIMEFRAME'};
 return {ok:true,symbol:tickers[0],timeframeMinutes:tfs[0]};
}
export function formatFreeScreenshotNotice({caption,forecast,status='OK'}){
 const name=caption?.symbol||'ГРАФИК';
 if(status==='CAPTION_REQUIRED')return {
  title:'📸 №110 · УТОЧНИ СКРИН',
  message:'Бесплатный режим не читает изображение. Отправь скрин с подписью, например: XRPUSDT 5M. Только монеты из списка 32. Никаких сделок.',
  priority:3
 };
 if(status==='LIMIT')return {
  title:'📸 №110 · ЛИМИТ',
  message:'Сегодня уже принято 2 снимка для исследования. Новые скрины можно прислать завтра по UTC. Без платного ИИ.',
  priority:3
 };
 if(status==='WEEX_UNAVAILABLE')return {
  title:'📸 №110 · ДАННЫЕ НЕДОСТУПНЫ',
  message:name+': сейчас нет полных свежих свечей WEEX. Прогноз не выдумываю; анализ и обучение не засчитаны.',
  priority:3
 };
 const tf=forecast.timeframes;
 const dir=forecast.combinedDirection==='LONG_BIAS'?'🟢 ВОЗМОЖНЫЙ РОСТ':
  forecast.combinedDirection==='SHORT_BIAS'?'🔴 ВОЗМОЖНОЕ ПАДЕНИЕ':'🟡 ЖДАТЬ';
 const row=tf.find(t=>t.intervalMinutes===1);
 const price=Number.isFinite(row?.price)?row.price.toPrecision(6):'неизвестна';
 const risk=forecast.reversalRisk?.risk==='HIGH'?'⚠️ Риск разворота повышен.':'⚠️ Нет гарантии направления.';
 return {title:'📸 №110 · '+name+' · '+dir,
  message:'Исследование по подписи '+caption.symbol+' '+caption.timeframeMinutes+'М.\n'+
   'Снимок НЕ распознан: анализ основан только на закрытых свечах WEEX.\n'+
   '1М / 5М / 10М: '+tf.map(f=>f.direction.replace('_BIAS','')).join(' / ')+'.\n'+
   'Цена закрытой 1М: '+price+' USDT.\n'+risk+'\n'+
   (forecast.combinedDirection==='MIXED'?
    'Нет согласованного направления, исход не будет засчитан как выигрыш.':
    'Направление зафиксировано; №110 проверит будущие закрытые свечи через 5, 10 и 15 минут.')+
   '\n⛔ Не вход в сделку, не сигнал и не прибыль.',
  priority:3};
}
export function freeSnapshot(caption,forecast,id,now){
 if(!caption?.ok||!Number.isSafeInteger(now)||
  !forecast?.available||forecast.symbol!==caption.symbol||
  forecast.exchange!=='WEEX'||!Array.isArray(forecast.timeframes)||
  forecast.timeframes.map(t=>t.intervalMinutes).join(',')!=='1,5,10')
  return null;
 const [one,five,ten]=forecast.timeframes;
 if(!Number.isFinite(one.price)||one.price<=0||
  ![one,five,ten].every(t=>Number.isSafeInteger(t.closedAt)&&t.closedAt<=now)||
  now-one.closedAt>120000)return null;
 const dir=forecast.combinedDirection;
 return {ok:true,mode:'V110_SCREENSHOT_SHADOW_FROZEN',
  id:sha(id).slice(0,32),source:'NTFY_SCREENSHOT_REQUEST_CAPTION_PLUS_WEEX_NOT_IMAGE_VISION',
  symbol:caption.symbol,observedTimeframeMinutes:caption.timeframeMinutes,
  forecastAt:now,referencePrice:one.price,
  direction:['LONG_BIAS','SHORT_BIAS'].includes(dir)?dir:'MIXED',
  horizonsMinutes:[5,10,15],uncertainty:'ntfy topic sender not independently authenticated; image not decoded',
  marketTimeframes:forecast.timeframes.map(x=>({
   intervalMinutes:x.intervalMinutes,direction:x.direction,closedAt:x.closedAt
  })),noTrade:true,noLive108Change:true,ordersSent:0,
  screenshotDecoded:false,ownerIdentityVerified:false,
  // A MIXED sample is valid uncertainty, never a forced directional success.
  scorable:['LONG_BIAS','SHORT_BIAS'].includes(dir)};
}
export function screenshotInboxDue(now=Date.now()){
 return Number.isSafeInteger(now)&&Math.floor(now/MIN)%5===2;
}
export async function pollNtfyScreenshotMessages(topic,{now=Date.now(),fetchImpl=fetch}={}){
 if(!/^wr-[a-f0-9]{32}$/.test(topic||''))throw Error('Invalid screenshot topic');
 const url='https://ntfy.sh/'+encodeURIComponent(topic)+'/json?poll=1&since=20m';
 const r=await fetchImpl(url,{cache:'no-store',signal:AbortSignal.timeout(3500),
  headers:{Accept:'application/x-ndjson'}});
 if(!r.ok)throw Error('ntfy inbox HTTP '+r.status);
 const raw=await r.text();
 if(raw.length>180000)throw Error('ntfy inbox too large');
 const entries=[];
 for(const line of raw.split(/\r?\n/).slice(-150)){
  if(!line.trim())continue;
  try{
   const msg=JSON.parse(line);
   if(msg.event==='message'&&msg.topic===topic)entries.push(msg);
  }catch{}
 }
 return entries;
}
const writeJson=(path,x,overwrite=false)=>put(path,JSON.stringify(x),{
 access:'private',addRandomSuffix:false,allowOverwrite:overwrite,
 contentType:'application/json'});
const readJson=async path=>{
 const row=await get(path,{access:'private'});
 return row?.stream?JSON.parse(await new Response(row.stream).text()):null;
};
export async function runFreeScreenshotInbox({
 env=process.env,now=Date.now(),fetchImpl=fetch,publisher=publishNtfy,
 reader=readStandaloneForecast,barsReader=fetchPublicForecastBars,
 store={get:readJson,put:writeJson,list,del},due=screenshotInboxDue
}={}){
 const topic=env.NTFY_SCREENSHOT_TOPIC;
 const result={mode:FREE_SCREENSHOT_POLICY.mode,configured:/^wr-[a-f0-9]{32}$/.test(topic||''),
  due:due(now),found:0,accepted:0,replied:0,studiesFrozen:0,studiesCompleted:0,
  skipped:0,failed:0,paidModelCalls:0,imagesDownloaded:0,
  noTrade:true,noLive108Change:true};
 if(!result.configured||!result.due)return result;
 const safeReply=async (item,notice,suffix='reply')=>{
  try{await publisher(topic,{...notice,sequenceId:idFor(suffix,item.id)});result.replied++}
  catch{result.failed++}
 };
 let rows;
 try{rows=await pollNtfyScreenshotMessages(topic,{now,fetchImpl})}
 catch{result.failed++;return result}
 const sent=new Set(rows.filter(r=>/^[a-f0-9]{32}$/.test(r.sequence_id||''))
  .map(r=>r.sequence_id));
 const images=rows.filter(row=>row.attachment&&row.event==='message').slice(-2);
 result.found=images.length;
 // No more than 2 NEW images per scan. Day-level limit applies below.
 for(const msg of images){
  const responseId=idFor('reply',msg.id);
  if(sent.has(responseId)){result.skipped++;continue}
  const valid=inspectNtfyScreenshotMessage(msg,topic,now);
  if(!valid.ok){result.skipped++;continue}
  const caption=parseScreenshotCaption(msg);
  if(!caption.ok){
   await safeReply(msg,formatFreeScreenshotNotice({status:'CAPTION_REQUIRED'}));continue;
  }
  const path=intakePath(now,msg.id);
  let used;
  try{
   if(await store.get(path)){result.skipped++;continue}
   used=(await store.list({prefix:ROOT+'intake/'+dayStamp(now)+'/',limit:25})).blobs.length;
  }catch{result.failed++;break}
  if(used>=MAX_DAILY){
   await safeReply(msg,formatFreeScreenshotNotice({status:'LIMIT'}));continue;
  }
  // Never store image binary, image link, owner text or raw ntfy topic.
  try{await store.put(path,{id:sha(msg.id).slice(0,32),at:now,
   symbol:caption.symbol,timeframeMinutes:caption.timeframeMinutes,notVision:true})}
  catch{result.failed++;continue}
  result.accepted++;
  let forecast;
  try{forecast=await reader(caption.symbol,{fetchImpl,now:Date.now()})}
  catch{await safeReply(msg,formatFreeScreenshotNotice({caption,status:'WEEX_UNAVAILABLE'}));continue}
  const frozen=freeSnapshot(caption,forecast,msg.id,Date.now());
  if(!frozen){await safeReply(msg,formatFreeScreenshotNotice({caption,status:'WEEX_UNAVAILABLE'}));continue}
  if(frozen.scorable){
   try{
    await store.put(pendingPath(msg.id),frozen);
    result.studiesFrozen++;
   }catch{result.failed++}
  }
  await safeReply(msg,formatFreeScreenshotNotice({caption,forecast}));
  // Per-scan maximum to guard against accidental bursts and hidden usage.
  if(result.accepted>=2)break;
 }
 // Check up to ONE existing frozen observation, independent of new image count.
 try{
  const pending=(await store.list({prefix:ROOT+'pending/',limit:10})).blobs;
  for(const b of pending){
   const rec=await store.get(b.pathname);
   if(!rec?.scorable||!rec.ok)continue;
   const start=Math.ceil(rec.forecastAt/MIN)*MIN;
   if(now<start+16*MIN+1000)continue;
   let data;
   try{data=await barsReader(rec.symbol,'1m',MIN,Date.now(),fetchImpl)}
   catch{continue}
   const scored=evaluateFrozenScreenshotHypothesis(rec,data,Date.now());
   if(scored.outcomes?.[15]?.status!=='OBSERVED'){
    // Missing data is uncertainty, not a loss or successful forecast.
    if(now-rec.forecastAt<60*MIN)continue;
   }
   const completed={id:rec.id,source:rec.source,symbol:rec.symbol,
    direction:rec.direction,forecastAt:rec.forecastAt,
    referencePrice:rec.referencePrice,observedTimeframeMinutes:rec.observedTimeframeMinutes,
    outcomeAt:Date.now(),outcomes:scored.outcomes,
    imageDecoded:false,ownerIdentityVerified:false,
    noTrade:true,noLive108Change:true};
   await store.put(donePath(rec.id),completed);
   await store.del(b.pathname);
   result.studiesCompleted++;
   // No automatic reply on evaluation: preserve user alert quietness.
   break;
  }
 }catch{result.failed++}
 return result;
}
