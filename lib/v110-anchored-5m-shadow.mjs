// PR110 research-only: anchor a possible 5m confirmation to the *published*
// PRE_BREAK trigger rather than inventing an unrelated 12x5m breakout.
// This is NOT an alternative live trade/ntfy pathway and sends no orders.
// Until independently verified, all outputs are hypothesis diagnostics.
import {_test as core} from '../api/signals.mjs';
import {marketForecastProfile} from './market-forecast-profiles.mjs';
import {validateV110MinuteContinuation} from './v110-minute-continuation.mjs';
const MIN=60_000,FIVE=5*MIN;
const GROUP_VOLUME=Object.freeze({
 MAJOR_CRYPTO:1.15,ALT_CRYPTO:1.20,MEME_CRYPTO:1.30,
 METALS:1.10,FX_DERIVED:1.05,EQUITY_DERIVED:1.20
});
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const positive=x=>finite(x)&&x>0;
const sign=direction=>direction==='LONG'?1:-1;
const rounded=(n,p=3)=>Number(n.toFixed(p));
export const ANCHORED_5M_POLICY=Object.freeze({
 version:'2026-11-12-pr110-early-trigger-anchored-shadow-v1',
 requiresRealPublishedNoticeForAnyFutureLiveUse:true,
 prototypeUsesHypotheticalNotices:true,
 maxEarlyLeadMinutes:15,
 closed5mOnly:true,oneMinuteContinuationRequired:true,
 independent5mRangeBreakNotRequired:true,
 newLiveNotifications:0,ordersSent:0,autoTrade:false
});
const reject=(reason,detail={})=>({status:'REJECT',reason,...detail,
 notTrade:true,ordersSent:0});
