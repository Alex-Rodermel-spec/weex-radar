// Owner opt-in STATUS notices over a SEPARATE ntfy topic derived from existing
// private server secrets. Production-only, no new cron/service, no trading.
// The ordinary ntfy topic remains LONG/SHORT-only after one setup invitation.
import {createHash,createHmac} from 'node:crypto';

const BASE='https://ntfy.sh',HOUR=3600_000;
const HUSH=3*HOUR,STALE_COOLDOWN=90*60_000;
const safeTopic=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{16,64}$/.test(s);
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,32);
const SETUP_ID=hash('weex-radar-status-optin-v1');
const formatTime=stamp=>new Date(stamp).toLocaleTimeString('ru-RU',{
 timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
});
export const STATUS_NOTICE_POLICY=Object.freeze({
 version:'weex-status-optin-1',statusIntervalHours:3,
 requiresOwnerSubscription:true,firstInvitationOnTradeTopic:true,
 notificationTypes:['STARTED','DEPLOYED','DEGRADED','RECOVERED','ALIVE','CRON_STALE'],
 cronHeartbeatMinutes:15,statusIsSeparateFromLongShort:true,
 noExtraCron:true,noOrders:true,noNewSecrets:true
});
export function statusTopic(env=process.env){
 const topic=env.NTFY_TOPIC,key=env.PUSH_CRON_KEY;
 if(!safeTopic(topic)||typeof key!=='string'||key.length<16)return null;
 return 'wr-status-'+createHmac('sha256',key)
  .update('weex-radar-status-channel-v1|'+topic).digest('hex').slice(0,32);
}
export function releaseRevision(env=process.env){
 const raw=env.VERCEL_GIT_COMMIT_SHA;
 return typeof raw==='string'&&/^[a-f0-9]{40}$/i.test(raw)?
  raw.slice(0,8).toLowerCase():null;
}
async function history(topic,fetchImpl=fetch){
 const response=await fetchImpl(BASE+'/'+encodeURIComponent(topic)+
  '/json?poll=1&since=24h',{cache:'no-store',
  signal:AbortSignal.timeout(4500),headers:{Accept:'application/x-ndjson'}});
 if(!response.ok)throw Error('STATUS_HISTORY_UNAVAILABLE');
 const body=await response.text();
 if(body.length>120000)throw Error('STATUS_HISTORY_TOO_LARGE');
 const rows=[];
 for(const line of body.split(/\r?\n/)){
  if(!line.trim())continue;
  try{
   const row=JSON.parse(line);
   if(row.event!=='message'||row.topic!==topic||
     !Number.isSafeInteger(row.time))continue;
   rows.push(row);
  }catch{}
 }
 return rows;
}
async function publish(topic,title,message,priority,sequenceId,fetchImpl=fetch,click='https://weex-radar.vercel.app/health.html'){
 const response=await fetchImpl(BASE,{method:'POST',
  signal:AbortSignal.timeout(5000),
  headers:{'Content-Type':'application/json','User-Agent':'WEEX-RADAR-STATUS/1.0'},
  body:JSON.stringify({topic,title,message,priority,click,sequence_id:sequenceId})});
 if(!response.ok)throw Error('STATUS_SEND_FAILED');
}
export async function statusOnboarding(previousSent,env=process.env,fetchImpl=fetch){
 if(previousSent===true)return true;
 const primary=env.NTFY_TOPIC,topic=statusTopic(env);
 if(!safeTopic(primary)||!topic)return false;
 // If the relay cannot prove this is new, fail closed; never spam the trader.
 const cached=await history(primary,fetchImpl);
 if(cached.some(row=>row.sequence_id===SETUP_ID))return true;
 const deepLink='ntfy://ntfy.sh/'+topic+'?display=WEEX%20STATUS';
 await publish(primary,'🛡️ WEEX RADAR · ПОДКЛЮЧИТЬ СТАТУС',
  'Отдельный канал: 🟢 работает / 🆕 обновлён / 🔴 проблема.\n'+
  'Нажми, чтобы подписаться на WEEX STATUS в ntfy.\n'+
  'Торговые LONG/SHORT останутся отдельно.\n'+
  'Если ссылка не открылась: ntfy → + → вставь адрес канала из ссылки.',
  3,SETUP_ID,fetchImpl,deepLink);
 return true;
}
const stableId=(kind,key)=>hash('weex-status:v1|'+kind+'|'+key);
export function decideStatusNotice(previous,current,recent=[],now=Date.now()){
 if(!current||!Number.isSafeInteger(now)||!Array.isArray(recent)||
   typeof current.healthy!=='boolean')return null;
 let kind=null;
 const version=current.revision||null,prevVersion=previous?.revision||null;
 const latest=recent.at(-1);
 if(version&&prevVersion&&version!==prevVersion)kind='DEPLOYED';
 else if(previous&&previous.healthy===true&&!current.healthy)kind='DEGRADED';
 else if(previous&&previous.healthy===false&&current.healthy)kind='RECOVERED';
 else if(latest?.title?.startsWith('🚨 WEEX RADAR')&&current.healthy)kind='RECOVERED';
 else if(recent.length===0)kind=current.healthy?'STARTED':'DEGRADED';
 else if(current.healthy&&Math.floor(now/(15*60_000))%12===0)kind='ALIVE';
 if(!kind)return null;
 const key=kind==='DEPLOYED'?version:
  kind==='STARTED'?'initial':
  kind==='ALIVE'?String(Math.floor(now/HUSH)):
  kind+'|'+String(Math.floor(now/HOUR));
 const id=stableId(kind,key);
 if(recent.some(r=>r.sequence_id===id))return null;
 const count=current.five?.weex||0,total=current.five?.total||0;
 const market=`Рынки WEEX: ${count}/${total}`;
 const stamp=formatTime(now);
 const versionLine=version?'Версия: '+version:'Версия: не определена';
 const detail=market+' · '+stamp+' (Берлин)\n'+versionLine+
  '\nПроверка сервера ≠ подтверждение доставки на Android.';
 const titles={
  STARTED:'🟢 WEEX RADAR · СТАТУС ПОДКЛЮЧЁН',
  DEPLOYED:'🆕 WEEX RADAR · ВЕРСИЯ ОБНОВЛЕНА',
  DEGRADED:'🟠 WEEX RADAR · ПРОВЕРКА С ОШИБКАМИ',
  RECOVERED:'🟢 WEEX RADAR · РАБОТА ВОССТАНОВЛЕНА',
  ALIVE:'🟢 WEEX RADAR · РАБОТАЕТ'
 };
 return {kind,title:titles[kind],message:detail,
  priority:['DEGRADED'].includes(kind)?4:kind==='ALIVE'?1:3,id};
}
export async function publishCronStatus({previous,current,now=Date.now(),env=process.env,fetchImpl=fetch}){
 const topic=statusTopic(env);
 if(!topic||env.VERCEL_ENV!=='production')return {action:'disabled'};
 // Message cache is our free dedupe. No history => no unsolicited alert.
 const recent=await history(topic,fetchImpl);
 const notice=decideStatusNotice(previous,current,recent,now);
 if(!notice)return {action:'no-change'};
 await publish(topic,notice.title,notice.message,notice.priority,notice.id,fetchImpl);
 return {action:'sent',kind:notice.kind};
}
export async function publishStaleStatus({heartbeat,now=Date.now(),env=process.env,fetchImpl=fetch}){
 const topic=statusTopic(env);
 if(!topic||env.VERCEL_ENV!=='production'||!heartbeat||
  !Number.isSafeInteger(heartbeat.at))return {action:'disabled'};
 const age=now-heartbeat.at;
 if(age<=35*60_000||age>12*HOUR)return {action:'not-stale'};
 const recent=await history(topic,fetchImpl);
 const stale=recent.filter(row=>typeof row.title==='string'&&
  row.title.startsWith('🚨 WEEX RADAR')&&
  now-row.time*1000<STALE_COOLDOWN);
 if(stale.length)return {action:'cooldown'};
 const id=stableId('CRON_STALE',String(Math.floor(now/STALE_COOLDOWN)));
 if(recent.some(row=>row.sequence_id===id))return {action:'duplicate'};
 await publish(topic,'🚨 WEEX RADAR · CRON НЕ ОТВЕЧАЕТ',
  'Основная служебная отметка устарела на '+Math.round(age/60000)+
  ' минут. Резерв GitHub может продолжать сканирование.\n'+
  'Проверь https://weex-radar.vercel.app/health.html',
  4,id,fetchImpl);
 return {action:'sent',kind:'CRON_STALE'};
}
