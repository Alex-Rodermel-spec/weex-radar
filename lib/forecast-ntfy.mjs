// Dedicated Android ntfy channel for READ-ONLY 1m/5m/10m forecasts.
// Trade LONG/SHORT notifications stay exclusively on NTFY_TOPIC.
// Derived topic is a high-entropy secret; never expose it in public APIs/logs.
import {createHash} from 'node:crypto';
import {forecastTopic} from './ntfy-forecast-topic.mjs';
export {forecastTopic} from './ntfy-forecast-topic.mjs';
import {readStandaloneForecast} from './standalone-forecast.mjs';
import {assessForecastStrengthRisk,FORECAST_RISK_LABELS,
 FORECAST_RISK_REASONS} from './forecast-strength-risk.mjs';
import {publishNtfy} from './ntfy-alerts.mjs';
import {forecastDeliveryDecision} from './forecast-arrival-safeguard.mjs';
import {rankForecastV4} from './forecast-v4-ranking.mjs';
import {captureV110Depth,attachV110DepthClick} from './v110-depth-capture.mjs';
import {summarizeOneToFiveConflicts} from './v110-one-to-five-shadow.mjs';
import {summarizeV110CryptoBreadth} from './v110-crypto-breadth-shadow.mjs';
import {summarizeV110CryptoFollowers} from './v110-crypto-followers-shadow.mjs';
import {sendV110FollowerNotices,followerTopic} from './v110-follower-notify.mjs';
import {summarizeV110All32EarlyCohorts} from './v110-all32-early-cohorts.mjs';
import {forecastNotificationAllowed,FORECAST_NOTIFICATION_UNIVERSE} from './forecast-notification-universe.mjs';
import {_test as marketSafety} from '../api/signals.mjs';

const BASE='https://ntfy.sh/';
const EVERY=10*60_000,HALF_HOUR=30*60_000,MAX_PER_BUCKET=2;
const SETUP_ID=createHash('sha256').update('WEEX_FORECAST_SUBSCRIBE_V1')
 .digest('hex').slice(0,32);
// One optional onboarding message to the existing channel during rollout.
// The original phone topic stays otherwise strictly LONG/SHORT-only.
const SETUP_EXPIRES=Date.UTC(2026,10,10,21,0,0);
// Short, one-time owner invitation window. The owner must still accept
// the Android subscription; server-side code cannot modify their app.
const FOLLOWER_SETUP_ID=createHash('sha256')
 .update('WEEX_FOLLOW_ONE_TAP_OPT_IN_V1').digest('hex').slice(0,32);
const FOLLOWER_SETUP_START=Date.UTC(2026,10,16,16,0,0);
const FOLLOWER_SETUP_EXPIRES=Date.UTC(2026,10,17,9,0,0);
const safeTopic=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{16,64}$/.test(x);
const idFor=(symbol,side,bucket)=>createHash('sha256')
 .update('weex:forecast:v1|'+symbol+'|'+side+'|'+bucket)
 .digest('hex').slice(0,32);
