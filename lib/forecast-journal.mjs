// Read-only audit of ACTUALLY SENT independent ntfy 1m/5m/10m forecasts.
// Uses the existing private forecast topic and closed WEEX 1m candles; never
// changes phone notifications, scanning, trading, secrets or cron cadence.
// Individual observations are persisted only in the existing encrypted journal.
import {forecastTopic} from './forecast-ntfy.mjs';
import {_test as radar} from '../api/signals.mjs';

export const FORECAST_HORIZONS=Object.freeze([1,5,10,15,30]);
export const MAX_FORECAST_ROWS=1200;
const MIN=60000,DAY=86400000;
const MAX_HISTORY_BYTES=250000;
const ROUND=(n,dec=2)=>Number(n.toFixed(dec));
const validNumber=n=>typeof n==='number'&&Number.isFinite(n);
const price=n=>validNumber(n)&&n>0;
const STRENGTH=new Set(['STRONG','STANDARD','CAUTION']);
const STATUS=new Set(['OBSERVED','PENDING','NO_DATA']);
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
 const sentAt=row.time*1000,reference=ref?Number(ref[1]):null;
 if(!t||!price(reference)||sentAt>now+5000||
  sentAt<now-110*MIN||!radar.SYMBOLS.includes(t[2]))return null;
 return {id:row.sequence_id,symbol:t[2],direction:t[3],
  strength:LABEL[t[1]],reference,sentAt};
}
function validCandle(row,now){
 if(!Array.isArray(row)||row.length<6)return null;
 const [time,open,high,low,close,volume]=row.slice(0,6).map(Number);
 if(!Number.isSafeInteger(time)||time%MIN!==0||
  time+MIN>now-1000||time<now-125*MIN||
  ![open,high,low,close,volume].every(validNumber)||
  !price(open)||!price(close)||!price(low)||high<Math.max(open,low,close)||
  low>Math.min(open,close)||volume<0)return null;
 return {time,closeTime:time+MIN,close};
}
export function normalizeForecastMinutes(raw,now=Date.now()){
 if(!Array.isArray(raw)||raw.length>500)return [];
 const map=new Map();
 for(const x of raw){
  const c=validCandle(x,now);
  if(c)map.set(c.time,c);
 }
 return [...map.values()].sort((a,b)=>a.time-b.time);
}
function empty(status='PENDING'){return {status,moveBps:null}}
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
 return {...forecast,windows,firstFavorable10bpsMinute,firstAdverse10bpsMinute};
}
const keyOf=x=>x.id;
export function normalizeForecastArchiveRow(row,now=Date.now()){
 if(!row||!/^[a-f0-9]{32}$/.test(row.id||'')||
  !radar.SYMBOLS.includes(row.symbol)||!['LONG','SHORT'].includes(row.direction)||
  !STRENGTH.has(row.strength)||!price(row.reference)||
  !Number.isSafeInteger(row.sentAt)||row.sentAt<=now-90*DAY||
  row.sentAt>now+5000||!row.windows)return null;
 const windows={};
 for(const h of FORECAST_HORIZONS){
  const w=row.windows[h];
  if(!w||!STATUS.has(w.status)||
    (w.status==='OBSERVED'&&(!validNumber(w.moveBps)||Math.abs(w.moveBps)>1e6)))
   return null;
  windows[h]=w.status==='OBSERVED'?{status:'OBSERVED',moveBps:ROUND(w.moveBps)}:empty(w.status);
 }
 const onset=v=>Number.isInteger(v)&&v>=1&&v<=30?v:null;
 return {id:row.id,symbol:row.symbol,direction:row.direction,
  strength:row.strength,reference:ROUND(row.reference,10),
  sentAt:row.sentAt,windows,
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
  const fav=old.firstFavorable10bpsMinute??row.firstFavorable10bpsMinute;
  const adv=old.firstAdverse10bpsMinute??row.firstAdverse10bpsMinute;
  if(fav!==old.firstFavorable10bpsMinute||adv!==old.firstAdverse10bpsMinute)changed=true;
  if(changed){map.set(keyOf(row),{...old,windows,
   firstFavorable10bpsMinute:fav,firstAdverse10bpsMinute:adv});counts.updated++}
 }
 const sorted=[...map.values()].sort((a,b)=>b.sentAt-a.sentAt);
 const overflow=Math.max(0,sorted.length-MAX_FORECAST_ROWS);
 return {rows:sorted.slice(0,MAX_FORECAST_ROWS),
  changed:Object.values(counts).some(Boolean)||overflow>0,
  ...counts,dropped:counts.dropped+overflow};
}
function stats(rows,h){
 const w=rows.map(r=>r.windows[h]);
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
export function summarizeForecastArchive(rows,now=Date.now()){
 const periods={};
 for(const days of [30,90]){
  const selected=rows.filter(r=>r.sentAt>now-days*DAY&&r.sentAt<=now);
  const byStrength={};
  for(const kind of ['STRONG','STANDARD','CAUTION']){
   const subset=selected.filter(r=>r.strength===kind);
   byStrength[kind]={total:subset.length,
    at10m:stats(subset,10),at15m:stats(subset,15)};
  }
  const onset=selected.filter(r=>r.firstFavorable10bpsMinute!==null&&
   r.firstFavorable10bpsMinute!==undefined);
  periods[days]={total:selected.length,
   ...Object.fromEntries(FORECAST_HORIZONS.map(h=>['at'+h+'m',stats(selected,h)])),
   byStrength,
   firstFavorable10bps:{observed:onset.length,
    within5:onset.filter(r=>r.firstFavorable10bpsMinute<=5).length,
    from6to9:onset.filter(r=>r.firstFavorable10bpsMinute>=6&&r.firstFavorable10bpsMinute<=9).length,
    from10to15:onset.filter(r=>r.firstFavorable10bpsMinute>=10&&r.firstFavorable10bpsMinute<=15).length,
    after15:onset.filter(r=>r.firstFavorable10bpsMinute>15).length}};
 }
 return {archivedForecasts:rows.length,windows:periods,source:'Actually published, separate WEEX ntfy forecasts',
  definition:'Direction measured using the printed, rounded 1m reference close and fully subsequent closed 1m bars; horizon is bar count after publishing, not exact execution time.',
  onsetDefinition:'First subsequent closed 1m candle at least 10 basis points (0.10%) beyond reference in forecast direction; not the instant a market move began.',
  caveat:'Observational directional movement only, NOT fill/profit/win-rate after fees. Archive starts only after rollout; missing historical alerts or candle gaps cannot be inferred.'};
}
async function privateRecentForecasts(now,fetchImpl,env){
 const topic=forecastTopic(env);
 if(!topic)throw Error('FORECAST_TOPIC_UNAVAILABLE');
 const response=await fetchImpl('https://ntfy.sh/'+encodeURIComponent(topic)+'/json?poll=1&since=110m',{
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
 return [...map.values()].sort((a,b)=>b.sentAt-a.sentAt).slice(0,60);
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
