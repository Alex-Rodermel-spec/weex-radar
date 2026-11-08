// WEEX RADAR read-only health monitor: no Blob, paid storage, trading keys or orders.
// Heartbeats use a SERVER-ONLY ntfy topic derived from two existing server secrets.
// Sends at most one quiet marker per 15-minute bucket on cron ticks.
// The independent GitHub backup checks for a stale cron heartbeat and warns via
// the already configured user ntfy topic, rate-limited to once per 90 minutes.
import {createHmac} from 'node:crypto';
import {publishNtfy} from './ntfy-alerts.mjs';

export const HEARTBEAT_MS=15*60_000;
export const STALE_MS=35*60_000;
export const ALERT_COOLDOWN_MS=90*60_000;
const MAX_HISTORY=120_000;
const BASE='https://ntfy.sh';
const ALERT_TITLE='🚨 WEEX RADAR · CRON НЕ ОТВЕЧАЕТ';
const safeTopic=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{16,64}$/.test(x);

export function monitorTopic(env=process.env){
 const main=env.NTFY_TOPIC,key=env.PUSH_CRON_KEY;
 if(!safeTopic(main)||typeof key!=='string'||key.length<16)return null;
 return 'wr-health-'+createHmac('sha256',key)
  .update('weex-radar-health-monitor-v1|'+main).digest('hex').slice(0,32);
}
export function snapshotMarkets(symbols){
 if(!Array.isArray(symbols))return {total:0,weex:0,bybit:0,unavailable:0};
 return {total:symbols.length,
  weex:symbols.filter(s=>s.status==='ok'&&s.exchange==='WEEX').length,
  bybit:symbols.filter(s=>s.status==='ok'&&s.exchange==='Bybit').length,
  unavailable:symbols.filter(s=>s.status!=='ok').length};
}
export function assessHeartbeat(row,now=Date.now()){
 if(!row||!Number.isFinite(row.at)||row.at>now+5000||row.at<=now-12*3600_000)
  return {state:'UNKNOWN',lastSeenAt:null,details:null};
 const state=now-row.at>STALE_MS?'STALE':row.healthy===true?'OK':'DEGRADED';
 return {state,lastSeenAt:row.at,details:{
  five:row.five,early:row.early,
  ntfyFailed:row.ntfyFailed===true,
  http:row.http
 }};
}
// A healthy *or degraded* recent cron heartbeat proves the primary scheduler
// is already running. GitHub is a BACKUP, not another primary worker.
// Unknown/unreachable monitoring fails open for resilience; a stale heartbeat
// permits GitHub takeover after the configured timeout.
export function githubBackupStandby(heartbeat,now=Date.now()){
 if(heartbeat?.configured!==true||heartbeat?.reachable!==true)return false;
 const state=assessHeartbeat(heartbeat.last,now).state;
 return state==='OK'||state==='DEGRADED';
}

export function shouldHeartbeat(now=Date.now()){
 return now%HEARTBEAT_MS<150_000;
}

async function pullTopic(topic,since='latest',fetchImpl=fetch){
 const url=BASE+'/'+encodeURIComponent(topic)+'/json?poll=1&since='+encodeURIComponent(since);
 const response=await fetchImpl(url,{cache:'no-store',signal:AbortSignal.timeout(4500),
  headers:{Accept:'application/x-ndjson','User-Agent':'WEEX-RADAR/1.0'}});
 if(!response.ok)throw Error('ntfy poll HTTP '+response.status);
 const body=await response.text();
 if(body.length>MAX_HISTORY)throw Error('ntfy monitor history too large');
 const messages=[];
 for(const line of body.split(/\r?\n/)){
  if(!line.trim())continue;
  try{
   const m=JSON.parse(line);
   if(m.event==='message'&&m.topic===topic)messages.push(m);
  }catch{}
 }
 return messages;
}

function readHeartbeatMessage(m){
 if(typeof m?.message!=='string'||m.message.length>2000)return null;
 try{
  const data=JSON.parse(m.message);
  if(data.v!==1||data.source!=='cron'||!Number.isFinite(data.at)||
   !Number.isSafeInteger(data.bucket)||!data.five||
   !Number.isFinite(data.five.total))return null;
  return data;
 }catch{return null}
}

export async function latestHeartbeat(fetchImpl=fetch,env=process.env){
 const topic=monitorTopic(env);
 if(!topic)return {configured:false,reachable:null,last:null};
 try{
  const messages=await pullTopic(topic,'latest',fetchImpl);
  const last=messages.map(readHeartbeatMessage).filter(Boolean).at(-1)||null;
  return {configured:true,reachable:true,last};
 }catch{return {configured:true,reachable:false,last:null}}
}

