// PR110 research-only retrospective of the SEPARATE WEEX Forecast ntfy topic.
// These messages have direction + printed current 1m price, NOT a trigger,
// cancellation level, trade entry, or evidence of a linked STRONG 5m signal.
// All calculations use future closed WEEX 1m OHLC after actual ntfy time.
import {evaluateEarlyDirection} from './early-study.mjs';
import {marketForecastProfile} from './market-forecast-profiles.mjs';
const MIN=60_000;
const LABELS=Object.freeze({
 '🔵 ОБЫЧНЫЙ ПРОГНОЗ':'ORDINARY',
 '🟡 ПОВЫШЕННЫЙ РИСК':'ELEVATED_RISK',
 '🟣 СИЛЬНЫЙ ПРОГНОЗ':'DISPLAY_STRONG'
});
export const STANDALONE_FORECAST_AUDIT=Object.freeze({
 version:'2026-11-12-pr110-separate-forecast-ntfy-direction-study-v1',
 horizonsMinutes:[5,10,15],maxHistoryMinutes:110,
 actualNtfyTime:true,strictlyPostNoticeClosedMinutes:true,
 forecastIsNotEntrySignal:true,hasBreakoutTrigger:false,
 canPromoteToStrong:false,ordersSent:0,notificationsSent:0
});
const round=x=>Number(x.toFixed(2));
const freshSym=s=>typeof s==='string'&&/^[A-Z0-9]{2,24}$/.test(s);
export function parseStandaloneNtfyMessage(row,expectedTopic=null){
 if(row?.event!=='message'||typeof row.title!=='string'||
  typeof row.message!=='string'||!Number.isSafeInteger(row.time)||row.time<=0||
  expectedTopic!==null&&row.topic!==expectedTopic)return null;
 const m=row.title.match(/^🔮 (🔵 ОБЫЧНЫЙ ПРОГНОЗ|🟡 ПОВЫШЕННЫЙ РИСК|🟣 СИЛЬНЫЙ ПРОГНОЗ) · ([A-Z0-9]{2,24}) (LONG|SHORT)$/u);
 if(!m||!freshSym(m[2])||!marketForecastProfile(m[2]))return null;
 if(!row.message.includes('WEEX')||
  !row.message.includes('Направление 1М / 5М / 10М совпало.'))return null;
 const p=row.message.match(/^Цена 1М:\s*([0-9]+(?:[.,][0-9]+)?)\s+USDT\s*·\s*свеча\s+[0-9]{2}:[0-9]{2}\s*$/mu);
 const entry=Number(p?.[1]?.replace(',','.'));
 if(!Number.isFinite(entry)||entry<=0)return null;
 const sentAt=row.time*1000;
 if(!Number.isSafeInteger(sentAt))return null;
 const id=typeof row.sequence_id==='string'&&/^[a-f0-9]{32}$/.test(row.sequence_id)?
  row.sequence_id:m[2]+'|'+m[3]+'|'+sentAt;
 return {key:id,symbol:m[2],direction:m[3],
  level:LABELS[m[1]],entry,sentAt,
  group:marketForecastProfile(m[2]).group};
}
const TYPES=['ORDINARY','ELEVATED_RISK','DISPLAY_STRONG'];
function aggregate(alerts,candlesBySymbol,now){
 const outcomes=alerts.map(a=>({
  alert:a, windows:Object.fromEntries(STANDALONE_FORECAST_AUDIT.horizonsMinutes
   .map(h=>[h,evaluateEarlyDirection(a,candlesBySymbol?.get(a.symbol),h,now)]))
 }));
 const horizons={};
 for(const h of STANDALONE_FORECAST_AUDIT.horizonsMinutes){
  const cells=outcomes.map(r=>r.windows[h]);
  const observed=cells.filter(w=>w.status==='OBSERVED');
  const good=observed.filter(w=>w.moveBps>0),bad=observed.filter(w=>w.moveBps<0);
  horizons[h]={observed:observed.length,favorable:good.length,
   adverse:bad.length,flat:observed.length-good.length-bad.length,
   pending:cells.filter(w=>w.status==='PENDING').length,
   noData:cells.filter(w=>w.status==='NO_DATA').length,
   favorablePct:observed.length?round(good.length*100/observed.length):null,
   meanDirectionBps:observed.length?round(observed.reduce((s,w)=>s+w.moveBps,0)/observed.length):null};
 }
 const pairs=outcomes.filter(o=>o.windows[5].status==='OBSERVED'&&
  o.windows[10].status==='OBSERVED');
 return {total:alerts.length,horizons,
  continuationAfter5m:{observed:pairs.length,
   favorableAt5mAnd10m:pairs.filter(o=>o.windows[5].moveBps>0&&o.windows[10].moveBps>0).length,
   favorableAt5mThenReversedBy10m:pairs.filter(o=>o.windows[5].moveBps>0&&o.windows[10].moveBps<0).length},
  interpretation:'Direction from the printed ntfy close price, not an entry price; no fees or positions.'};
}
export function summarizeStandaloneForecastNotices(alerts,candlesBySymbol,now=Date.now()){
 const unique=new Map();
 for(const a of Array.isArray(alerts)?alerts:[]){
  if(!a||!a.key||!TYPES.includes(a.level)||!freshSym(a.symbol)||
   !Number.isSafeInteger(a.sentAt)||a.sentAt>now||
   a.sentAt<now-STANDALONE_FORECAST_AUDIT.maxHistoryMinutes*MIN||
   !Number.isFinite(a.entry)||a.entry<=0||!['LONG','SHORT'].includes(a.direction))continue;
  if(!unique.has(a.key))unique.set(a.key,a);
 }
 const selected=[...unique.values()];
 return {mode:'ACTUAL_SEPARATE_NTFY_FORECAST_AUDIT',
  policy:STANDALONE_FORECAST_AUDIT.version,
  source:'actual ntfy FORECAST topic messages + closed public WEEX 1m',
  ...( {overall:aggregate(selected,candlesBySymbol,now),
    byLabel:Object.fromEntries(TYPES.map(level=>[level,
     aggregate(selected.filter(a=>a.level===level),candlesBySymbol,now)])),
    byMarketGroup:Object.fromEntries([...new Set(selected.map(a=>a.group))].sort()
      .map(g=>[g,aggregate(selected.filter(a=>a.group===g),candlesBySymbol,now)]))} ),
  noAutotrading:true,notificationsSent:0,
  caveat:'Ntfy relay accepted time is not verified phone receive time. Prices are displayed/rounded and not actual fills. Forecast 1m/5m/10m has no published early trigger; it cannot be counted as a paired STRONG 5m alert.'};
}
