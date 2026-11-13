// Read-only 1m EARLY WATCH; ntfy is the sole live notification channel.
// All 32 radar markets use the existing concurrency=8, read-only freshness scanner.
// No order execution, Telegram polling, Chrome Push or Blob subscription work.
import {scanEarlySymbol} from './early-watch.mjs';
import {_test as marketSafety} from '../api/signals.mjs';
import {ntfySend} from './ntfy-alerts.mjs';

const watchFresh=(watch,now=Date.now())=>Boolean(
  watch&&watch.level==='EARLY_WATCH'&&['LONG','SHORT'].includes(watch.direction)&&
  watch.exchange==='WEEX'&&Number.isFinite(watch.candleCloseTime)&&
  watch.candleCloseTime<=now&&now-watch.candleCloseTime<=45000&&
  Number.isFinite(watch.expiresAt)&&watch.expiresAt>now+12000);

async function scanEarlyMarkets(symbols=marketSafety.SYMBOLS,scanner=scanEarlySymbol,metrics=null){
 // Keep a maximum of 8 WEEX markets in flight. As soon as any market finishes,
 // scan another one rather than waiting for the slowest member of a fixed batch.
 // This reduces head-of-line blocking without increasing API concurrency.
 const valid=Array(symbols.length).fill(null);
 let cursor=0,attempted=0,failedMarkets=0;
 const preBreakGates={};
 async function worker(){
  while(cursor<symbols.length){
   const i=cursor++,symbol=symbols[i];
   attempted++;
   try{
    const watch=await scanner(symbol);
    if(watch?.status==='unavailable')failedMarkets++;
    const reason=typeof watch?.preBreakGate==='string'?
      watch.preBreakGate:'UNKNOWN_OR_STALE';
    // Counts only; never save prices, symbols or private notification topics.
    preBreakGates[reason]=(preBreakGates[reason]||0)+1;
    if(watchFresh(watch))valid[i]={symbol,...watch};
   }catch{
    // Do not mistake an unavailable feed for a quiet market in health reports.
    failedMarkets++;
   }
  }
 }
 await Promise.all(Array.from({length:Math.min(8,symbols.length)},()=>worker()));
 if(metrics&&typeof metrics==='object'){
  metrics.checked=attempted;
  metrics.failedMarkets=failedMarkets;
  metrics.preBreakGates=preBreakGates;
 }
 return valid.filter(Boolean);
}
// A 1m PRE_BREAK scenario is the ordinary EARLY warning. Only these
// predictive scenarios reach the owner's ntfy topic: raw 1m breakouts remain
// silent, and no forecast can authorize an order. Sender dedupes 10m buckets.
export async function observeEarlyPush(){
 const metrics={},detected=await scanEarlyMarkets(undefined,undefined,metrics);
 const forecasts=detected.filter(x=>x.watchType==='PRE_BREAK'&&
  x.forecast?.mode==='PRE_BREAK_SCENARIO');
 const breakouts=detected.filter(x=>x.watchType!=='PRE_BREAK');
 let ntfy={enabled:Boolean(process.env.NTFY_TOPIC),delivered:0,failed:0,duplicates:0};
 if(forecasts.length){
  try{ntfy=await ntfySend('early',forecasts.slice(0,2))}
  catch(e){
   ntfy.failed=1;
   console.warn('WEEX_RADAR_ORDINARY_FORECAST_FAILED '+
    String(e.message||e).slice(0,70));
  }
 }
 return {
  checked:metrics.checked,failedMarkets:metrics.failedMarkets,
  preBreakGates:metrics.preBreakGates,
  earlySignals:detected.length,forecastScenarios:forecasts.length,
  earlyBreakouts:breakouts.length,
  suppressedNotifications:Math.max(0,detected.length-ntfy.delivered),
  delivered:ntfy.delivered,failed:ntfy.failed,duplicates:ntfy.duplicates,
  mode:'ORDINARY_PRE_BREAK_TO_NTFY',ntfy
 };
}
export async function sendEarlyPush(){
 const monitor={};
 const detected=await scanEarlyMarkets(undefined,undefined,monitor);
 const signals=detected.filter(x=>watchFresh(x));
 if(!signals.length)return {
  checked:monitor.checked,failedMarkets:monitor.failedMarkets,
  earlySignals:0,delivered:0,failed:0,duplicates:0,
  ntfy:{enabled:Boolean(process.env.NTFY_TOPIC),delivered:0,failed:0,duplicates:0}
 };
 // ntfy uses its own stable candle sequence IDs to suppress repeat sends.
 // A 1m watch is NOT a 5m confirmation and never opens a trade.
 let ntfy;
 try{ntfy=await ntfySend('early',signals)}
 catch(e){
  console.warn('WEEX_RADAR_NTFY_EARLY_FAILED '+String(e.message||e).slice(0,75));
  ntfy={enabled:false,delivered:0,failed:1,duplicates:0};
 }
 return {
  checked:monitor.checked,failedMarkets:monitor.failedMarkets,
  earlySignals:signals.length,
  delivered:ntfy.delivered,failed:ntfy.failed,duplicates:ntfy.duplicates,ntfy
 };
}
export const _test={watchFresh,scanEarlyMarkets};
