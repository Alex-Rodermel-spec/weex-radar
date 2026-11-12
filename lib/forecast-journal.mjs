// Read-only audit of ACTUALLY SENT independent ntfy 1m/5m/10m forecasts.
// Uses the existing private forecast topic and closed WEEX 1m candles; never
// changes phone notifications, scanning, trading, secrets or cron cadence.
// Individual observations are persisted only in the existing encrypted journal.
import {forecastTopic} from './forecast-ntfy.mjs';
import {forecastHypothesisAudit} from './forecast-hypotheses.mjs';
import {forecastQualityShadowAudit} from './forecast-quality-gate.mjs';
import {forecastHourlyStudy} from './forecast-hourly-study.mjs';
import {forecastTimingAudit} from './forecast-timing-audit.mjs';
import {forecastLeadWindowAudit} from './forecast-lead-window-audit.mjs';
import {strongTimingShadowAudit} from './forecast-strong-timing-shadow.mjs';
import {_test as radar} from '../api/signals.mjs';

export const FORECAST_HORIZONS=Object.freeze([1,5,10,15,20,30]);
export const FIVE_MINUTE_CLOSES=Object.freeze([1,2,3]);
export const MAX_FORECAST_ROWS=5000; // >=14 days at max 2 forecasts per 10-minute bucket
const MIN=60000,FIVE=5*MIN,DAY=86400000;
// Recover forecasts after a paused archive job; unavailable old candles remain NO_DATA.
const BACKFILL_LOOKBACK=12*60*MIN;
const MAX_HISTORY_BYTES=250000;
const ROUND=(n,dec=2)=>Number(n.toFixed(dec));
const validNumber=n=>typeof n==='number'&&Number.isFinite(n);
const price=n=>validNumber(n)&&n>0;
const STRENGTH=new Set(['STRONG','STANDARD','CAUTION']);
const STATUS=new Set(['OBSERVED','PENDING','NO_DATA']);
const V2_TIMING=new Set(['LATE','CLEAR','UNKNOWN']);
// Calendar date in Europe/Berlin, including daylight-saving changes.
// Never label a rolling 24-hour window as "today".
const berlinCalendar=new Intl.DateTimeFormat('en-GB',{
 timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'
});
export function berlinDayKey(timestamp){
 if(!Number.isSafeInteger(timestamp)||timestamp<0)return null;
 const parts=Object.fromEntries(berlinCalendar.formatToParts(new Date(timestamp))
  .filter(x=>['day','month','year'].includes(x.type)).map(x=>[x.type,x.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}
const V2_LINE=/^🧪 V2: (возможное опоздание — не догоняй цену|явных признаков опоздания не найдено \(не гарантия\)|недостаточно данных для оценки опоздания)$/mu;
const V2_VALUES={'возможное опоздание — не догоняй цену':'LATE',
 'явных признаков опоздания не найдено (не гарантия)':'CLEAR',
 'недостаточно данных для оценки опоздания':'UNKNOWN'};
const TITLE=/^🔮 (🟣 СИЛЬНЫЙ ПРОГНОЗ|🔵 ОБЫЧНЫЙ ПРОГНОЗ|🟡 ПОВЫШЕННЫЙ РИСК) · ([A-Z0-9]{2,24}) (LONG|SHORT)$/u;
const REF=/^Цена 1М:\s*(\d+(?:\.\d+)?)\s+USDT\b/mu;
const LABEL={'🟣 СИЛЬНЫЙ ПРОГНОЗ':'STRONG','🔵 ОБЫЧНЫЙ ПРОГНОЗ':'STANDARD','🟡 ПОВЫШЕННЫЙ РИСК':'CAUTION'};

// Public ntfy timestamps are SECOND-resolution; the reference is the rounded
// 1m candle close printed in the alert, NOT a confirmed executable market quote.
export function parsePublishedForecast(row,topic,now=Date.now()){
 if(row?.event!=='message'||row.topic!==topic||
  !/^[a-f0-9]{32}$/.test(row.sequence_id||'')||
  !Number.isSafeInteger(row.time)||typeof row.title!=='string'||
  typeof row.message!=='string'||row.message.length>3000)return null;
 const t=row.title.match(TITLE),ref=row.message.match(REF);
 const line=row.message.match(V2_LINE);
 const sentAt=row.time*1000,reference=ref?Number(ref[1]):null;
 if(!t||!price(reference)||sentAt>now+5000||
  sentAt<now-BACKFILL_LOOKBACK||!radar.FORECAST_SYMBOLS.includes(t[2]))return null;
 return {id:row.sequence_id,symbol:t[2],direction:t[3],
  strength:LABEL[t[1]],reference,sentAt,
  v2Timing:LABEL[t[1]]==='CAUTION'?null:(line?V2_VALUES[line[1]]:null)};
}
function validCandle(row,now,maxAge=125*MIN){
 if(!Array.isArray(row)||row.length<6)return null;
 const [time,open,high,low,close,volume]=row.slice(0,6).map(Number);
 if(!Number.isSafeInteger(time)||time%MIN!==0||
  time+MIN>now-1000||time<now-maxAge||
  ![open,high,low,close,volume].every(validNumber)||
  !price(open)||!price(close)||!price(low)||high<Math.max(open,low,close)||
  low>Math.min(open,close)||volume<0)return null;
 return {time,closeTime:time+MIN,close};
}
export function normalizeForecastMinutes(raw,now=Date.now(),maxAge=125*MIN){
 if(!Array.isArray(raw)||raw.length>500)return [];
 const map=new Map();
 for(const x of raw){
  const c=validCandle(x,now,maxAge);
  if(c)map.set(c.time,c);
 }
 return [...map.values()].sort((a,b)=>a.time-b.time);
}
function empty(status='PENDING'){return {status,moveBps:null}}
// Measure how far the market had ALREADY moved in the forecast direction
// over the 5/15 minutes preceding the ntfy publication. All candles must
// be fully closed BEFORE the message and chronological with no missing bar.
function priorMomentum(forecast,map,minutes){
 const boundary=Math.floor(forecast.sentAt/MIN)*MIN,side=forecast.direction==='LONG'?1:-1;
 let previous=null,latest=null;
 for(let i=minutes;i>=0;i--){
  const c=map.get(boundary-(i+1)*MIN);
  if(!c||!price(c.close))return null;
  if(previous!==null&&c.time!==previous+MIN)return null;
  if(i===minutes)previous=c.time;
  else previous=c.time;
  if(i===minutes)latest=c.close;
  if(i===0&&Math.abs(c.close-forecast.reference)/forecast.reference>0.005)return null;
 }
 return ROUND(side*(forecast.reference-latest)/latest*10000);
}
// The FIRST fully subsequent 1m candle starts at the minute boundary strictly
// after publication. Horizon 10 is its tenth completed bar, rather than a
// look-ahead into the still-forming 16:10 candle.
export function evaluatePublishedForecast(forecast,candles,now=Date.now()){
 const start=Math.ceil((forecast.sentAt+1)/MIN)*MIN;
 const side=forecast.direction==='LONG'?1:-1;
 const map=new Map((candles||[]).map(c=>[c.time,c]));
 const windows={},onsetThresholdBps=10;
 let firstFavorable10bpsMinute=null,firstAdverse10bpsMinute=null;
 let contiguous=true;
 const changes=[];
 for(let minute=1;minute<=30;minute++){
  const closeTime=start+minute*MIN;
  const candle=map.get(start+(minute-1)*MIN);
  if(closeTime>now-1000){
   changes.push(null);
   continue;
  }
  if(!candle||!price(candle.close)){contiguous=false;changes.push(null);continue}
  if(!contiguous){changes.push(null);continue}
  const bps=side*(candle.close-forecast.reference)/forecast.reference*10000;
  changes.push(ROUND(bps));
  if(firstFavorable10bpsMinute===null&&bps>=onsetThresholdBps)
   firstFavorable10bpsMinute=minute;
  if(firstAdverse10bpsMinute===null&&bps<=-onsetThresholdBps)
   firstAdverse10bpsMinute=minute;
 }
 for(const horizon of FORECAST_HORIZONS){
  const due=start+horizon*MIN;
  windows[horizon]=due>now-1000?empty():
   changes[horizon-1]===null?empty('NO_DATA'):
   {status:'OBSERVED',moveBps:changes[horizon-1]};
 }
 // Check the first three 5-minute chart closing boundaries which are fully
 // AFTER publication. The send-minute candle itself is deliberately excluded.
 const firstFiveClose=Math.ceil((start+MIN)/FIVE)*FIVE;
 const aligned5m={};
 for(const i of FIVE_MINUTE_CLOSES){
  const boundary=firstFiveClose+(i-1)*FIVE;
  const index=Math.round((boundary-start)/MIN)-1;
  aligned5m[i]=boundary>now-1000?empty():
   index<0||changes[index]===null?empty('NO_DATA'):
   {status:'OBSERVED',moveBps:changes[index]};
 }
 return {...forecast,windows,aligned5m,
  // Pre-alert movements are observations, not executable entry prices.
  preMove1mBps:priorMomentum(forecast,map,1),
  preMove3mBps:priorMomentum(forecast,map,3),
  preMove5mBps:priorMomentum(forecast,map,5),
  preMove15mBps:priorMomentum(forecast,map,15),
  firstFavorable10bpsMinute,firstAdverse10bpsMinute};
}
const keyOf=x=>x.id;
export function normalizeForecastArchiveRow(row,now=Date.now()){
 if(!row||!/^[a-f0-9]{32}$/.test(row.id||'')||
  !radar.FORECAST_SYMBOLS.includes(row.symbol)||!['LONG','SHORT'].includes(row.direction)||
  !STRENGTH.has(row.strength)||!price(row.reference)||
  !Number.isSafeInteger(row.sentAt)||row.sentAt<=now-90*DAY||
  row.sentAt>now+5000||!row.windows)return null;
 const windows={};
 for(const h of FORECAST_HORIZONS){
  // Older encrypted archives lack a 20m field. Preserve those records
  // without pretending 20m was observed; historical candles can fill it.
  const w=h===20&&row.windows[h]===undefined?empty('NO_DATA'):row.windows[h];
  if(!w||!STATUS.has(w.status)||
    (w.status==='OBSERVED'&&(!validNumber(w.moveBps)||Math.abs(w.moveBps)>1e6)))
   return null;
  windows[h]=w.status==='OBSERVED'?{status:'OBSERVED',moveBps:ROUND(w.moveBps)}:empty(w.status);
 }
 const onset=v=>Number.isInteger(v)&&v>=1&&v<=30?v:null;
 const pre=v=>validNumber(v)&&Math.abs(v)<=1e6?ROUND(v):null;
 const aligned5m={};
 for(const i of FIVE_MINUTE_CLOSES){
  const w=row.aligned5m?.[i]??empty('NO_DATA'); // legacy entries lack aligned closes
  if(!STATUS.has(w.status)||w.status==='OBSERVED'&&
    (!validNumber(w.moveBps)||Math.abs(w.moveBps)>1e6))return null;
  aligned5m[i]=w.status==='OBSERVED'?{status:'OBSERVED',moveBps:ROUND(w.moveBps)}:empty(w.status);
 }
 return {id:row.id,symbol:row.symbol,direction:row.direction,
  strength:row.strength,reference:ROUND(row.reference,10),
  v2Timing:row.strength==='CAUTION'?null:
   V2_TIMING.has(row.v2Timing)?row.v2Timing:null,
  sentAt:row.sentAt,windows,aligned5m,
  preMove1mBps:pre(row.preMove1mBps),
  preMove3mBps:pre(row.preMove3mBps),
  preMove5mBps:pre(row.preMove5mBps),
  preMove15mBps:pre(row.preMove15mBps),
  firstFavorable10bpsMinute:onset(row.firstFavorable10bpsMinute),
  firstAdverse10bpsMinute:onset(row.firstAdverse10bpsMinute)};
}
export function mergeForecastArchive(previous,current,now=Date.now()){
 if(!Array.isArray(previous)||!Array.isArray(current)||
  previous.length>MAX_FORECAST_ROWS||current.length>100)
  throw Error('FORECAST_ARCHIVE_SIZE_LIMIT');
 const map=new Map(),counts={added:0,updated:0,dropped:0};
 for(const entry of previous){
  const row=normalizeForecastArchiveRow(entry,now);
  if(row)map.set(keyOf(row),row);else counts.dropped++;
 }
 for(const item of current){
  const row=normalizeForecastArchiveRow(item,now);
  if(!row)continue;
  const old=map.get(keyOf(row));
  if(!old){map.set(keyOf(row),row);counts.added++;continue}
  // Once an actual closed-candle result is measured, later polling must
  // NEVER erase it with PENDING/NO_DATA as the short WEEX history rotates.
  const windows={...old.windows};let changed=false;
  for(const h of FORECAST_HORIZONS){
   if(old.windows[h].status==='OBSERVED')continue;
   if(row.windows[h].status==='OBSERVED'||
      old.windows[h].status==='PENDING'&&row.windows[h].status==='NO_DATA'){
    if(JSON.stringify(windows[h])!==JSON.stringify(row.windows[h])){
     windows[h]=row.windows[h];changed=true;
    }
   }
  }
  const aligned5m={...old.aligned5m};
  for(const i of FIVE_MINUTE_CLOSES){
   if(old.aligned5m[i].status==='OBSERVED')continue;
   if(row.aligned5m[i].status==='OBSERVED'||
      old.aligned5m[i].status==='PENDING'&&row.aligned5m[i].status==='NO_DATA'){
    if(JSON.stringify(aligned5m[i])!==JSON.stringify(row.aligned5m[i])){
     aligned5m[i]=row.aligned5m[i];changed=true;
    }
   }
  }
  // Historical candle repair cannot relabel a forecast. Only preserve a
  // genuine V2 line recorded in its original ntfy message.
  const v2Timing=old.v2Timing??row.v2Timing;
  if(v2Timing!==old.v2Timing)changed=true;
  const preMove1mBps=old.preMove1mBps??row.preMove1mBps;
  const preMove3mBps=old.preMove3mBps??row.preMove3mBps;
  if(preMove1mBps!==old.preMove1mBps||preMove3mBps!==old.preMove3mBps)changed=true;
  const preMove5mBps=old.preMove5mBps??row.preMove5mBps;
  const preMove15mBps=old.preMove15mBps??row.preMove15mBps;
  if(preMove5mBps!==old.preMove5mBps||
     preMove15mBps!==old.preMove15mBps)changed=true;
  const fav=old.firstFavorable10bpsMinute??row.firstFavorable10bpsMinute;
  const adv=old.firstAdverse10bpsMinute??row.firstAdverse10bpsMinute;
  if(fav!==old.firstFavorable10bpsMinute||adv!==old.firstAdverse10bpsMinute)changed=true;
  if(changed){map.set(keyOf(row),{...old,windows,aligned5m,v2Timing,
    preMove1mBps,preMove3mBps,preMove5mBps,preMove15mBps,
   firstFavorable10bpsMinute:fav,firstAdverse10bpsMinute:adv});counts.updated++}
 }
 const sorted=[...map.values()].sort((a,b)=>b.sentAt-a.sentAt);
 const overflow=Math.max(0,sorted.length-MAX_FORECAST_ROWS);
 return {rows:sorted.slice(0,MAX_FORECAST_ROWS),
  changed:Object.values(counts).some(Boolean)||overflow>0,
  ...counts,dropped:counts.dropped+overflow};
}
function stats(rows,h,field='windows'){
 const w=rows.map(r=>r[field]?.[h]??empty('NO_DATA'));
 const observed=w.filter(x=>x.status==='OBSERVED');
 const good=observed.filter(x=>x.moveBps>0).length,
  bad=observed.filter(x=>x.moveBps<0).length;
 return {observed:observed.length,favorable:good,adverse:bad,
  flat:observed.length-good-bad,
  pending:w.filter(x=>x.status==='PENDING').length,
  noData:w.filter(x=>x.status==='NO_DATA').length,
  favorablePct:observed.length?ROUND(100*good/observed.length,1):null,
  meanDirectionBps:observed.length?ROUND(observed.reduce((sum,x)=>sum+x.moveBps,0)/observed.length):null};
}
function beforeStats(rows,field){
 const values=rows.map(r=>r[field]).filter(validNumber);
 return {observed:values.length,
  meanDirectionBps:values.length?ROUND(values.reduce((sum,x)=>sum+x,0)/values.length):null,
  already10bps:values.filter(n=>n>=10).length,
  already30bps:values.filter(n=>n>=30).length,
  already10bpsPct:values.length?ROUND(values.filter(n=>n>=10).length/values.length*100,1):null};
}
export function summarizeForecastArchive(rows,now=Date.now()){
 // Local Berlin midnight to now. Forecasts after now are never observed.
 const todayDate=berlinDayKey(now);
 const todays=rows.filter(r=>r.sentAt<=now&&berlinDayKey(r.sentAt)===todayDate);
 const today={
  dateBerlin:todayDate,timeZone:'Europe/Berlin',total:todays.length,
  at5m:stats(todays,5),at10m:stats(todays,10),at15m:stats(todays,15),
   at20m:stats(todays,20),
  byDirection:Object.fromEntries(['LONG','SHORT'].map(dir=>{
   const subset=todays.filter(r=>r.direction===dir);
   return [dir,{total:subset.length,at5m:stats(subset,5),
    at15m:stats(subset,15)}];
  })),
  byStrength:Object.fromEntries(['STRONG','STANDARD','CAUTION'].map(level=>{
   const subset=todays.filter(r=>r.strength===level);
   return [level,{total:subset.length,at5m:stats(subset,5),
    at15m:stats(subset,15)}];
  })),
  v2Timing:Object.fromEntries(['LATE','CLEAR','UNKNOWN'].map(state=>[
   state,todays.filter(r=>r.v2Timing===state).length
  ]))
 };
 const periods={};
 for(const days of [30,90]){
  const selected=rows.filter(r=>r.sentAt>now-days*DAY&&r.sentAt<=now);
  const byStrength={};
  for(const kind of ['STRONG','STANDARD','CAUTION']){
   const subset=selected.filter(r=>r.strength===kind);
   byStrength[kind]={total:subset.length,
    at5m:stats(subset,5),at10m:stats(subset,10),at15m:stats(subset,15),
    alignedFirst5m:stats(subset,1,'aligned5m'),
    alignedSecond5m:stats(subset,2,'aligned5m'),
    alignedThird5m:stats(subset,3,'aligned5m'),
    before5m:beforeStats(subset,'preMove5mBps'),
    before15m:beforeStats(subset,'preMove15mBps')};
  }
  // Compare only forecasts with the SAME measured horizon, split by direction.
  // Unknown candles remain NO_DATA and never enter a directional hit-rate.
  const byDirection={};
  for(const side of ['LONG','SHORT']){
   const subset=selected.filter(r=>r.direction===side);
   byDirection[side]={total:subset.length,
    ...Object.fromEntries(FORECAST_HORIZONS.map(h=>['at'+h+'m',stats(subset,h)])),
    alignedFirst5m:stats(subset,1,'aligned5m'),
    before15m:beforeStats(subset,'preMove15mBps')};
  }
  // V2 is a message-time, shadow-only classification. Old alerts and CAUTION
  // are excluded from the tested cohort, not backfilled from later prices.
  const v2Eligible=selected.filter(r=>r.strength==='STRONG'||r.strength==='STANDARD');
  const byV2Timing={};
  for(const key of ['LATE','CLEAR','UNKNOWN','NOT_RECORDED']){
   const subset=v2Eligible.filter(r=>key==='NOT_RECORDED'?
    !V2_TIMING.has(r.v2Timing):r.v2Timing===key);
   const strength={};
   for(const level of ['STRONG','STANDARD']){
    const rows=subset.filter(r=>r.strength===level);
    strength[level]={total:rows.length,at5m:stats(rows,5),at15m:stats(rows,15)};
   }
   byV2Timing[key]={total:subset.length,
    at5m:stats(subset,5),at10m:stats(subset,10),at15m:stats(subset,15),
    byStrength:strength};
  }
  const onset=selected.filter(r=>r.firstFavorable10bpsMinute!==null&&
   r.firstFavorable10bpsMinute!==undefined);
  periods[days]={total:selected.length,
   ...Object.fromEntries(FORECAST_HORIZONS.map(h=>['at'+h+'m',stats(selected,h)])),
   aligned5m:Object.fromEntries(FIVE_MINUTE_CLOSES.map(i=>['close'+i,stats(selected,i,'aligned5m')])),
   before5m:beforeStats(selected,'preMove5mBps'),
   before15m:beforeStats(selected,'preMove15mBps'),
   byStrength,byDirection,byV2Timing,
   hypothesisAudit:forecastHypothesisAudit(selected,now),
   qualityShadowGate:forecastQualityShadowAudit(selected,now),
    berlinTimeOfDay:forecastHourlyStudy(selected,now),
    timingAudit:forecastTimingAudit(selected,now),
    leadWindowAudit:forecastLeadWindowAudit(selected,now),
    strongTimingShadow:strongTimingShadowAudit(selected,now),
   firstFavorable10bps:{observed:onset.length,
    within5:onset.filter(r=>r.firstFavorable10bpsMinute<=5).length,
    from6to9:onset.filter(r=>r.firstFavorable10bpsMinute>=6&&r.firstFavorable10bpsMinute<=9).length,
    from10to15:onset.filter(r=>r.firstFavorable10bpsMinute>=10&&r.firstFavorable10bpsMinute<=15).length,
    from15to19:onset.filter(r=>r.firstFavorable10bpsMinute>=15&&r.firstFavorable10bpsMinute<=19).length,
     from20to30:onset.filter(r=>r.firstFavorable10bpsMinute>=20&&r.firstFavorable10bpsMinute<=30).length,
     after15:onset.filter(r=>r.firstFavorable10bpsMinute>15).length}};
 }
 return {archivedForecasts:rows.length,today,windows:periods,source:'Actually published, separate WEEX ntfy forecasts',
  definition:'Direction measured using the printed, rounded 1m reference close and fully subsequent closed 1m bars; horizon is bar count after publishing, not exact execution time.',
   timingHypothesis:'15–19 minute count is the first subsequent fully closed 1m candle reaching +10bps (0.1%) in the forecast direction. It is not proof of foresight or the true onset of a market move.',
  onsetDefinition:'First subsequent closed 1m candle at least 10 basis points (0.10%) beyond reference in forecast direction; not the instant a market move began.',
  fiveMinuteDefinition:'Aligned 5m closes are the next three 5-minute chart closing boundaries containing at least one fully subsequent 1m candle; price is compared to the forecast alert reference, not a trade fill.',
  v2Definition:'V2 timing comes exclusively from the original forecast ntfy line. LATE/CLEAR/UNKNOWN reflect a non-calibrated shadow review at send time, NOT future accuracy; older messages are NOT_RECORDED and CAUTION is not classified. Group results are descriptive and must be assessed by strength and coin before comparing.',
  priorMovementDefinition:'5m/15m pre-movement is price change in the forecast direction based entirely on already closed WEEX 1m bars BEFORE ntfy publication; positive means part of the trend had already occurred.',
  caveat:'Observational directional movement only, NOT fill/profit/win-rate after fees. Archive starts only after rollout; missing historical alerts or candle gaps cannot be inferred.'};
}
async function privateRecentForecasts(now,fetchImpl,env){
 const topic=forecastTopic(env);
 if(!topic)throw Error('FORECAST_TOPIC_UNAVAILABLE');
 const response=await fetchImpl('https://ntfy.sh/'+encodeURIComponent(topic)+'/json?poll=1&since=12h',{
  cache:'no-store',signal:AbortSignal.timeout(6500),
  headers:{Accept:'application/x-ndjson'}});
 if(!response.ok)throw Error('FORECAST_NTFY_HISTORY_'+response.status);
 const body=await response.text();
 if(body.length>MAX_HISTORY_BYTES)throw Error('FORECAST_HISTORY_LARGE');
 const map=new Map();
 for(const line of body.split(/\r?\n/)){
  if(!line.trim())continue;
  let row;try{row=JSON.parse(line)}catch{continue}
  const f=parsePublishedForecast(row,topic,now);
  if(f)map.set(f.id,f);
 }
 return [...map.values()].sort((a,b)=>b.sentAt-a.sentAt).slice(0,100);
}
async function minuteCandles(symbol,now,fetchImpl){
 const response=await fetchImpl('https://api-contract.weex.com/capi/v3/market/klines?symbol='+
  encodeURIComponent(symbol)+'&interval=1m&limit=125',{
  cache:'no-store',signal:AbortSignal.timeout(7000),
  headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-FORECAST-AUDIT/1.0'}});
 if(!response.ok)throw Error('FORECAST_WEEX_HTTP_'+response.status);
 const body=await response.text();
 if(body.length>240000)throw Error('FORECAST_WEEX_TOO_LARGE');
 const value=JSON.parse(body);
 return normalizeForecastMinutes(Array.isArray(value)?value:value?.data,now);
}
export async function recentForecastResearch(now=Date.now(),{
 fetchImpl=fetch,env=process.env
}={}){
 const recent=await privateRecentForecasts(now,fetchImpl,env);
 const markets=new Map(),symbols=[...new Set(recent.map(r=>r.symbol))],failed=new Set();
 let next=0;
 async function worker(){
  while(next<symbols.length){
   const symbol=symbols[next++];
   try{markets.set(symbol,await minuteCandles(symbol,now,fetchImpl))}
   catch{failed.add(symbol)}
  }
 }
 await Promise.all(Array.from({length:Math.min(6,symbols.length)},()=>worker()));
 // A failed WEEX market must not retroactively declare forecasts wrong.
 const rows=recent.filter(r=>!failed.has(r.symbol)).map(r=>
  evaluatePublishedForecast(r,markets.get(r.symbol),now));
 return {rows,seen:recent.length,missingMarkets:failed.size};
}


// Bounded archive repair: only already published, AES-GCM-archived forecasts.
// WEEX historyKlines is public read-only (weight 5, max 100 bars per request).
// Six requests per existing 20-minute journal run; never opens an order, changes
// a forecast, increases the cron cadence or stores unencrypted individual rows.
const RECOVERY_BATCH=6,RECOVERY_CONCURRENCY=3,RECOVERY_MAX_AGE=90*DAY;
function needsHistoricalCandles(row,now){
 const r=normalizeForecastArchiveRow(row,now);
 if(!r||r.sentAt>now-125*MIN)return false; // the regular short-window collector owns recent rows
 // Recover 1m/3m ONLY for fresh forward-study cohorts (bounded to 12h),
 // never replay all 90 days of stored history just for newly added fields.
 const missingFastTiming=r.sentAt>=Date.parse('2026-11-11T23:00:00.000Z')&&
  r.sentAt>=now-12*60*MIN&&
  (r.preMove1mBps===null||r.preMove3mBps===null);
 return missingFastTiming||r.preMove5mBps===null||r.preMove15mBps===null||
  [5,10,15,20,30].some(h=>r.windows[h].status!=='OBSERVED')||
  FIVE_MINUTE_CLOSES.some(h=>r.aligned5m[h].status!=='OBSERVED');
}
async function historicalForecastCandles(row,now,fetchImpl){
 // 17 minutes before and 31 minutes after the alert fit in one 100-bar page.
 const beginning=Math.floor(row.sentAt/MIN)*MIN-17*MIN;
 const first=Math.ceil((row.sentAt+1)/MIN)*MIN;
 const ending=Math.min(first+31*MIN,Math.floor(now/MIN)*MIN-MIN);
 if(ending<beginning)return [];
 const url='https://api-contract.weex.com/capi/v3/market/historyKlines?symbol='+
  encodeURIComponent(row.symbol)+'&interval=1m&startTime='+beginning+
  '&endTime='+ending+'&limit=100&priceType=LAST';
 const response=await fetchImpl(url,{cache:'no-store',signal:AbortSignal.timeout(5500),
  headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-HISTORY-REPAIR/1.0'}});
 if(!response.ok)throw Error('FORECAST_HISTORY_HTTP_'+response.status);
 const body=await response.text();
 if(body.length>150000)throw Error('FORECAST_HISTORY_TOO_LARGE');
 const value=JSON.parse(body);
 // If the exchange silently ignores time bounds and returns today's candles,
 // they are rejected. Missing historical bars must NEVER become fake wins.
 return normalizeForecastMinutes(Array.isArray(value)?value:value?.data,now,RECOVERY_MAX_AGE)
  .filter(c=>c.time>=beginning&&c.time<=ending);
}
export async function recoverArchivedForecasts(archive,now=Date.now(),{
 fetchImpl=fetch
}={}){
 if(!Array.isArray(archive)||archive.length>MAX_FORECAST_ROWS)
  throw Error('FORECAST_RECOVERY_INVALID_ARCHIVE');
 const candidates=archive.filter(r=>needsHistoricalCandles(r,now))
  .sort((a,b)=>a.sentAt-b.sentAt||a.id.localeCompare(b.id));
 if(!candidates.length)return {rows:[],attempted:0,failed:0};
 // Rotate the bounded slice between writer runs so an unavailable old candle
 // cannot starve all later observations. Do not persist a recovery cursor.
 const cycle=Math.floor(now/(20*MIN));
 const offset=(cycle*RECOVERY_BATCH)%candidates.length;
 const sample=Array.from({length:Math.min(RECOVERY_BATCH,candidates.length)},
  (_,i)=>candidates[(offset+i)%candidates.length]);
 const rows=[],failed={count:0};let next=0;
 async function worker(){
  while(next<sample.length){
   const f=sample[next++];
   try{
    const candles=await historicalForecastCandles(f,now,fetchImpl);
    if(candles.length)rows.push(evaluatePublishedForecast(f,candles,now));
   }catch{failed.count++} // Never log market prices or private archived signals.
  }
 }
 await Promise.all(Array.from({length:Math.min(RECOVERY_CONCURRENCY,sample.length)},()=>worker()));
 return {rows,attempted:sample.length,failed:failed.count};
}
