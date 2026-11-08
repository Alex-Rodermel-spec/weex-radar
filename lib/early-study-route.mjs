// On-demand, read-only research of EARLY WATCH messages.
// No push, orders, trading credentials, changes to filters or durable writes.
import {_test as radar} from '../api/signals.mjs';
import {parseConfirmedNotification} from './signal-quality.mjs';
import {parseEarlyNotification,normalizeEarlyCandles,
 summarizeEarlyStudy} from './early-study.mjs';
const WINDOW_MINUTES=110,MAX_HISTORY_BYTES=250000,MAX_EARLY=80;
const MINUTE=60000;
function configuredTopic(){
 const topic=process.env.NTFY_TOPIC;
 return typeof topic==='string'&&/^[A-Za-z0-9_-]{16,64}$/.test(topic)?topic:null;
}
async function notifications(topic,now,fetchImpl=fetch){
 const url='https://ntfy.sh/'+encodeURIComponent(topic)+'/json?poll=1&since='+WINDOW_MINUTES+'m';
 const r=await fetchImpl(url,{signal:AbortSignal.timeout(7000),cache:'no-store',
  headers:{Accept:'application/x-ndjson'}});
 if(!r.ok)throw Error('NTFY_RESEARCH_UNAVAILABLE');
 const text=await r.text();
 if(text.length>MAX_HISTORY_BYTES)throw Error('NTFY_RESEARCH_TOO_LARGE');
 const early=[],confirmed=[],start=now-WINDOW_MINUTES*MINUTE;
 for(const line of text.split(/\r?\n/)){
  if(!line.trim())continue;
  let row;try{row=JSON.parse(line)}catch{continue}
  if(row.topic!==topic)continue;
  const watch=parseEarlyNotification(row);
  if(watch&&radar.SYMBOLS.includes(watch.symbol)&&
    watch.sentAt>=start&&watch.sentAt<=now+5000)early.push(watch);
  const regular=parseConfirmedNotification(row);
  if(regular&&radar.SYMBOLS.includes(regular.symbol)&&
    regular.sentAt>=start&&regular.sentAt<=now+5000)confirmed.push(regular);
 }
 const seen=new Set(),unique=[];
 for(const entry of early.sort((a,b)=>b.sentAt-a.sentAt)){
  if(seen.has(entry.key))continue;
  seen.add(entry.key);unique.push(entry);
 }
 return {early:unique.slice(0,MAX_EARLY),confirmed,
  truncated:unique.length>MAX_EARLY};
}
async function candles(symbol,now,fetchImpl=fetch){
 const url='https://api-contract.weex.com/capi/v3/market/klines?symbol='+
  encodeURIComponent(symbol)+'&interval=1m&limit=125';
 const response=await fetchImpl(url,{signal:AbortSignal.timeout(7000),
  cache:'no-store',headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-RESEARCH/1.0'}});
 if(!response.ok)throw Error('WEEX_RESEARCH_UNAVAILABLE');
 const body=await response.text();
 if(body.length>200000)throw Error('WEEX_RESEARCH_TOO_LARGE');
 const json=JSON.parse(body);
 return normalizeEarlyCandles(Array.isArray(json)?json:json?.data,now);
}
async function recentMarketCandles(symbols,now){
 const result=new Map();let next=0;
 async function worker(){
  while(next<symbols.length){
   const symbol=symbols[next++];
   try{result.set(symbol,await candles(symbol,now))}
   catch{result.set(symbol,null)}
  }
 }
 await Promise.all(Array.from({length:Math.min(6,symbols.length)},()=>worker()));
 return result;
}
export async function handleEarlyStudy(req,res){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const topic=configuredTopic();
 if(!topic)return res.status(503).json({error:'ntfy не настроен для исследования.'});
 const now=Date.now();
 try{
  const {early,confirmed,truncated}=await notifications(topic,now);
  const markets=await recentMarketCandles([...new Set(early.map(a=>a.symbol))],now);
  const study=summarizeEarlyStudy(early,markets,confirmed,now);
  return res.status(200).json({generatedAt:now,
   source:'actual ntfy WEEX early alerts, not hypothetical scanner candidates',
   windowMinutes:WINDOW_MINUTES,durableStorage:false,
   sampleTruncated:truncated,verifiedPhoneDelivery:false,
   description:'5/15/30m direction of closed candles after the alert, versus rounded displayed alert price.',
   limitations:'Not a trade backtest: no executions, fees, spreads, leverage, or liquidation. A correct direction does not imply a profitable entry. Partial alert minute excluded. The ntfy cache is short-lived.',
   ...study,rows:study.rows.slice(0,15)
  });
 }catch(e){
  console.warn('WEEX_RADAR_EARLY_STUDY_ERROR '+String(e?.message||e).slice(0,65));
  return res.status(503).json({error:'Исследование временно недоступно; отправка сигналов работает независимо.'});
 }
}
