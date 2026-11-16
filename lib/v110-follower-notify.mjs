// №110 observer-only candidate alerts in a SEPARATE owner opt-in ntfy topic.
// Not a predictive edge or a manual-trade entry. Uses the EXISTING 10m forecast
// scan's frozen 16-crypto 5m cohort; no additional WEEX requests or schedulers.
// Missing ntfy history means NO delivery, never unbounded duplicate spam.
import {createHash,createHmac} from 'node:crypto';
import {profileSymbols,marketForecastProfile} from './market-forecast-profiles.mjs';

const BASE='https://ntfy.sh/';
const MIN=60_000,FIVE=5*MIN,HALF_HOUR=30*MIN;
const CRYPTO=new Set(profileSymbols().filter(s=>
 marketForecastProfile(s)?.group.endsWith('CRYPTO')));
const safeTopic=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{16,64}$/.test(s);
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validClock=n=>Number.isSafeInteger(n)&&n>0;
if(CRYPTO.size!==16)throw Error('V110_FOLLOWER_NOTICE_CRYPTO16');
export const V110_FOLLOWER_NOTICE_POLICY=Object.freeze({
 version:'v110-possible-follower-ntfy-optin-v1',
 candidatesFrom:'EXISTING_FROZEN_16_CRYPTO_5M_COHORT',
 requiresAll16Markets:true,
 minLeaders:6,leaderBody5mBps:10,maxFollowerAbs5mBps:4,
 maxMessagesPer30Minutes:1,requiresOwnerSubscription:true,
 channel:'SEPARATE_HMAC_DERIVED_OWNER_TOPIC',
 status:'UNPROVEN_RESEARCH_WATCH',notTrade:true,
 newCron:false,newPaidApi:false,extraWeexRequests:0,
 tradingRulesChanged:false,originalNtFyChanged:false,
 noOrders:true,holdoutEdgeProven:false
});
export function followerTopic(env=process.env){
 const original=env.NTFY_TOPIC;
 if(!safeTopic(original))return null;
 return 'wr-'+createHmac('sha256',original)
  .update('weex-radar-follower-topic-v1').digest('hex').slice(0,32);
}
function eligible(c,now){
 return c&&c.kind==='POSSIBLE_LAGGING_CRYPTO_NOT_VERIFIED'&&
  c.publicationStatus==='RESEARCH_NOT_SENT'&&
  /^[a-f0-9]{24}$/.test(c.id||'')&&CRYPTO.has(c.symbol)&&
  ['LONG','SHORT'].includes(c.direction)&&
  validClock(c.frozenAt)&&c.frozenAt<=now&&
  now-c.frozenAt<=120_000&&
  validClock(c.oneClosedAt)&&c.oneClosedAt<=now&&
  now-c.oneClosedAt<=120_000&&
  validClock(c.fiveClosedAt)&&
  c.fiveClosedAt===Math.floor((now-1000)/FIVE)*FIVE&&
  validClock(c.leaderCount)&&c.leaderCount>=6&&c.leaderCount<=15&&
  Array.isArray(c.leaderSymbols)&&c.leaderSymbols.length===c.leaderCount&&
  new Set(c.leaderSymbols).size===c.leaderCount&&
  c.leaderSymbols.every(s=>CRYPTO.has(s)&&s!==c.symbol)&&
  finite(c.local5mBodyBps)&&Math.abs(c.local5mBodyBps)<=4&&
  finite(c.referencePrice)&&c.referencePrice>0;
}
const idFor=c=>createHash('sha256').update(
 'weex-v110-follower-notice-v1|'+c.id).digest('hex').slice(0,32);
