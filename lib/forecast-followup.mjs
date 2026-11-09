// One-time observation of previously SENT WEEX PRE_BREAK forecasts.
// Uses CLOSED 1m candles only. This is NOT an order, trade signal,
// profitability estimate, win-rate calculation or a 5m confirmation.
import {createHash} from 'node:crypto';
const MINUTE=60_000;
const HORIZON=5*MINUTE;
const SYM=/^[A-Z0-9]{2,24}$/;
const numeric=s=>Number(String(s||'').replace(',','.'));
const positive=n=>Number.isFinite(n)&&n>0;
const title=/^🔮 ПРОГНОЗ · ([A-Z0-9]{2,24}) (LONG|SHORT) · 🟡 ЖДАТЬ$/u;
const trigger=/^🔑 Подтверждение: (ниже|выше) ([\d.,]+)\s*$/mu;
const cancel=/^❌ Отмена сценария: (ниже|выше) ([\d.,]+)\s*$/mu;

export function parseForecastMessage(row,now=Date.now()){
 if(row?.event!=='message'||!Number.isSafeInteger(Number(row.time))||
  !/^[a-f0-9]{32}$/.test(row.sequence_id||'')||
  typeof row.title!=='string'||typeof row.message!=='string'||row.message.length>3000)
  return null;
 const match=row.title.match(title);
 if(!match||!SYM.test(match[1])||
  !/WEEX · 📍 Сейчас:\s*[\d.,]+\s+USDT/u.test(row.message))return null;
 const time=Number(row.time)*1000;
 // Forecast follow-up should only cover a live five-minute horizon, not
 // replay stale messages or misidentify old alerts from the ntfy cache.
 if(time>now+1000||time<now-7*MINUTE)return null;
 const t=row.message.match(trigger),c=row.message.match(cancel),direction=match[2];
 if(!t||!c||t[1]!== (direction==='SHORT'?'ниже':'выше')||
    c[1]!== (direction==='SHORT'?'выше':'ниже'))return null;
 const triggerPrice=numeric(t[2]),cancelPrice=numeric(c[2]);
 if(!positive(triggerPrice)||!positive(cancelPrice)||
    !(direction==='SHORT'?triggerPrice<cancelPrice:triggerPrice>cancelPrice))return null;
 return {id:row.sequence_id,symbol:match[1],direction,trigger:triggerPrice,
  invalidation:cancelPrice,sentAt:time,horizonEndsAt:time+HORIZON};
}

export function followupSequence(forecast){
 return createHash('sha256').update('weex:forecast-followup:v1|'+forecast.id).digest('hex').slice(0,32);
}
export function normalizeFollowupCandles(rows,now=Date.now()){
 if(!Array.isArray(rows)||rows.length>100)return [];
 const all=new Map();
 for(const row of rows){
  if(!Array.isArray(row)||row.length<6)continue;
  const [time,open,high,low,close,volume]=row.slice(0,6).map(Number);
  if(!Number.isSafeInteger(time)||time<now-15*MINUTE||
    time+MINUTE>now-1000||[open,high,low,close,volume].some(x=>!Number.isFinite(x))||
    Math.min(open,high,low,close)<=0||volume<0||
    high<Math.max(open,close)||low>Math.min(open,close))continue;
  all.set(time,{time,closeTime:time+MINUTE,open,high,low,close});
 }
 return [...all.values()].sort((a,b)=>a.time-b.time);
}

export function evaluateForecast(forecast,candles,now=Date.now()){
 if(!forecast||!Array.isArray(candles))return {status:'NO_DATA'};
 // No bar containing the send time is inspected: it could have hit trigger
 // BEFORE the notification. Only wholly subsequent, completed bars count.
 const first=Math.ceil((forecast.sentAt+1)/MINUTE)*MINUTE;
 const horizon=forecast.horizonEndsAt;
 let expected=first,used=0;
 for(const bar of candles){
  if(bar.time<first||bar.closeTime>horizon||bar.closeTime>now-1000)continue;
  if(bar.time!==expected)return {status:'NO_DATA'};
  expected+=MINUTE;used++;
  const short=forecast.direction==='SHORT';
  const invalid=short?bar.high>=forecast.invalidation:bar.low<=forecast.invalidation;
  const confirmed=short?bar.close<forecast.trigger:bar.close>forecast.trigger;
  if(invalid&&confirmed)return {status:'AMBIGUOUS',at:bar.closeTime};
  if(invalid)return {status:'INVALIDATED',at:bar.closeTime};
  if(confirmed)return {status:'BREAKOUT',at:bar.closeTime,close:bar.close};
 }
 if(now>=horizon+MINUTE&&used>0&&expected>=Math.floor(horizon/MINUTE)*MINUTE)
  return {status:'EXPIRED',at:horizon};
 return {status:'PENDING'};
}
export function forecastFollowupMessage(forecast,result,market,now=Date.now()){
 const {symbol,direction}=forecast;
 const icon=direction==='LONG'?'📈':'📉';
 if(result.status==='PENDING'||result.status==='NO_DATA')return null;
 let decision='WAIT',title,details;
 if(result.status==='BREAKOUT'){
  const advisor=market?.advisor;
  const ready=market?.status==='ok'&&market?.exchange==='WEEX'&&
   market.direction===direction&&advisor?.status==='REVIEW'&&
   Number.isFinite(market.expiresAt)&&market.expiresAt>now+30000&&
   Number.isFinite(market.livePrice)&&Number.isFinite(market.stop)&&
   Number.isFinite(market.take)&&Number.isFinite(advisor.netRR)&&advisor.netRR>=1.5;
  decision=ready?'REVIEW':'WAIT';
  title=ready?'🟢 ПРОВЕРИТЬ ВХОД · '+symbol+' '+direction+' · ПОСЛЕ ПРОГНОЗА':
   '✅ ПРОБОЙ · '+symbol+' '+direction+' · 🟡 ЖДАТЬ 5М';
  details=ready?
   'СОВЕТНИК: свежий 5м сигнал, подтверждённый ретест и модель расходов прошли. '+
   'Перепроверь цену и риск вручную. Уровни: вход '+market.livePrice+
   ' · SL '+market.stop+' · TP '+market.take+
   ' · модель net R/R '+advisor.netRR.toFixed(2)+':1.':
   'Минутный пробой подтверждён, но свежего одобренного советником входа 5м нет. НЕ ВХОДИТЬ без отдельного подтверждения.';
 }else{
  title=result.status==='EXPIRED'?
   '⚪ НЕ ПОДТВЕРДИЛОСЬ · '+symbol+' '+direction:
   '🔴 НЕ ВХОДИТЬ · '+symbol+' '+direction;
  details=result.status==='EXPIRED'?
   'За время прогноза не было подтверждённого пробоя по закрытой 1м свече.':
   result.status==='AMBIGUOUS'?
   'В одной свече цена затронула конфликтующие уровни; последовательность неизвестна. Не входить.':
   'Цена достигла уровня отмены сценария. Не входить.';
  decision='SKIP';
 }
 const time=new Date(result.at).toLocaleTimeString('ru-RU',{
  timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
 });
 return {title,decision,
  message:icon+' ИТОГ ПРОГНОЗА · '+symbol+' '+direction+'\n'+
   'Порог: '+forecast.trigger+' · отмена: '+forecast.invalidation+'\n'+
   details+'\n🕒 Проверено по закрытой 1м свече: '+time+
   '\n⚠️ Прогноз не гарантирует прибыль. Исходный ранний сигнал уже не является разрешением на вход.'};
}
