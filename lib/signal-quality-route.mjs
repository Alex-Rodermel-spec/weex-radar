// Read-only short-window review of notifications actually accepted by ntfy.
// Uses the owner-configured server-only topic; never returns it or account data.
// No Blob writes, exchange keys, orders, background jobs, subscriptions or billing.
import {_test as radar} from '../api/signals.mjs';
import {WINDOW_MINUTES,HORIZON_MINUTES,parseConfirmedNotification,
 evaluateNotification,aggregateQuality} from './signal-quality.mjs';

const MAX_HISTORY_BYTES=250_000;
const responseHeaders=res=>{
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
};
const topic=()=>{
 const value=process.env.NTFY_TOPIC;
 return typeof value==='string'&&/^[A-Za-z0-9_-]{16,64}$/.test(value)?value:null;
};

async function historyOfSentSignals(privateTopic,now){
 const url='https://ntfy.sh/'+encodeURIComponent(privateTopic)+
  '/json?poll=1&since='+WINDOW_MINUTES+'m';
 const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(6500),
  headers:{Accept:'application/x-ndjson'}});
 if(!response.ok)throw Error('NTFY_HISTORY_UNAVAILABLE');
 const body=await response.text();
 if(body.length>MAX_HISTORY_BYTES)throw Error('NTFY_HISTORY_TOO_LARGE');
 const earliest=now-WINDOW_MINUTES*60_000;
 const seen=new Set(),items=[];
 for(const line of body.split(/\r?\n/)){
  if(!line.trim())continue;
  let message;
  try{message=JSON.parse(line)}catch{continue}
  if(message?.topic!==privateTopic)continue;
  const alert=parseConfirmedNotification(message);
  if(!alert||!radar.SYMBOLS.includes(alert.symbol)||
    alert.sentAt<earliest||alert.sentAt>now+5000)continue;
  const id=alert.id||[alert.symbol,alert.direction,alert.sentAt].join('|');
  if(seen.has(id))continue;
  seen.add(id);
  items.push(alert);
  if(items.length>=80)break;
 }
 return items.sort((a,b)=>b.sentAt-a.sentAt);
}

async function closedMinuteCandles(symbol,now){
 const url='https://api-contract.weex.com/capi/v3/market/klines?symbol='+
  encodeURIComponent(symbol)+'&interval=1m&limit=125';
 const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(7000),
  headers:{Accept:'application/json','User-Agent':'WEEX-RADAR/1.0'}});
 if(!response.ok)throw Error('WEEX_CANDLES_UNAVAILABLE');
 const data=await response.json();
 const entries=Array.isArray(data)?data:data?.data;
 if(!Array.isArray(entries))throw Error('WEEX_INVALID_CANDLES');
 const minute=60_000,unique=new Map();
 for(const row of entries){
  if(!Array.isArray(row)||row.length<6)continue;
  const [time,open,high,low,close,volume]=row.slice(0,6).map(Number);
  if(![time,open,high,low,close,volume].every(Number.isFinite)||
    open<=0||high<Math.max(open,low,close)||low>Math.min(open,close)||
    close<=0||volume<0||time>now||time<now-3*60*60_000||
    time+minute>now-1000)continue;
  unique.set(time,{time,closeTime:time+minute,high,low});
 }
 return [...unique.values()].sort((a,b)=>a.time-b.time);
}

async function fetchMarkets(symbols,now){
 const results=new Map();
 let cursor=0;
 async function worker(){
  while(cursor<symbols.length){
   const sym=symbols[cursor++];
   try{results.set(sym,await closedMinuteCandles(sym,now))}
   catch{results.set(sym,null)}
  }
 }
 await Promise.all(Array.from({length:Math.min(4,symbols.length)},()=>worker()));
 return results;
}

export default async function handler(req,res){
 responseHeaders(res);
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const privateTopic=topic();
 if(!privateTopic)return res.status(503).json({
  error:'История ntfy недоступна: нет настроенного серверного канала.'
 });
 const now=Date.now();
 try{
  const alerts=await historyOfSentSignals(privateTopic,now);
  const markets=await fetchMarkets([...new Set(alerts.map(a=>a.symbol))],now);
  const rows=alerts.map(alert=>{
   const outcome=evaluateNotification(alert,markets.get(alert.symbol),now);
   return {symbol:alert.symbol,direction:alert.direction,level:alert.level,
    sentAt:alert.sentAt,entry:alert.entry,stop:alert.stop,take:alert.take,
    rr:Math.round(Math.abs(alert.take-alert.entry)/Math.abs(alert.stop-alert.entry)*100)/100,
    status:outcome.status,outcomeAt:outcome.at};
  });
  return res.status(200).json({
   generatedAt:now,windowMinutes:WINDOW_MINUTES,horizonMinutes:HORIZON_MINUTES,
   source:'sent ntfy confirmed alerts (WEEX only)',
   qualityType:'illustrative candle-touch review, not executed trade profit',
   candleRule:'Same-minute or both-level touches are uncertain and never scored as wins.',
   durableStorage:false,
   stats:aggregateQuality(rows),signals:rows
  });
 }catch{
  return res.status(503).json({
   error:'Не удалось получить историю ntfy. Сигналы бота продолжат работать независимо.'
  });
 }
}
