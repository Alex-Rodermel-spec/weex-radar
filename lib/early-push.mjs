// Read-only EARLY WATCH push dispatch from the existing authorized cron.
// A one-minute watch is NOT a confirmed 5-minute trading signal.
import {createHash,createHmac} from 'node:crypto';
import {get,list,put,del} from '@vercel/blob';
import webpush from 'web-push';
import {scanEarlySymbol} from './early-watch.mjs';
import {_test as marketSafety} from '../api/signals.mjs';
import {telegramConfigured,telegramSend} from './telegram-alerts.mjs';
import {ntfySend} from './ntfy-alerts.mjs';

const key=x=>createHash('sha256').update(x).digest('hex');
const conflict=e=>/exist|already|conflict|409/i.test(String(e?.message||e));
const watchFresh=(watch,now=Date.now())=>Boolean(
  watch&&watch.level==='EARLY_WATCH'&&['LONG','SHORT'].includes(watch.direction)&&
  watch.exchange==='WEEX'&&Number.isFinite(watch.candleCloseTime)&&
  watch.candleCloseTime<=now&&now-watch.candleCloseTime<=45000&&
  Number.isFinite(watch.expiresAt)&&watch.expiresAt>now+12000);

async function scanEarlyMarkets(symbols=marketSafety.SYMBOLS,scanner=scanEarlySymbol){
 const valid=[];
 // Eight concurrent symbols bounds overall latency while scanning all 16 markets.
 // A single market error never blocks confirmed 5m notifications.
 for(let i=0;i<symbols.length;i+=8){
  const chunk=await Promise.all(symbols.slice(i,i+8).map(async symbol=>{
   try{const watch=await scanner(symbol);
    return watchFresh(watch)?{symbol,...watch}:null;
   }catch{return null;}
  }));
  valid.push(...chunk.filter(Boolean));
 }
 return valid;
}
export async function sendEarlyPush(){
 // Keep the market scanner running, but only access Blob when a genuine 1m
 // watch exists. Empty scans happen almost every minute and cost no Blob ops.
 const detected=await scanEarlyMarkets();
 const signals=detected.filter(x=>watchFresh(x));
 if(!signals.length)return {checked:16,earlySignals:0,delivered:0,failed:0,duplicates:0,
   telegram:{enabled:false,delivered:0,failed:0,duplicates:0},
   ntfy:{enabled:false,delivered:0,failed:0,duplicates:0}};
 const subscriptions=await list({prefix:'subscribers/',limit:20});
 const ntfyPromise=signals.length?ntfySend('early',signals).catch(e=>{console.warn('WEEX_RADAR_NTFY_EARLY_FAILED '+String(e.message||e).slice(0,75));return {enabled:false,delivered:0,failed:1,duplicates:0};}):Promise.resolve({enabled:false,delivered:0,failed:0,duplicates:0});
 let telegram={enabled:false,delivered:0,failed:0,duplicates:0};
 if(signals.length&&telegramConfigured())try{telegram=await telegramSend('early',signals)}catch(e){console.warn('WEEX_RADAR_TELEGRAM_EARLY_FAILED '+String(e.message||e).slice(0,80))}

 if(!subscriptions.blobs.length)return {checked:16,earlySignals:signals.length,delivered:0,failed:0,duplicates:0,telegram,ntfy:await ntfyPromise};
 webpush.setVapidDetails('https://weex-radar.vercel.app',
  process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
 let delivered=0,failed=0,duplicates=0;
 for(const blob of subscriptions.blobs){
  try{
   const record=await get(blob.pathname,{access:'private'});
   if(!record?.stream)continue;
   const subscription=JSON.parse(await new Response(record.stream).text()).subscription;
   if(!subscription?.endpoint)continue;
   const subscriberId=key(subscription.endpoint);
   // At most one early-watch notification every 2 minutes per subscriber.
   // This is separate from the existing confirmed 5m push channel.
   const windowId=Math.floor(Date.now()/120000);
   const throttle='early-push-throttle/'+subscriberId+'/'+windowId+'.txt';
   try{await put(throttle,'1',{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'text/plain'});}
   catch(e){if(conflict(e)){duplicates++;continue;}throw e;}
   const eligible=signals.filter(s=>watchFresh(s));
   const selected=eligible.slice(0,6);
   if(!selected.length){await del(throttle);continue;}
   const primary=selected[0];
   const markNames=selected.map(s=>'early-push-markers/'+key(subscriberId+'|'+s.symbol+'|'+s.candleCloseTime+'|'+s.direction)+'.txt');
   const toSend=[];
   for(let i=0;i<selected.length;i++){
    const mark=markNames[i];
    try{
     await put(mark,'1',{access:'private',contentType:'text/plain',addRandomSuffix:false,allowOverwrite:false});
     toSend.push({mark,signal:selected[i]});
    }catch(e){if(conflict(e)){duplicates++;continue;}throw e;}
   }
   if(!toSend.length){await del(throttle);continue;}
   const chosen=toSend.map(x=>x.signal);
   const first=chosen[0],expiry=Math.min(...chosen.map(x=>x.expiresAt));
   if(expiry<Date.now()+10000){
    for(const x of toSend)await del(x.mark);
    await del(throttle);
    continue;
   }
   const deliveryId=key(subscriberId+'|early|'+toSend.map(x=>x.mark).join('|')).slice(0,32);
   const proof=createHmac('sha256',process.env.PUSH_CRON_KEY)
     .update(deliveryId+'|'+subscriberId+'|early_watch').digest('hex');
   const title=chosen.length===1
     ?'⚡ РАННЕЕ '+first.symbol+' '+first.direction+' · 1м'
     :'⚡ РАННИЕ ПРЕДУПРЕЖДЕНИЯ · '+chosen.length+' монет';
   const body=chosen.length===1
     ?'НЕ ВХОДИТЬ без подтверждения 5м · WEEX · '+first.livePrice+' USDT · до '+new Date(expiry).toLocaleTimeString('ru-RU',{timeZone:'Europe/Berlin'})
     :chosen.map(s=>s.symbol+' '+s.direction).join(' · ')+' · WATCH, не готовые сделки';
   const msg={title,body,kind:'early_watch',symbol:chosen.length===1?first.symbol:'BATCH',
     direction:chosen.length===1?first.direction:'MULTI',exchange:'WEEX',
     candleCloseTime:first.candleCloseTime,expiresAt:expiry,
     url:'/tradingview.html?symbol='+encodeURIComponent(first.symbol)+'&interval=1',
     deliveryId,deliveryProof:proof,subscriberId};
   try{
    await webpush.sendNotification(subscription,JSON.stringify(msg),{TTL:50,urgency:'normal'});
    delivered++;
    console.info('WEEX_RADAR_EARLY_PUSH_GATEWAY '+JSON.stringify({
     id:deliveryId.slice(0,12),count:chosen.length,accepted:true,kind:'early_watch'}));
   }catch(e){
    failed++;
    for(const x of toSend)try{await del(x.mark)}catch{}
    try{await del(throttle)}catch{}
    if(e.statusCode===404||e.statusCode===410)try{await del(blob.pathname)}catch{}
    console.warn('WEEX_RADAR early push failed',Number(e?.statusCode)||'SEND_FAILED');
   }
  }catch(e){failed++;console.warn('WEEX_RADAR early subscriber failed',String(e.message||e).slice(0,90))}
 }
 return {checked:16,earlySignals:signals.length,delivered,failed,duplicates,telegram,ntfy:await ntfyPromise};
}
export const _test={watchFresh,scanEarlyMarkets};
