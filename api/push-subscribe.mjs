import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {get,put,list,del} from '@vercel/blob';
import webpush from 'web-push';
const ORIGIN='https://weex-radar.vercel.app';
function secureEqual(a,b){if(!a||!b)return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
function valid(s){
 if(!s||typeof s!=='object'||typeof s.endpoint!=='string'||s.endpoint.length>1500||!s.keys||typeof s.keys.p256dh!=='string'||typeof s.keys.auth!=='string')return false;
 let u;try{u=new URL(s.endpoint)}catch{return false}
 const hosts=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','push.services.mozilla.com'];
 return u.protocol==='https:'&&hosts.includes(u.hostname)&&s.keys.p256dh.length<180&&s.keys.auth.length<100;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST'&&req.method!=='DELETE')return res.status(405).json({error:'Method not allowed'});
 // A signed background-worker receipt shares this route to stay within
 // Vercel Hobby's 12-function limit. It is not a browser notification guarantee.
 if(req.method==='POST'&&req.body?.receipt){
  if(req.headers.origin&&req.headers.origin!==ORIGIN)return res.status(403).json({error:'Origin not allowed'});
  const {id,proof,result,subscriberId,kind}=req.body.receipt;
  if(!/^[a-f0-9]{32}$/.test(id||'')||!/^[a-f0-9]{64}$/.test(proof||'')||
     !/^[a-f0-9]{64}$/.test(subscriberId||'')||!['signal','test','background_test'].includes(kind)||
     !['shown','show_error'].includes(result))return res.status(400).json({error:'Invalid receipt'});
  if(!process.env.PUSH_CRON_KEY||!process.env.BLOB_READ_WRITE_TOKEN)return res.status(503).json({error:'Receipts unavailable'});
  const expected=createHmac('sha256',process.env.PUSH_CRON_KEY).update(id+'|'+subscriberId+'|'+kind).digest('hex');
  if(!secureEqual(proof,expected))return res.status(403).json({error:'Invalid receipt signature'});
  const at=Date.now();
  try{
    await put('receipts/'+subscriberId+'.json',JSON.stringify({result,kind,at}),
      {access:'private',allowOverwrite:true,contentType:'application/json'});
  }catch(e){
    console.warn('WEEX_RADAR receipt storage failed',String(e.message||e).slice(0,100));
    return res.status(503).json({error:'Receipt storage unavailable'});
  }
  console.info('WEEX_RADAR_PUSH_WORKER '+JSON.stringify({id:id.slice(0,12),result,kind,at}));
  return res.status(200).json({ok:true});
 }
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
  if(req.body?.checkOnly===true){
    const present=r.blobs.some(b=>b.pathname===path);
    let lastReceipt=null,backgroundTest=null;
    if(present){
      try{
        const receipt=await get('receipts/'+id+'.json',{access:'private'});
        if(receipt?.stream){
          const row=JSON.parse(await new Response(receipt.stream).text());
          if(['shown','show_error'].includes(row.result)&&['test','signal','background_test'].includes(row.kind)&&Number.isFinite(row.at))
            lastReceipt={result:row.result,kind:row.kind,at:row.at};
        }
      }catch(e){console.warn('WEEX_RADAR receipt lookup unavailable',String(e.message||e).slice(0,80));}
    }
    if(present){
      try{
        const job=await get('background-tests/'+id+'.json',{access:'private'});
        if(job?.stream){
          const t=JSON.parse(await new Response(job.stream).text());
          if(['queued','sent','failed'].includes(t.status)&&Number.isFinite(t.dueAt))
            backgroundTest={status:t.status,dueAt:t.dueAt,queuedAt:t.queuedAt||0,sentAt:t.sentAt||null,error:t.error||null};
        }
      }catch(e){console.warn('WEEX_RADAR background test lookup unavailable',String(e.message||e).slice(0,80));}
    }
    return res.status(200).json({ok:true,present,lastReceipt,backgroundTest});
  }
  if(req.body?.queueBackgroundTest===true){
    if(!r.blobs.some(b=>b.pathname===path))return res.status(409).json({error:'Activate push subscription first'});
    const jobPath='background-tests/'+id+'.json';
    let previous=null;
    try{
      const saved=await get(jobPath,{access:'private'});
      if(saved?.stream)previous=JSON.parse(await new Response(saved.stream).text());
    }catch(e){console.warn('WEEX_RADAR background test previous state unavailable',String(e.message||e).slice(0,70));}
    if(previous&&Number.isFinite(previous.queuedAt)&&Date.now()-previous.queuedAt<240000)
      return res.status(429).json({error:'Background test already scheduled recently'});
    const now=Date.now();
    const job={id:randomBytes(16).toString('hex'),subscriberId:id,queuedAt:now,dueAt:now+75000,status:'queued'};
    await put(jobPath,JSON.stringify(job),{access:'private',allowOverwrite:true,contentType:'application/json'});
    console.info('WEEX_RADAR_BACKGROUND_TEST_SCHEDULED '+JSON.stringify({dueAt:job.dueAt}));
    return res.status(200).json({ok:true,scheduled:true,dueAt:job.dueAt});
  }
  if(r.blobs.length>=10&&!r.blobs.some(b=>b.pathname===path))return res.status(429).json({error:'Subscription limit reached'});
  await put(path,JSON.stringify({subscription:sub,createdAt:Date.now()}),{access:'private',allowOverwrite:true,contentType:'application/json',cacheControlMaxAge:60});
  let testSent=false;
  let testError=null;
  try{
   if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY)throw Error('VAPID_KEYS_MISSING');
   webpush.setVapidDetails(ORIGIN,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
   const deliveryId=randomBytes(16).toString('hex');
   const deliveryProof=process.env.PUSH_CRON_KEY?createHmac('sha256',process.env.PUSH_CRON_KEY).update(deliveryId+'|'+id+'|test').digest('hex'):null;
   const payload={title:'🔔 WEEX RADAR — проверка связи',body:'Проверка фоновых уведомлений. Если сообщение видно — связь работает.',symbol:'TEST',candleCloseTime:Date.now(),deliveryId,deliveryProof,subscriberId:id,kind:'test'};
   await webpush.sendNotification(sub,JSON.stringify(payload),{TTL:90,urgency:'high'});
   testSent=true;
   console.info('WEEX_RADAR_TEST_GATEWAY '+JSON.stringify({id:deliveryId.slice(0,12),accepted:true}));
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
