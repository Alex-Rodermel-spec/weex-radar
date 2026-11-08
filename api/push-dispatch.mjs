import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {get,list,put,del} from '@vercel/blob';
import webpush from 'web-push';
import {jwtVerify,createRemoteJWKSet} from 'jose';
import {_test as marketSafety} from './signals.mjs';
import {sendEarlyPush} from '../lib/early-push.mjs';
import {telegramPoll,telegramSend} from '../lib/telegram-alerts.mjs';
const JWKS=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
function secureEquals(a,b){if(!a||!b)return false;let x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
async function authorized(req){
 const header=req.headers.authorization||'';
 if(header.startsWith('Bearer ')){
  try{
   const {payload}=await jwtVerify(header.substring(7),JWKS,{issuer:'https://token.actions.githubusercontent.com',audience:'weex-radar-push'});
   return payload.repository==='Alex-Rodermel-spec/weex-radar'&&payload.ref==='refs/heads/main'&&
    ['schedule','workflow_dispatch'].includes(payload.event_name)&&
    String(payload.workflow_ref||'')==='Alex-Rodermel-spec/weex-radar/.github/workflows/push-notifications.yml@refs/heads/main' ? 'github' : null;
  }catch{return false}
 }
 return secureEquals(req.headers['x-radar-cron-key'],process.env.PUSH_CRON_KEY) ? 'cron' : null;
}
async function loadSubscriptions(){
 let rows=[],cursor;
 do{
  const page=await list({prefix:'subscribers/',limit:30,cursor});
  rows.push(...page.blobs);
  cursor=page.hasMore?page.cursor:undefined;
 }while(cursor&&rows.length<50);
 return rows.slice(0,20);
}
function key(x){return createHash('sha256').update(x).digest('hex')}

function isConflict(e){return /exist|already|conflict|409/i.test(String(e?.message||e));}
function signalReceiptPath(mark){return 'receipts/signals/'+key(mark)+'.json';}
async function mayRetrySignal(mark,signal){
 const now=Date.now();
 // One retry only, after enough time for Chrome to acknowledge the original.
 if(!Number.isFinite(signal.expiresAt)||signal.expiresAt<now+30000)return false;
 const original=await get(mark,{access:'private'});
 if(!original?.stream)return false;
 let sent;
 try{sent=JSON.parse(await new Response(original.stream).text())}catch{return false}
 if(!Number.isFinite(sent.firstSentAt)||now-sent.firstSentAt<55000)return false;
 const ack=await get(signalReceiptPath(mark),{access:'private'});
 if(ack?.stream){
   try{const row=JSON.parse(await new Response(ack.stream).text());if(row.result==='shown')return false}catch{}
 }
 try{
  await put('retries/'+key(mark)+'.txt','1',
    {access:'private',contentType:'text/plain',addRandomSuffix:false,allowOverwrite:false});
  return true;
 }catch(e){if(isConflict(e))return false;throw e;}
}


async function sendDueBackgroundTests(){
 const jobs=await list({prefix:'background-tests/',limit:15});
 const now=Date.now();
 let accepted=0,failed=0;
 webpush.setVapidDetails('https://weex-radar.vercel.app',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
 for(const blob of jobs.blobs){
  try{
   const row=await get(blob.pathname,{access:'private'});
   if(!row)continue;
   const task=JSON.parse(await new Response(row.stream).text());
   if(task.status!=='queued'||!Number.isFinite(task.dueAt)||task.dueAt>now||now-task.dueAt>600000)continue;
   if(!/^[a-f0-9]{32}$/.test(task.id||'')||!/^[a-f0-9]{64}$/.test(task.subscriberId||''))continue;
   try{await put('background-test-locks/'+task.id+'.txt','1',{access:'private',allowOverwrite:false,addRandomSuffix:false})}
   catch(e){if(/exist|already|conflict|409/i.test(String(e.message||e)))continue;throw e}
   try{
    const subscriberFile=await get('subscribers/'+task.subscriberId+'.json',{access:'private'});
    if(!subscriberFile)throw Error('SUBSCRIBER_MISSING');
    const subscriber=JSON.parse(await new Response(subscriberFile.stream).text()).subscription;
    if(!subscriber?.endpoint||key(subscriber.endpoint)!==task.subscriberId)throw Error('SUBSCRIBER_CHANGED');
    const signalStyle=task.mode==='signal_test';
    const kind=signalStyle?'signal_test':'background_test';
    const deliveryProof=createHmac('sha256',process.env.PUSH_CRON_KEY)
      .update(task.id+'|'+task.subscriberId+'|'+kind).digest('hex');
    // No real market signal; no exchange order; never open a trade on test click.
    const message=signalStyle
      ?{title:'🧪 ТЕСТ LONG BTCUSDT — НЕ СДЕЛКА',
        body:'ТЕСТОВОЕ уведомление LONG/SHORT. Не торговать! Это не рыночный сигнал.',
        exchange:'WEEX',symbol:'BTCUSDT',direction:'LONG',candleCloseTime:Date.now(),
        expiresAt:Date.now()+180000,url:'/',deliveryId:task.id,deliveryProof,
        subscriberId:task.subscriberId,kind}
      :{title:'🌙 WEEX RADAR — тест в фоне',
        body:'Это уведомление отправил сервер без открытой вкладки Chrome.',
        symbol:'TEST',candleCloseTime:Date.now(),deliveryId:task.id,deliveryProof,
        subscriberId:task.subscriberId,kind};
    await webpush.sendNotification(subscriber,JSON.stringify(message),{TTL:180,urgency:'high'});
    accepted++;task.status='sent';task.sentAt=Date.now();
    console.info('WEEX_RADAR_BACKGROUND_TEST_GATEWAY '+JSON.stringify({id:task.id.slice(0,12),accepted:true,kind}));
   }catch(e){
    failed++;task.status='failed';task.error=Number(e?.statusCode)?'PUSH_HTTP_'+Number(e.statusCode):'SEND_FAILED';
    console.warn('WEEX_RADAR background test failed',task.error);
   }
   await put(blob.pathname,JSON.stringify(task),{access:'private',allowOverwrite:true,contentType:'application/json'});
  }catch(e){failed++;console.warn('WEEX_RADAR background-test job failure',String(e.message||e).slice(0,90))}
 }
 return {accepted,failed};
}

// Audit scheduling without storing secrets, subscriber addresses or balances.
// Log each authorized run, including healthy scans with zero trading signals.
export function dispatchAudit(source,http,body,checkedAt=Date.now()){
 if(!['cron','github'].includes(source))throw Error('Unknown scheduler');
 return JSON.stringify({source,http,checkedAt,
   signals:Number.isSafeInteger(body?.signals)?body.signals:0,
   delivered:Number.isSafeInteger(body?.delivered)?body.delivered:0,
   failed:Number.isSafeInteger(body?.failed)?body.failed:0,
   subscribers:Number.isSafeInteger(body?.subscribers)?body.subscribers:null,
   duplicates:Number.isSafeInteger(body?.duplicates)?body.duplicates:0});
}
async function safeEarlyPush(){
 try{
  const early=await sendEarlyPush();
  // Audit scans even when no early signal is found.
  console.info('WEEX_RADAR_EARLY_DISPATCH '+JSON.stringify(early));
  return early;
 }catch(e){
  console.warn('WEEX_RADAR_EARLY_SCAN_FAILED '+String(e.message||e).slice(0,110));
  return {checked:0,earlySignals:0,delivered:0,failed:1};
 }
}
function reply(res,source,http,body){
 console.info('WEEX_RADAR_DISPATCH '+dispatchAudit(source,http,body));
 return res.status(http).json(body);
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST'&&req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const source=await authorized(req);
 if(!source)return res.status(401).json({error:'Unauthorized'});
 if(!process.env.BLOB_READ_WRITE_TOKEN||!process.env.VAPID_PRIVATE_KEY||!process.env.VAPID_PUBLIC_KEY||!process.env.PUSH_CRON_KEY)return res.status(503).json({error:'Push not configured'});
 try{
  let background={accepted:0,failed:0};
  try{await telegramPoll()}catch(e){console.warn('WEEX_RADAR_TELEGRAM_POLL_FAILED '+String(e.message||e).slice(0,80))}
  try{background=await sendDueBackgroundTests()}catch(e){console.warn('WEEX_RADAR background test check unavailable',String(e.message||e).slice(0,90))}
  const response=await fetch('https://weex-radar.vercel.app/api/signals',{cache:'no-store',signal:AbortSignal.timeout(26000)});
  if(!response.ok)throw Error('Radar API '+response.status);
  const result=await response.json();
  if(!Number.isFinite(result.generatedAt)||Math.abs(Date.now()-result.generatedAt)>90000||!Array.isArray(result.symbols))throw Error('Stale/invalid scan');
  const candidates=result.symbols.filter(s=>s.status==='ok'&&['LONG','SHORT'].includes(s.direction)&&
    s.expiresAt>Date.now()+15000&&s.exchange&&s.candleCloseTime);
  // A cached or slow scan is NOT a live entry. Recheck exchange quotes immediately
  // before gateway delivery, and stop late 5-minute-candle alerts.
  const checked=await Promise.all(candidates.map(async signal=>{
    if(Date.now()-signal.candleCloseTime>90000)return null;
    try{
      const quote=await marketSafety.fetchCurrentQuote(signal.symbol,signal.exchange);
      const quality=marketSafety.currentPriceQuality(signal.direction,signal.price,
        Number(signal.indicators?.atr),quote.price);
      return quality.ok?{...signal,livePrice:quote.price}:null;
    }catch{return null}
  }));
  const signals=checked.filter(Boolean);
  if(candidates.length>signals.length)console.info('WEEX_RADAR_ENTRY_FILTER '+
    JSON.stringify({candidates:candidates.length,accepted:signals.length,blocked:candidates.length-signals.length}));
  let telegram={enabled:false,delivered:0,failed:0,duplicates:0};
  if(signals.length)try{telegram=await telegramSend('confirmed',signals)}catch(e){console.warn('WEEX_RADAR_TELEGRAM_SEND_FAILED '+String(e.message||e).slice(0,80))}
  if(!signals.length)return reply(res,source,200,{ok:true,signals:0,delivered:0,background,early:await safeEarlyPush(),telegram});
  const entries=await loadSubscriptions();
  if(!entries.length)return reply(res,source,200,{ok:true,signals:signals.length,subscribers:0,delivered:0,early:await safeEarlyPush(),telegram});
  webpush.setVapidDetails('https://weex-radar.vercel.app',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  let delivered=0,failed=0,duplicates=0,retried=0;
  for(const blob of entries){
   try{
    const record=await get(blob.pathname,{access:'private'});
    if(!record)continue;
    const subscriber=JSON.parse(await new Response(record.stream).text()).subscription;
    if(!subscriber?.endpoint)continue;
    // One Web Push notification per scan/subscriber. Multiple coins in the same
    // minute are combined instead of triggering Chrome's spam defenses.
    const pending=[];
    for(const signal of signals){
     const mark='delivered/'+key(subscriber.endpoint+signal.exchange+signal.symbol+signal.candleCloseTime+signal.direction)+'.txt';
     try{
      await put(mark,JSON.stringify({firstSentAt:Date.now()}),
        {access:'private',contentType:'application/json',addRandomSuffix:false,allowOverwrite:false});
      pending.push({signal,mark});
     }catch(e){
      if(!isConflict(e))throw e;
      duplicates++;
      // FCM acceptance without a signed Chrome receipt is not proof of delivery.
      // Re-attempt one time only while the signal is still fresh.
      if(await mayRetrySignal(mark,signal)){
       pending.push({signal,mark,retry:true});retried++;
      }
     }
    }
    if(!pending.length)continue;
    const selected=pending.map(item=>item.signal);
    const primary=selected[0],strong=selected.some(s=>s.level==='STRONG');
    const deliveryId=key(subscriber.endpoint+'|'+pending.map(({mark})=>mark).join('|')).slice(0,32);
    const subscriberId=key(subscriber.endpoint);
    await put('push-deliveries/'+deliveryId+'.json',
      JSON.stringify({subscriberId,marks:pending.map(({mark})=>mark)}),
      {access:'private',allowOverwrite:true,contentType:'application/json'});
    const deliveryProof=createHmac('sha256',process.env.PUSH_CRON_KEY).update(deliveryId+'|'+subscriberId+'|signal').digest('hex');
    const title=selected.length===1
      ?(strong?'🟣 СИЛЬНЫЙ':'Сигнал')+' '+primary.symbol+' '+primary.direction
      :(strong?'🟣 СИЛЬНЫЕ':'Сигналы')+' WEEX · '+selected.length+' монет';
    const body=selected.length===1
      ?primary.exchange+' · цена сейчас '+Number(primary.livePrice).toPrecision(6)+' USDT · свеча '+primary.price+' · SL '+primary.stop+' · TP '+primary.take+' · до '+new Date(primary.expiresAt).toLocaleTimeString('ru-RU',{timeZone:'Europe/Berlin'})
      :selected.slice(0,4).map(s=>s.symbol+' '+s.direction).join(' · ')+(selected.length>4?' · ещё '+(selected.length-4):'')+' · смотри TP/SL в RADAR';
    const message={title,body,
      symbol:selected.length===1?primary.symbol:'BATCH',
      exchange:primary.exchange,
      direction:selected.length===1?primary.direction:'MULTI',
      candleCloseTime:primary.candleCloseTime,sentAt:Date.now(),expiresAt:Math.min(...selected.map(s=>s.expiresAt)),
      deliveryId,deliveryProof,subscriberId,kind:'signal',
      url:selected.length===1&&primary.exchange==='WEEX'?'/trade.html?symbol='+encodeURIComponent(primary.symbol):'/'};
    try{
     // Accepted by the push gateway is not confirmation of receipt on Android.
     await webpush.sendNotification(subscriber,JSON.stringify(message),{TTL:150,urgency:'high'});
     delivered++;
     try{
      await put('signal-status/'+subscriberId+'.json',
        JSON.stringify({id:deliveryId,at:Date.now(),expiresAt:message.expiresAt,
          symbol:primary.symbol,direction:primary.direction,retry:pending.some(p=>p.retry)}),
        {access:'private',allowOverwrite:true,contentType:'application/json'});
     }catch(e){console.warn('WEEX_RADAR signal status write unavailable',String(e.message||e).slice(0,90))}
     console.info('WEEX_RADAR_PUSH_GATEWAY '+JSON.stringify({id:deliveryId.slice(0,12),count:selected.length,accepted:true,retry:pending.some(p=>p.retry)}));
    }catch(e){
     failed++;
     // Revert all pending markers on a failed gateway request to permit a retry.
     for(const {mark,retry} of pending){
      if(retry)continue; // Retried signals retain their original first-send marker.
      try{await del(mark)}catch{console.warn('WEEX_RADAR unable to reset failed push marker')}
     }
     if(e.statusCode===404||e.statusCode===410)await del(blob.pathname);
    }
   }catch(e){failed++;console.warn('Push item failed',e.message)}
  }
  return reply(res,source,200,{ok:true,signals:signals.length,subscribers:entries.length,delivered,failed,duplicates,retried,early:await safeEarlyPush(),telegram});
 }catch(e){console.error('Push check failed:',e.message);return reply(res,source,503,{error:'Scan or notification delivery unavailable'})}
}