const berlin=t=>new Date(t).toLocaleTimeString('ru-RU',{
 timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
});
export function followerNotice(c){
 const up=c.direction==='LONG',direction=up?'вверх':'вниз';
 const body=Math.abs(c.local5mBodyBps/100).toFixed(2);
 return {
  title:'👣 №110 · ВОЗМОЖНАЯ ДОГОНЯЮЩАЯ · '+c.symbol+
   (up?' 🟩 LONG?':' 🟥 SHORT?'),
  message:[
   '🧪 ГИПОТЕЗА · НЕ СИГНАЛ ВХОДА.',
   '👥 '+c.leaderCount+' криптовалют уже двигались '+direction+
    ' на одной закрытой свече 5М.',
   '🐢 '+c.symbol+' почти стояла на месте (тело 5М: '+body+'%).',
   '🔎 Проверяем, последует ли она '+direction+' через 5 / 10 / 15 минут.',
   '⏰ Свеча 5М закрылась в '+berlin(c.fiveClosedAt)+' (Берлин).',
   '⚠️ Это непроверенная закономерность, не совет открывать сделку.'
  ].join('\n'),
  priority:3,click:'https://weex-radar.vercel.app/forecast.html#follower-watch',
  sequenceId:idFor(c)
 };
}
async function previousNotices(topic,fetchImpl){
 const r=await fetchImpl(BASE+encodeURIComponent(topic)+
  '/json?poll=1&since=80m',{
   cache:'no-store',signal:AbortSignal.timeout(3500),
   headers:{Accept:'application/x-ndjson'}
  });
 if(!r.ok)throw Error('FOLLOWER_NTFY_HISTORY_'+r.status);
 const raw=await r.text();
 if(raw.length>120000)throw Error('FOLLOWER_NTFY_HISTORY_TOO_LARGE');
 const items=[];
 for(const line of raw.split(/\r?\n/)){
  if(!line.trim())continue;
  try{
   const x=JSON.parse(line);
   if(x.event==='message'&&x.topic===topic&&validClock(x.time)&&
    /^[a-f0-9]{32}$/.test(x.sequence_id||''))
    items.push({id:x.sequence_id,sentAt:x.time*1000});
  }catch{/* unknown/unrelated ntfy messages are not evidence of success */}
 }
 return items;
}
export async function sendV110FollowerNotices(candidates,{
 env=process.env,now=Date.now(),clock=Date.now,
 fetchImpl=fetch,publish
}={}){
 const topic=followerTopic(env);
 const base={mode:'V110_POSSIBLE_FOLLOWER_SEPARATE_NTFY',
  enabled:env.VERCEL_ENV==='production'&&Boolean(topic),
  scannedCandidates:Array.isArray(candidates)?candidates.length:0,
  eligible:0,delivered:0,duplicates:0,cooldown:0,failed:0,
  noTrade:true,ordersSent:0,
  note:'Unproven leader/follower hypothesis; does not change 108.'};
 if(!base.enabled||!Array.isArray(candidates)||candidates.length>16||
  !validClock(now)||typeof publish!=='function')return base;
 const eligibleCandidates=candidates.filter(c=>eligible(c,now)).sort((a,b)=>
  b.leaderCount-a.leaderCount||
  Math.abs(a.local5mBodyBps)-Math.abs(b.local5mBodyBps)||
  a.symbol.localeCompare(b.symbol));
 base.eligible=eligibleCandidates.length;
 if(!eligibleCandidates.length)return base;
 let past;
 try{past=await previousNotices(topic,fetchImpl);}
 catch(e){
  console.warn('V110_FOLLOWER_HISTORY_UNAVAILABLE '+String(e.message||e).slice(0,75));
  base.failed++;return base;
 }
 const freshNow=clock();
 if(!validClock(freshNow)||freshNow<now||
  freshNow-now>120_000)return base;
 if(past.some(x=>x.sentAt>=freshNow-HALF_HOUR&&
  x.sentAt<=freshNow+5000)){
  base.cooldown=1;return base;
 }
 // Max ONE neutral-priority research alert per 30m, separate from the
 // capped FORECAST channel and high-priority confirmed LONG/SHORT.
 const chosen=eligibleCandidates[0],notice=followerNotice(chosen);
 if(past.some(x=>x.id===notice.sequenceId)){base.duplicates=1;return base}
 if(!eligible(chosen,freshNow))return base;
 try{
  await publish(topic,notice);
  base.delivered=1;
  console.info('WEEX_RADAR_V110_FOLLOWER_NTFY_SENT '+
   JSON.stringify({symbol:chosen.symbol,direction:chosen.direction,
    leaderCount:chosen.leaderCount,closed5mAt:chosen.fiveClosedAt,
    researchOnly:true,notTrade:true}));
 }catch(e){
  base.failed++;
  console.warn('WEEX_RADAR_V110_FOLLOWER_NTFY_FAILED '+
   String(e.message||e).slice(0,75));
 }
 return base;
}
