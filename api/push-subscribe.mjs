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
  // Browser reopens with permission already granted: check whether the
  // push gateway previously rejected and removed this exact endpoint.
  // A missing subscription must be recreated in the browser, not silently
  // reinserted with the same stale endpoint.
  if(req.body?.checkOnly===true)return res.status(200).json({
    ok:true,present:r.blobs.some(b=>b.pathname===path)
  });
  if(r.blobs.length>=10&&!r.blobs.some(b=>b.pathname===path))return res.status(429).json({error:'Subscription limit reached'});
  await put(path,JSON.stringify({subscription:sub,createdAt:Date.now()}),{access:'private',allowOverwrite:true,contentType:'application/json',cacheControlMaxAge:60});
  let testSent=false;
  let testError=null;
  try{
   if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY)throw Error('VAPID_KEYS_MISSING');
   webpush.setVapidDetails(ORIGIN,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
   const payload={title:'🔔 WEEX RADAR — проверка связи',body:'Проверка фоновых уведомлений. Если сообщение видно — связь работает.',symbol:'TEST',candleCloseTime:Date.now()};
   await webpush.sendNotification(sub,JSON.stringify(payload),{TTL:90,urgency:'high'});
   testSent=true;
   console.log('WEEX_RADAR test push accepted by push gateway');
  }catch(e){
   const status=Number(e.statusCode||0);
   testError=status?('PUSH_HTTP_'+status):(e.message==='VAPID_KEYS_MISSING'?'VAPID_KEYS_MISSING':'PUSH_SEND_FAILED');
   if(status===404||status===410){
    // The browser push endpoint is invalid; never persist it as active.
    try{await del(path)}catch{console.warn('Failed to discard expired push endpoint')}
   }
   console.warn('WEEX_RADAR test push failed',testError,String(e.message||'').slice(0,140));
  }
  return res.status(200).json({ok:true,subscribed:true,testSent,testError});

 }catch(e){console.error('subscription operation failed:',e.message);return res.status(503).json({error:'Push storage unavailable'})}
}
