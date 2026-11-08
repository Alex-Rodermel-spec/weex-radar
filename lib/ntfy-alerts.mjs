// Optional ntfy.sh delivery for Android without keeping Chrome open.
// Each topic is a random 128-bit bearer secret, stored privately in Vercel Blob.
// The public ntfy server is an independent third-party notification relay.
import {createHash} from 'node:crypto';
import {get,list,put,del} from '@vercel/blob';

const BASE='https://ntfy.sh/';
const topicOk=topic=>/^wr-[a-f0-9]{32}$/.test(topic||'');
const subscriberOk=id=>/^[a-f0-9]{64}$/.test(id||'');
const rowPath=id=>'ntfy/subscribers/'+id+'.json';
const hash=s=>createHash('sha256').update(s).digest('hex');
const conflict=e=>/exist|already|conflict|409/i.test(String(e?.message||e));
const fresh=s=>s&&['LONG','SHORT'].includes(s.direction)&&
 Number.isFinite(s.expiresAt)&&s.expiresAt>Date.now()+12000&&
 Number.isFinite(s.candleCloseTime)&&['WEEX','Bybit'].includes(s.exchange);

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
export async function publishNtfy(topic,{title,message,priority=4,click='https://weex-radar.vercel.app/'}){
 if(!topicOk(topic))throw Error('Invalid ntfy topic');
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),5500);
 try{
  const response=await fetch(BASE,{method:'POST',signal:ctrl.signal,
   headers:{'Content-Type':'application/json','User-Agent':'WEEX-RADAR/1.0'},
   body:JSON.stringify({topic,title,message,priority,click})});
  if(!response.ok)throw Error('ntfy HTTP '+response.status);
  return true;
 }finally{clearTimeout(timer);}
}
export async function ntfySend(kind,signals){
 const subscriptions=await listNtfy();
 const enabled=subscriptions.length>0;
 const result={enabled,delivered:0,failed:0,duplicates:0};
 if(!enabled||!['confirmed','early'].includes(kind)||!Array.isArray(signals)||!signals.length)return result;
 for(const subscriber of subscriptions){
  const pending=[];
  for(const s of signals.filter(fresh).slice(0,6)){
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
   for(const p of pending)try{await del(p.mark)}catch{}
   continue;
  }
  const isEarly=kind==='early';
  const title=chosen.length>1
   ?(isEarly?'⚡ EARLY WATCH':'🟣 WEEX RADAR')+' · '+chosen.length+' монет'
   :(isEarly?'⚡ EARLY WATCH':s.level==='STRONG'?'🟣 СИЛЬНЫЙ':'Сигнал')+' '+s.symbol+' '+s.direction;
  const deadline=new Date(expiresAt).toLocaleTimeString('ru-RU',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit'});
  const description=chosen.length===1?
   (s.exchange+' · цена '+Number(s.livePrice||s.price||s.closePrice).toPrecision(6)+' USDT'+
    (isEarly?' · ЖДАТЬ 5м!':' · SL '+s.stop+' · TP '+s.take)):
   chosen.map(x=>x.exchange+' '+x.symbol+' '+x.direction).join(' · ');
  const message=description+' · до '+deadline+
   (isEarly?' · Раннее наблюдение, не вход!':' · Проверь актуальную цену перед входом.');
  const click=chosen.length===1&&s.exchange==='WEEX'?
   (isEarly?'https://weex-radar.vercel.app/tradingview.html?symbol='+encodeURIComponent(s.symbol)+'&interval=1':
    'https://weex-radar.vercel.app/trade.html?symbol='+encodeURIComponent(s.symbol)):
   'https://weex-radar.vercel.app/';
  try{
   await publishNtfy(subscriber.topic,{title,message,priority:isEarly?4:5,click});
   result.delivered++;
   console.info('WEEX_RADAR_NTFY_SENT '+JSON.stringify({kind,count:chosen.length,accepted:true}));
  }catch(e){
   result.failed++;
   for(const p of pending)try{await del(p.mark)}catch{}
   console.warn('WEEX_RADAR_NTFY_FAILED '+String(e.message||e).slice(0,80));
  }
 }
 return result;
}
export const _test={topicOk,subscriberOk,fresh};