export async function ntfyGatewayHealth(fetchImpl=fetch,env=process.env){
 const topic=env.NTFY_TOPIC;
 if(!safeTopic(topic))return {configured:false,reachable:null,lastSignalAt:null};
 try{
  const rows=await pullTopic(topic,'2h',fetchImpl);
  const matches=rows.filter(row=>/^(?:🔔 ОБЫЧНЫЙ|🟣 СИЛЬНЫЙ|⚡ EARLY WATCH) [A-Z0-9]+ (LONG|SHORT)$/.test(row.title||''));
  const newest=matches.at(-1);
  return {configured:true,reachable:true,
   lastSignalAt:Number.isFinite(Number(newest?.time))?Number(newest.time)*1000:null};
 }catch{
  return {configured:true,reachable:false,lastSignalAt:null};
 }
}

async function publishHeartbeat(topic,body,fetchImpl=fetch){
 const response=await fetchImpl(BASE,{method:'POST',signal:AbortSignal.timeout(4500),
  headers:{'Content-Type':'application/json','X-Firebase':'no','User-Agent':'WEEX-RADAR/1.0'},
  body:JSON.stringify({topic,priority:1,title:'WEEX RADAR · служебная отметка',
   message:JSON.stringify(body)})});
 if(!response.ok)throw Error('health heartbeat HTTP '+response.status);
}

export async function monitorDispatch({source,http,markets,early,ntfy,now=Date.now(),
 fetchImpl=fetch,env=process.env}){
 if(!['cron','github'].includes(source))return {action:'ignored'};
 const topic=monitorTopic(env);
 const main=env.NTFY_TOPIC;
 if(!topic||!safeTopic(main))return {action:'unconfigured'};
 if(source==='cron'){
  if(!shouldHeartbeat(now))return {action:'not-due'};
  const recent=await latestHeartbeat(fetchImpl,env);
  // If the provider cannot be checked, avoid doubling its request load.
  if(!recent.reachable)return {action:'ntfy-unreachable'};
  const bucket=Math.floor(now/HEARTBEAT_MS);
  if(recent.last&&recent.last.bucket===bucket)return {action:'already-sent'};
  const snapshot=markets||{total:0,weex:0,bybit:0,unavailable:0};
  const earlySnapshot={checked:Number(early?.checked)||0,failedMarkets:Number(early?.failedMarkets)||0};
  const ntfyFailed=Number(ntfy?.failed)>0||Number(early?.ntfy?.failed)>0;
  const data={v:1,source:'cron',at:now,bucket,http,
   five:snapshot,early:earlySnapshot,ntfyFailed,
   healthy:http===200&&snapshot.total===16&&snapshot.unavailable===0&&
    snapshot.bybit===0&&earlySnapshot.checked===16&&earlySnapshot.failedMarkets===0&&!ntfyFailed};
  await publishHeartbeat(topic,data,fetchImpl);
  console.info('WEEX_RADAR_HEALTH_HEARTBEAT '+JSON.stringify({
   healthy:data.healthy,five:data.five,early:data.early,ntfyFailed:data.ntfyFailed
  }));
  return {action:'recorded',healthy:data.healthy};
 }
 // Independent GitHub schedule is an imperfect backup; it can run late/stop.
 const recent=await latestHeartbeat(fetchImpl,env);
 if(!recent.reachable||!recent.last)return {action:'not-enough-evidence'};
 const age=now-recent.last.at;
 if(age<=STALE_MS||age>12*3600_000)return {action:'cron-recent'};
 // Only notify about absent CRON invocations, not about zero trade signals.
 const previous=await pullTopic(main,'100m',fetchImpl);
 if(previous.some(m=>m.title===ALERT_TITLE&&Number.isFinite(Number(m.time))&&
   now-Number(m.time)*1000<ALERT_COOLDOWN_MS))return {action:'alert-cooldown'};
 await publishNtfy(main,{title:ALERT_TITLE,priority:4,
  message:'Нет контрольной отметки основного cron больше 35 минут. '+ 
   'Резерв GitHub может продолжать сканирование. Проверь cron-job.org. Это не торговый сигнал.',
  click:'https://weex-radar.vercel.app/health.html'});
 console.warn('WEEX_RADAR_HEALTH_CRON_STALE '+JSON.stringify({ageMinutes:Math.round(age/60000)}));
 return {action:'alert-sent'};
}