export function forecastDue(now=Date.now()){
 return Number.isSafeInteger(now)&&now>0&&
  (now%EVERY)<2*60_000; // cron may run late; dedupe the whole 10m bucket
}
export function forecastEligible(d,now=Date.now()){
 if(!d||d.mode!=='STANDALONE_WEEX_FORECAST_1_5_10'||
  d.notTrade!==true||d.ordersSent!==0||d.signalPermission!==false||
  d.exchange!=='WEEX'||!marketSafety.FORECAST_SYMBOLS.includes(d.symbol)||
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

// Compact ntfy forecasts use color-square arrows (ntfy cannot color letters).
// The encrypted journal still accepts old notification titles.
// Preserve "Цена 1М" and the unchanged V2 evidence line.
export function forecastMessage(d){
 const side=d.combinedDirection==='LONG_BIAS'?'LONG':'SHORT';
 const quality=assessForecastStrengthRisk(d);
 // This independent 1m/5m/10m observation is NOT a paired 5m entry.
 // Only the separate 5m alert with a real earlier ordinary PRE_BREAK
 // notification may be shown as STRONG to the manual trader.
 const label=FORECAST_RISK_LABELS[quality.level==='STRONG'?'STANDARD':quality.level];
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
  '👀 НАБЛЮДАЙ · НЕ ВХОДИ.',
  (side==='SHORT'?'📉 Возможное ПАДЕНИЕ':'📈 Возможный РОСТ')+' · WEEX',
  'Цена 1М: '+format(one.price)+' USDT · свеча '+at,
  '📊 1М / 5М / 10М — направление совпало (10М построен из 5М).'
 ];
 if(reason)lines.push('⚠️ '+reason);
 const v2=forecastV2Line(d,quality.level).trim();
 if(v2)lines.push(v2);
 if(quality.level==='STRONG')lines.push('ℹ️ Индикаторы совпали, но вход на 5М ещё НЕ подтверждён.');
 lines.push('⏳ Жди подтверждения 5М. Горизонт 5 минут, без обещаний 15М. НЕ сигнал входа, не гарантия.');
 return {
  title:'🔮 '+label+' · '+d.symbol+' '+(side==='LONG'?'🟩 ⬆️ LONG':'🟥 ⬇️ SHORT'),
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
 depthCapture=captureV110Depth,
 symbols=marketSafety.FORECAST_SYMBOLS
}={}){
 const topic=forecastTopic(env),primary=env.NTFY_TOPIC;
 const result={mode:'SEPARATE_NTFY_FORECAST_1_5_10',configured:Boolean(topic),
  due:forecastDue(now),scanned:0,available:0,aligned:0,eligible:0,
  lateSuppressed:0,reversalSuppressed:0,adaptiveEvaluated:0,adaptiveVsLegacyChanged:0,
  legacyWouldSuppress:0,adaptiveWouldSuppress:0,
  delivered:0,duplicates:0,failed:0,setupSent:0,
  followerSetupSent:0,
  notificationUniverse:FORECAST_NOTIFICATION_UNIVERSE.notificationMarkets,
  researchUniverse:FORECAST_NOTIFICATION_UNIVERSE.scanMarkets,
  excludedFromForecastNtfy:0,
   depthCaptured:0,depthUnavailable:0,
  oneToFiveResearch:null,cryptoBreadthResearch:null,all32EarlyCohortResearch:null,
  followerNotices:null,
  ordersSent:0,notATrade:true};
 if(!topic||!Array.isArray(symbols)||symbols.some(s=>!marketSafety.FORECAST_SYMBOLS.includes(s)))
  return result;
 if(!result.due)return result;

 // A one-time FOLLOW invitation to the existing primary WEEX RADAR topic.
 // The recipient taps the deep link ONCE; no secret is logged in plaintext.
 if(env.VERCEL_ENV==='production'&&primary&&
    now>=FOLLOWER_SETUP_START&&now<FOLLOWER_SETUP_EXPIRES){
  try{
   const follower=followerTopic(env);
   if(follower){
    const sent=await history(primary,'24h',fetchImpl);
    if(!sent.some(row=>row.id===FOLLOWER_SETUP_ID)){
     await publish(primary,{
      title:'👣 WEEX FOLLOW · ПОДКЛЮЧИТЬ ОДНИМ НАЖАТИЕМ',
      message:'Я подготовил отдельный канал возможных догоняющих монет №110. '+
       'Нажми на это сообщение и подтверди подписку WEEX FOLLOW в ntfy. '+
       'Торговые LONG/SHORT и WEEX Forecast не изменятся. '+
       'Это исследовательские наблюдения, НЕ сигнал входа.',
      priority:3,click:'ntfy://ntfy.sh/'+follower+'?display=WEEX+FOLLOW',
      sequenceId:FOLLOWER_SETUP_ID
     });
     result.followerSetupSent=1;
    }
   }
  }catch(e){
   // Never block market scanning if the onboarding relay is unavailable.
   console.warn('V110_FOLLOWER_INVITE_UNAVAILABLE '+
    String(e?.message||e).slice(0,65));
  }
 }
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
 const snapshots=[],researchObservations=[];let next=0;
 async function worker(){
  while(next<symbols.length){
   const symbol=symbols[next++];
   result.scanned++;
   try{
    const d=await reader(symbol,{fetchImpl,now});
    if(d?.available){result.available++;researchObservations.push(d)}
    if(d?.alignment==='THREE_TIMEFRAME_ALIGNMENT')result.aligned++;
    if(forecastEligible(d,now)){
     result.eligible++;
     const fast=d.arrivalTiming;
     if(fast?.sampleReady===true){
      if(fast.legacyLateRisk===true)result.legacyWouldSuppress++;
      if(fast.lateRisk===true)result.adaptiveWouldSuppress++;
      if(fast.adaptiveReady===true){
       result.adaptiveEvaluated++;
       if(fast.lateRisk!==fast.legacyLateRisk)
        result.adaptiveVsLegacyChanged++;
      }
     }
     // Live effect: late/chasing forecasts no longer occupy scarce ntfy slots.
     // Unknown historical evidence stays unknown and is NOT mislabeled early.
     const decision=forecastDeliveryDecision(d);
     if(decision.status==='SUPPRESS_LATE')result.lateSuppressed++;
     else if(decision.status==='SUPPRESS_REVERSAL')result.reversalSuppressed++;
     else snapshots.push(d);
    }
   }catch{/* A failed market is not a LONG/SHORT or fictitious forecast. */}
  }
 }
 await Promise.all(Array.from({length:Math.min(8,symbols.length)},()=>worker()));
 // Research includes *all* readable markets, including 1m/5m disagreements
 // suppressed before ntfy eligibility. Zero extra WEEX requests or alerts.
 result.oneToFiveResearch=summarizeOneToFiveConflicts(researchObservations);
 // Same already-fetched forecast observations, including unsent/WAIT markets.
 // Count only the actual 16 crypto symbols, not the 16 WEEX FX/metals/stocks.
 // No new polling, paid model, alert, or change to forecast eligibility.
 result.cryptoBreadthResearch=summarizeV110CryptoBreadth(researchObservations,now);
 // №110 SHADOW ONLY: freeze '6 movers vs quiet target' pre-event hypotheses
 // from the EXISTING 16-crypto cohort on the same completed 5m boundary.
 // Zero exchange requests, new alerts, altered #108 decision or new cron.
 const leadLag=summarizeV110CryptoFollowers(researchObservations,now);
 const {candidates:leadLagCandidates,...leadLagSummary}=leadLag;
 // Separate, opt-in, read-only observer alerts. Run concurrently with the
 // usual forecast delivery; await before leaving this serverless request.
 const followerPromise=sendV110FollowerNotices(leadLagCandidates,{
  env,now,clock,fetchImpl,publish
 }).catch(()=>({mode:'V110_POSSIBLE_FOLLOWER_SEPARATE_NTFY',
  enabled:false,delivered:0,failed:1,noTrade:true}));
 result.leaderFollowerResearch={...leadLagSummary,
  receiptsLogged:leadLagCandidates.length,futureOutcomesMeasured:false};
 // Ephemeral, capped research records for later manual prospective checking.
 // These are not a durable journal or proven predictive relationships.
 for(let i=0;i<leadLagCandidates.length;i+=4){
  console.info('WEEX_RADAR_V110_LEAD_LAG_FROZEN '+JSON.stringify({
   version:'v110-crypto16-leader-follower-v1',sampledAt:now,
   part:i/4+1,parts:Math.ceil(leadLagCandidates.length/4),
   receipts:leadLagCandidates.slice(i,i+4)
  }));
 }
 // Entire eligible 32-market universe, including unsent 1m LONG/SHORT while
 // 5m is NEUTRAL. Exclude stale 5m closes and report UNKNOWN coverage.
 // Research-only: existing snapshots, no extra requests, storage or alerts.
 // Freeze observational reference facts BEFORE future candles can appear.
 // Use ONLY already-scanned public 1m/5m/10m forecasts. Existing Vercel
 // runtime logs are not a durable research journal; no new storage, AI
 // calls, polling, ntfy notifications or trade permissions.
 const earlyCensus=summarizeV110All32EarlyCohorts(researchObservations,now);
 const frozen=earlyCensus.frozenForwardReceipts;
 if(frozen.length<=32){
  for(let i=0;i<frozen.length;i+=8){
   // Bound log entry size so no whole array is silently truncated.
   // A repeated 10m scan may log duplicates; freeze IDs enable dedup.
   console.info('WEEX_RADAR_V110_EARLY_FROZEN '+JSON.stringify({
    version:'v110-unsent-forward-receipts-v1',observedAt:now,
    sampledMarkets:earlyCensus.validSameClose,
    cohortStatus:earlyCensus.status,
    part:i/8+1,parts:Math.ceil(frozen.length/8),
    receipts:frozen.slice(i,i+8)
   }));
  }
 }
 const {frozenForwardReceipts:ignoredFrozen,...safeCensus}=earlyCensus;
 result.all32EarlyCohortResearch={...safeCensus,
  receiptsLogged:frozen.length<=32?frozen.length:0,
  forwardOutcomesMeasured:false};
 // ALL 32 have already contributed to V110 research above. This selection
 // changes ONLY the separate forecast ntfy stream. It does not change the
 // source 32-market scan, confirmed 5m alerts, or trading eligibility.
 const deliverySnapshots=snapshots.filter(d=>forecastNotificationAllowed(d.symbol));
 result.excludedFromForecastNtfy=snapshots.length-deliverySnapshots.length;
 // V4: evidence-first ranking for only the existing two FORECAST ntfy
 // slots. No future labels, extra scans, order calls, or volume increase.
 deliverySnapshots.sort((a,b)=>
  rankForecastV4(b).score-rankForecastV4(a).score||
  a.symbol.localeCompare(b.symbol));
 for(const d of deliverySnapshots){
  if(result.delivered>=MAX_PER_BUCKET-inBucket)break;
  // Re-check arrival time, not merely the timestamp captured before
  // A variable-size WEEX watchlist. Observations sent late are not an early forecast.
  if(clock()-d.timeframes[0].closedAt>120000)continue;
  const id=idFor(d.symbol,d.combinedDirection,Math.floor(now/HALF_HOUR));
  if(seen.has(id)){result.duplicates++;continue}
  try{
   // Research-only depth: <=2 public snapshots per 10-minute bucket.
   // The 900ms snapshot timeout never blocks delivery on failure; metadata
   // rides in the EXISTING ntfy click fragment, not in visible message text.
   const notice=forecastMessage(d);
   let depth=null;
   try{depth=await depthCapture(d.symbol,{fetchImpl,clock})}catch{}
   if(depth){
    notice.click=attachV110DepthClick(notice.click,depth,{id,env});
    if(notice.click.includes('#v110d='))result.depthCaptured++;
   }else result.depthUnavailable++;
   await publish(topic,{...notice,sequenceId:id});
   result.delivered++;seen.add(id);
   console.info('WEEX_RADAR_FORECAST_SENT '+JSON.stringify({
    symbol:d.symbol,direction:d.combinedDirection,
    strength:assessForecastStrengthRisk(d).level,
    v4:rankForecastV4(d).status,notATrade:true
   }));
  }catch(e){
   result.failed++;
   console.warn('WEEX_RADAR_FORECAST_SEND_FAILED '+
    String(e.message||e).slice(0,70));
  }
 }
 result.followerNotices=await followerPromise;
 return result;
}
