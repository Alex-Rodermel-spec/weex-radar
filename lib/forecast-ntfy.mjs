// Dedicated Android ntfy channel for READ-ONLY 1m/5m/10m forecasts.
// Trade LONG/SHORT notifications stay exclusively on NTFY_TOPIC.
// Derived topic is a high-entropy secret; never expose it in public APIs/logs.
import {createHmac,createHash} from 'node:crypto';
import {readStandaloneForecast} from './standalone-forecast.mjs';
import {assessForecastStrengthRisk,FORECAST_RISK_LABELS,
 FORECAST_RISK_REASONS} from './forecast-strength-risk.mjs';
import {publishNtfy} from './ntfy-alerts.mjs';
import {_test as marketSafety} from '../api/signals.mjs';

const BASE='https://ntfy.sh/';
const EVERY=10*60_000,HALF_HOUR=30*60_000,MAX_PER_BUCKET=2;
const SETUP_ID=createHash('sha256').update('WEEX_FORECAST_SUBSCRIBE_V1')
 .digest('hex').slice(0,32);
// One optional onboarding message to the existing channel during rollout.
// The original phone topic stays otherwise strictly LONG/SHORT-only.
const SETUP_EXPIRES=Date.UTC(2026,10,10,21,0,0);
const safeTopic=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{16,64}$/.test(x);
const idFor=(symbol,side,bucket)=>createHash('sha256')
 .update('weex:forecast:v1|'+symbol+'|'+side+'|'+bucket)
 .digest('hex').slice(0,32);
export function forecastTopic(env=process.env){
 const original=env.NTFY_TOPIC;
 if(!safeTopic(original))return null;
 return 'wr-'+createHmac('sha256',original)
  .update('weex-radar-forecast-topic-v1').digest('hex').slice(0,32);
}
export function forecastDue(now=Date.now()){
 return Number.isSafeInteger(now)&&now>0&&
  (now%EVERY)<2*60_000; // cron may run late; dedupe the whole 10m bucket
}
export function forecastEligible(d,now=Date.now()){
 if(!d||d.mode!=='STANDALONE_WEEX_FORECAST_1_5_10'||
  d.notTrade!==true||d.ordersSent!==0||d.signalPermission!==false||
  d.exchange!=='WEEX'||!marketSafety.SYMBOLS.includes(d.symbol)||
  d.alignment!=='THREE_TIMEFRAME_ALIGNMENT'||
  !['LONG_BIAS','SHORT_BIAS'].includes(d.combinedDirection)||
  !Array.isArray(d.timeframes)||d.timeframes.length!==3||
  d.timeframes.map(f=>f.intervalMinutes).join(',')!=='1,5,10')
  return false;
 const [one,five,ten]=d.timeframes;
 if([one,five,ten].some(f=>f.direction!==d.combinedDirection||
  !Number.isSafeInteger(f.closedAt)||f.closedAt>now))return false;
 if(now-one.closedAt>95000||now-five.closedAt>11*60_000||
  now-ten.closedAt>11*60_000)return false;
 if(!Number.isFinite(one.rsi14)||!Number.isFinite(one.relativeVolume)||
  one.relativeVolume<0.8||one.relativeVolume>5||
  !Number.isFinite(one.atr14)||one.atr14<=0)return false;
 // Avoid reporting exhausted intraminute momentum as "strong" forecasts.
 if(d.combinedDirection==='LONG_BIAS'&&one.rsi14>=78)return false;
 if(d.combinedDirection==='SHORT_BIAS'&&one.rsi14<=22)return false;
 return true;
}
// Display-only assessment of already computed, closed-bar V2 diagnostics.
// Missing or mismatched evidence is never presented as a positive check.
export function forecastV2Line(d,baselineLevel){
 if(!['STRONG','STANDARD'].includes(baselineLevel))return '';
 const v=d?.strongV2Review;
 if(!v||v.baselineLevel!==baselineLevel||v.sampleReady!==true)
  return '🧪 V2: недостаточно данных для оценки опоздания\n';
 if(v.status==='REVIEW_DOWNGRADE'&&
   v.proposedLevel===(baselineLevel==='STRONG'?'STANDARD':'CAUTION'))
  return '🧪 V2: возможное опоздание — не догоняй цену\n';
 if(v.status===(baselineLevel==='STRONG'?'REVIEW_KEEP_STRONG':'REVIEW_KEEP_STANDARD')&&
   v.proposedLevel===baselineLevel)
  return '🧪 V2: явных признаков опоздания не найдено (не гарантия)\n';
 return '🧪 V2: недостаточно данных для оценки опоздания\n';
}

