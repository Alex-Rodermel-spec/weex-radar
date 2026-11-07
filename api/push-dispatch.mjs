import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {get,list,put,del} from '@vercel/blob';
import webpush from 'web-push';
import {jwtVerify,createRemoteJWKSet} from 'jose';
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
  const response=await fetch('https://weex-radar.vercel.app/api/signals',{cache:'no-store',signal:AbortSignal.timeout(26000)});
  if(!response.ok)throw Error('Radar API '+response.status);
  const result=await response.json();
  if(!Number.isFinite(result.generatedAt)||Math.abs(Date.now()-result.generatedAt)>90000||!Array.isArray(result.symbols))throw Error('Stale/invalid scan');
  const signals=result.symbols.filter(s=>s.status==='ok'&&['LONG','SHORT'].includes(s.direction)&&s.expiresAt>Date.now()+15000&&s.exchange&&s.candleCloseTime);
  if(!signals.length)return reply(res,source,200,{ok:true,signals:0,delivered:0});
  const entries=await loadSubscriptions();
  if(!entries.length)return reply(res,source,200,{ok:true,signals:signals.length,subscribers:0,delivered:0});
  webpush.setVapidDetails('https://weex-radar.vercel.app',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  let delivered=0,failed=0,duplicates=0;
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
     try{await put(mark,'1',{access:'private',contentType:'text/plain',addRandomSuffix:false});}
     catch(e){if(/exist|already|conflict/i.test(String(e.message))){duplicates++;continue}throw e}
     pending.push({signal,mark});
    }
    if(!pending.length)continue;
    const selected=pending.map(item=>item.signal);
    const primary=selected[0],strong=selected.some(s=>s.level==='STRONG');
    const deliveryId=key(subscriber.endpoint+'|'+pending.map(({mark})=>mark).join('|')).slice(0,32);
    const deliveryProof=createHmac('sha256',process.env.PUSH_CRON_KEY).update(deliveryId).digest('hex');
    const title=selected.length===1
      ?(strong?'🟣 СИЛЬНЫЙ':'Сигнал')+' '+primary.symbol+' '+primary.direction
      :(strong?'🟣 СИЛЬНЫЕ':'Сигналы')+' WEEX · '+selected.length+' монет';
    const body=selected.length===1
      ?primary.exchange+' · '+primary.price+' USDT · SL '+primary.stop+' · TP '+primary.take+' · до '+new Date(primary.expiresAt).toLocaleTimeString('ru-RU',{timeZone:'Europe/Berlin'})
      :selected.slice(0,4).map(s=>s.symbol+' '+s.direction).join(' · ')+(selected.length>4?' · ещё '+(selected.length-4):'')+' · смотри TP/SL в RADAR';
    const message={title,body,
      symbol:selected.length===1?primary.symbol:'BATCH',
      exchange:primary.exchange,
      direction:selected.length===1?primary.direction:'MULTI',
      candleCloseTime:primary.candleCloseTime,expiresAt:Math.min(...selected.map(s=>s.expiresAt)),
      deliveryId,deliveryProof};
    try{
     // Accepted by the push gateway is not confirmation of receipt on Android.
     await webpush.sendNotification(subscriber,JSON.stringify(message),{TTL:150,urgency:'high'});
     delivered++;
     console.info('WEEX_RADAR_PUSH_GATEWAY '+JSON.stringify({id:deliveryId.slice(0,12),count:selected.length,accepted:true}));
    }catch(e){
     failed++;
     // Revert all pending markers on a failed gateway request to permit a retry.
     for(const {mark} of pending){
      try{await del(mark)}catch{console.warn('WEEX_RADAR unable to reset failed push marker')}
     }
     if(e.statusCode===404||e.statusCode===410)await del(blob.pathname);
    }
   }catch(e){failed++;console.warn('Push item failed',e.message)}
  }
  return reply(res,source,200,{ok:true,signals:signals.length,subscribers:entries.length,delivered,failed,duplicates});
 }catch(e){console.error('Push check failed:',e.message);return reply(res,source,503,{error:'Scan or notification delivery unavailable'})}
}
