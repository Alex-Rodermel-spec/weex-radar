import {createHash} from 'node:crypto';
import {put,list,del} from '@vercel/blob';
import webpush from 'web-push';
const ORIGIN='https://weex-radar.vercel.app';
function valid(s){
 if(!s||typeof s!=='object'||typeof s.endpoint!=='string'||s.endpoint.length>1500||!s.keys||typeof s.keys.p256dh!=='string'||typeof s.keys.auth!=='string')return false;
 let u;try{u=new URL(s.endpoint)}catch{return false}
 const hosts=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','push.services.mozilla.com'];
 return u.protocol==='https:'&&hosts.includes(u.hostname)&&s.keys.p256dh.length<180&&s.keys.auth.length<100;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST'&&req.method!=='DELETE')return res.status(405).json({error:'Method not allowed'});
 if(req.headers.origin!==ORIGIN)return res.status(403).json({error:'Origin not allowed'});
 if(!process.env.BLOB_READ_WRITE_TOKEN)return res.status(503).json({error:'Push storage not configured'});
 const sub=req.body?.subscription??req.body;
 if(!valid(sub))return res.status(400).json({error:'Invalid push subscription'});
 const id=createHash('sha256').update(sub.endpoint).digest('hex');
 const path='subscribers/'+id+'.json';
 try{
  if(req.method==='DELETE'){await del(path);return res.status(200).json({ok:true,removed:true})}
  const r=await list({prefix:'subscribers/',limit:11});
  if(r.blobs.length>=10&&!r.blobs.some(b=>b.pathname===path))return res.status(429).json({error:'Subscription limit reached'});
  await put(path,JSON.stringify({subscription:sub,createdAt:Date.now()}),{access:'private',allowOverwrite:true,contentType:'application/json',cacheControlMaxAge:60});
  let testSent=false;
  try{
   // Only send one welcome/test notification per device, to avoid spam.
   await put('tests/'+id+'.txt','1',{access:'private',addRandomSuffix:false,contentType:'text/plain'});
   webpush.setVapidDetails(ORIGIN,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
   await webpush.sendNotification(sub,JSON.stringify({title:'🔔 WEEX RADAR — проверка связи',body:'Фоновые уведомления подключены. Звук и вибрация зависят от настроек Android.',symbol:'TEST',candleCloseTime:Date.now()}),{TTL:60,urgency:'high'});
   testSent=true;
  }catch(e){console.log('First push skipped or not delivered:',e.message)}
  return res.status(200).json({ok:true,testSent});
 }catch(e){console.error('subscription operation failed:',e.message);return res.status(503).json({error:'Push storage unavailable'})}
}