// Compact dedicated ntfy forecast. Preserve exact title, "Цена 1М",
// and unchanged V2 evidence line: historical archive/health depend on them.
export function forecastMessage(d){
 const side=d.combinedDirection==='LONG_BIAS'?'LONG':'SHORT';
 const quality=assessForecastStrengthRisk(d);
 const label=FORECAST_RISK_LABELS[quality.level];
 // Prefer important RSI 10m exhaustion over a less material first warning.
 // One plain-language warning, no huge stack of indicators.
 const multiRSI=quality.reasons.filter(r=>
  /^(?:OVERSOLD|OVERBOUGHT)_(?:5M|10M)$/.test(r));
 // Both 5m and 10m extremes matter for a squeeze; keep both on ONE line.
 const codes=multiRSI.length>=2?multiRSI.slice(0,2):
  [multiRSI[0]||quality.reasons[0]].filter(Boolean);
 const reason=codes.map(c=>FORECAST_RISK_REASONS[c]||c).join('; ');
 const [one]=d.timeframes;
 const format=n=>Number.isFinite(n)?Number(n).toPrecision(6):'—';
 const at=new Date(one.closedAt).toLocaleTimeString('ru-RU',{
  timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const lines=[
  '👀 НАБЛЮДАЙ. НЕ ВХОДИ.',
  (side==='SHORT'?'📉 Возможное ПАДЕНИЕ':'📈 Возможный РОСТ')+' · WEEX',
  'Цена 1М: '+format(one.price)+' USDT · свеча '+at,
  '📊 Направление 1М / 5М / 10М совпало.'
 ];
 if(reason)lines.push('⚠️ '+reason);
 const v2=forecastV2Line(d,quality.level).trim();
 if(v2)lines.push(v2);
 lines.push('⏳ Жди подтверждения. НЕ сигнал входа, не гарантия.');
 return {
  title:'🔮 '+label+' · '+d.symbol+' '+side,
  message:lines.join('\n'),
  priority:3,click:'https://weex-radar.vercel.app/forecast.html'
 };
}
async function history(topic,since,fetchImpl){
 const response=await fetchImpl(BASE+encodeURIComponent(topic)+
  '/json?poll=1&since='+encodeURIComponent(since),{
  cache:'no-store',signal:AbortSignal.timeout(3500),
  headers:{Accept:'application/x-ndjson'}
 });
 if(!response.ok)throw Error('FORECAST_NTFY_HISTORY_'+response.status);
 const body=await response.text();
 if(body.length>250000)throw Error('FORECAST_HISTORY_TOO_LARGE');
 const records=[];
 for(const line of body.split(/\r?\n/)){
  if(!line.trim())continue;
  try{
   const row=JSON.parse(line);
   if(row.event==='message'&&row.topic===topic&&
    /^[a-f0-9]{32}$/.test(row.sequence_id||'')&&
    Number.isFinite(row.time))records.push({id:row.sequence_id,time:row.time*1000});
  }catch{}
 }
 return records;
}
export async function runForecastNotifications({
 env=process.env,now=Date.now(),clock=Date.now,fetchImpl=fetch,
 publish=publishNtfy,reader=readStandaloneForecast,
 symbols=marketSafety.SYMBOLS
}={}){
 const topic=forecastTopic(env),primary=env.NTFY_TOPIC;
 const result={mode:'SEPARATE_NTFY_FORECAST_1_5_10',configured:Boolean(topic),
  due:forecastDue(now),scanned:0,available:0,aligned:0,eligible:0,
  delivered:0,duplicates:0,failed:0,setupSent:0,
  ordersSent:0,notATrade:true};
 if(!topic||!Array.isArray(symbols)||symbols.some(s=>!marketSafety.SYMBOLS.includes(s)))
  return result;
 if(!result.due)return result;

 // One-time onboarding directly to existing subscribed device. This is the
 // single non-directional setup notice, sent only during initial rollout.
 // If history is unreachable, fail closed instead of spamming setup.
 if(now<SETUP_EXPIRES&&primary){
  try{
   const previous=await history(primary,'12h',fetchImpl);
   if(!previous.some(row=>row.id===SETUP_ID)){
    const deepLink='ntfy://ntfy.sh/'+topic+'?display=WEEX+Forecast';
    await publish(primary,{
     title:'🔮 WEEX RADAR · ПОДКЛЮЧИТЬ ПРОГНОЗЫ',
     message:'Ты включил отдельные прогнозы. Нажми на это сообщение, '+ 
      'чтобы подписаться в приложении ntfy на канал ПРОГНОЗЫ.\n'+
      'Если кнопка не откроется, добавь канал вручную: '+topic+'\n'+
      'Торговые LONG/SHORT продолжат приходить отдельно.',
     priority:3,click:deepLink,sequenceId:SETUP_ID
    });
    result.setupSent=1;
   }
  }catch(e){
   console.warn('FORECAST_NTFY_SETUP_UNAVAILABLE '+
    String(e.message||e).slice(0,70));
  }
 }

 let previous;
 try{previous=await history(topic,'65m',fetchImpl)}
 catch(e){
  // Do not flood a second channel when we cannot check recent messages.
  console.warn('FORECAST_NTFY_DEDUP_UNAVAILABLE '+String(e.message||e).slice(0,70));
  result.failed++;
  return result;
 }
 const nowBucket=Math.floor(now/EVERY),earliest=nowBucket*EVERY;
 const inBucket=previous.filter(row=>row.time>=earliest&&row.time<=now+5000).length;
 if(inBucket>=MAX_PER_BUCKET)return result;
 const seen=new Set(previous.map(row=>row.id));
 const snapshots=[];let next=0;
 async function worker(){
  while(next<symbols.length){
   const symbol=symbols[next++];
   result.scanned++;
   try{
    const d=await reader(symbol,{fetchImpl,now});
    if(d?.available)result.available++;
    if(d?.alignment==='THREE_TIMEFRAME_ALIGNMENT')result.aligned++;
    if(forecastEligible(d,now)){result.eligible++;snapshots.push(d)}
   }catch{/* A failed market is not a LONG/SHORT or fictitious forecast. */}
  }
 }
 await Promise.all(Array.from({length:Math.min(8,symbols.length)},()=>worker()));
 snapshots.sort((a,b)=>{
  // Prioritize scenarios without observed exhaustion/chase warnings;
  // this is NOT a calibrated probability of success.
  const score=d=>{
   const q=assessForecastStrengthRisk(d);
   const rank=q.level==='STRONG'?3:q.level==='STANDARD'?2:
    q.level==='CAUTION'?1:0;
   return rank*10+d.timeframes[0].relativeVolume+
    d.timeframes.reduce((s,f)=>s+f.voteAgreement,0)*.15;
  };
  return score(b)-score(a)||a.symbol.localeCompare(b.symbol);
 });
 for(const d of snapshots){
  if(result.delivered>=MAX_PER_BUCKET-inBucket)break;
  // Re-check arrival time, not merely the timestamp captured before
  // 16 WEEX reads. Observations sent late are not an early forecast.
  if(clock()-d.timeframes[0].closedAt>120000)continue;
  const id=idFor(d.symbol,d.combinedDirection,Math.floor(now/HALF_HOUR));
  if(seen.has(id)){result.duplicates++;continue}
  try{
   await publish(topic,{...forecastMessage(d),sequenceId:id});
   result.delivered++;seen.add(id);
   console.info('WEEX_RADAR_FORECAST_SENT '+JSON.stringify({
    symbol:d.symbol,direction:d.combinedDirection,
    strength:assessForecastStrengthRisk(d).level,notATrade:true
   }));
  }catch(e){
   result.failed++;
   console.warn('WEEX_RADAR_FORECAST_SEND_FAILED '+
    String(e.message||e).slice(0,70));
  }
 }
 return result;
}