function validHistory(rows,period,asOf,minimum){
 if(!Array.isArray(rows)||rows.length<minimum)return false;
 for(let i=0;i<rows.length;i++){
  const c=rows[i],p=rows[i-1];
  if(!c||![c.time,c.closeTime,c.open,c.high,c.low,c.close,c.volume].every(finite)||
   c.time%period!==0||c.closeTime!==c.time+period||
   c.closeTime>asOf||!positive(c.open)||!positive(c.close)||!positive(c.low)||
   c.volume<0||c.high<Math.max(c.open,c.close,c.low)||
   c.low>Math.min(c.open,c.close)||i>0&&c.time!==p.time+period)return false;
 }
 return true;
}
export function evaluateAnchored5mConfirmation({
 symbol,scenario,five,fifteen,one,quote,asOf
}={}){
 const group=marketForecastProfile(symbol)?.group;
 if(!group||!scenario||!['LONG','SHORT'].includes(scenario.direction)||
  !Number.isSafeInteger(scenario.sentAt)||!Number.isSafeInteger(asOf)||
  ![scenario.trigger,scenario.invalidation].every(positive)||
  !(scenario.sentAt<asOf&&scenario.sentAt>=asOf-15*MIN))
  return reject('MISSING_VALID_PRIOR_EARLY');
 const side=scenario.direction,d=sign(side);
 if(d*(scenario.trigger-scenario.invalidation)<=0)
  return reject('EARLY_LEVEL_GEOMETRY');
 if(asOf%FIVE!==0||!validHistory(five,FIVE,asOf,60)||
  !validHistory(fifteen,15*MIN,asOf,60)||
  five.at(-1).closeTime!==asOf||asOf-fifteen.at(-1).closeTime>30*MIN)
  return reject('MISSING_FRESH_CLOSED_5M_15M');
 if(!positive(quote)||!Array.isArray(one))
  return reject('NO_SAME_WEEX_PRICE_OR_MINUTES');
 const last=five.at(-1),closes=five.map(c=>c.close),
  fifteenClose=fifteen.map(c=>c.close),atr5=core.atr(five),
  atr15=core.atr(fifteen);
 if(!positive(atr5)||!positive(atr15))return reject('BAD_5M_15M_ATR');
 // Never combine a 5m quote with unrelated/corrupt 15m price history.
 if(Math.abs(last.close-fifteen.at(-1).close)>
   Math.max(2.5*atr15,0.006*last.close))
  return reject('TIMEFRAME_PRICE_DIVERGENCE');
 const minute=validateV110MinuteContinuation({
  direction:side,candleCloseTime:asOf,price:last.close
 },scenario,one);
 if(!minute.ok)return reject(minute.reason);
 const ema20=core.ema(closes,20),ema50=core.ema(closes,50),
  high20=core.ema(fifteenClose,20),high50=core.ema(fifteenClose,50),
  rsi5=core.rsi(closes);
 const context=d===1?
  ema20>ema50&&high20>high50&&fifteen.at(-1).close>high20&&last.close>ema20:
  ema20<ema50&&high20<high50&&fifteen.at(-1).close<high20&&last.close<ema20;
 if(!context)return reject('FIVE_FIFTEEN_TREND_MISMATCH');
 if(!finite(rsi5)||(side==='LONG'?(rsi5<53||rsi5>75):(rsi5>47||rsi5<25)))
  return reject('FIVE_MINUTE_RSI_EXHAUSTED_OR_WEAK');
 const previous=five.slice(-21,-1),
  avgVolume=previous.reduce((sum,c)=>sum+c.volume,0)/previous.length;
 const volumeRatio=avgVolume>0?last.volume/avgVolume:0;
 if(!finite(volumeRatio)||volumeRatio<GROUP_VOLUME[group])
  return reject('WEAK_VOLUME_FOR_MARKET_GROUP',{volumeRatio:rounded(volumeRatio)});
 const breakDistance=d*(last.close-scenario.trigger);
 if(breakDistance<0.05*atr5)return reject('EARLY_TRIGGER_NOT_BROKEN_ON_5M');
 if(breakDistance>1.10*atr5)return reject('TRIGGER_ALREADY_TOO_FAR',{breakAtr:rounded(breakDistance/atr5)});
 const span=last.high-last.low,body=d*(last.close-last.open),
  opposingWick=span>0?(d===1?last.high-last.close:last.close-last.low)/span:1;
 if(span<=0||body<0.15*atr5||opposingWick>0.40)
  return reject('FIVE_MINUTE_CLOSE_REJECTED');
 if(Math.abs(quote-last.close)>0.30*atr5||
  d*(quote-scenario.trigger)<=0)
  return reject('QUOTE_MOVED_OR_LOST_EARLY_TRIGGER');
 // A 12x5m obstacle is allowed to differ from the PRE_BREAK trigger.
 // It must not lie immediately between current quote and an indicative 3ATR
 // target, but need not have been crossed already.
 const older=five.slice(-13,-1),
  opposing=d===1?Math.max(...older.map(c=>c.high)):Math.min(...older.map(c=>c.low)),
  risk=1.2*atr5,target=quote+d*3*atr5,
  ahead=d===1?quote<opposing&&opposing<target:
   target<opposing&&opposing<quote;
 if(ahead&&Math.abs(opposing-quote)/risk<1.5)
  return reject('OPPOSING_5M_LEVEL_TOO_CLOSE',{distanceRisk:rounded(Math.abs(opposing-quote)/risk)});
 return {status:'ANCHOR_CONFIRMED_RESEARCH_ONLY',reason:'PUBLISHED_EARLY_TRIGGER_WOULD_CONFIRM_ON_5M',
  symbol,direction:side,group,asOf,
  earlySentAt:scenario.sentAt,trigger:scenario.trigger,
  atr5:rounded(atr5,8),volumeRatio:rounded(volumeRatio),
  rsi5:rounded(rsi5,1),breakAtr:rounded(breakDistance/atr5),
  obstacle:opposing,noTradingPermission:true,notTrade:true,ordersSent:0};
}
