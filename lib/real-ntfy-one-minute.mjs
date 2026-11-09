// RESEARCH ONLY. Confirmed ntfy alerts vs CLOSED WEEX 1m candles AFTER arrival.
// A candle touching a hypothetical limit level is NOT a fill, maker fee,
// TP/SL order, realized P&L, or permission to trade. No private account API.
import {requiredPassiveImprovement} from './entry-economics.mjs';

const MINUTE=60_000,MIN_BETTER_BPS=2,MAX_BETTER_BPS=60,HORIZON=60*MINUTE;
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const berlinClock=new Intl.DateTimeFormat('en-GB',{
 timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
});

export function alertExpiryFromText(message,sentAt){
 if(typeof message!=='string'||!Number.isSafeInteger(sentAt)||sentAt<=0)return null;
 const match=message.match(/⏰ До\s+(\d{2}):(\d{2})(?::(\d{2}))?/u);
 if(!match)return null;
 const hh=Number(match[1]),mm=Number(match[2]),ss=Number(match[3]??0);
 if(hh>23||mm>59||ss>59)return null;
 const clock=match[1]+':'+match[2]+':'+String(ss).padStart(2,'0');
 // Match the actual Berlin clock across midnight/DST; never interpret
 // local HH:mm as UTC or use an arbitrary 3 minutes after delivery.
 const minuteStart=Math.floor(sentAt/MINUTE)*MINUTE;
 for(let offset=0;offset<=4;offset++){
  const t=minuteStart+offset*MINUTE+ss*1000;
  if(t>sentAt&&t-sentAt<=180_000&&berlinClock.format(t)===clock)return t;
 }
 return null;
}

function validateAlert(a){
 return a&&['LONG','SHORT'].includes(a.direction)&&
 [a.entry,a.stop,a.take].every(positive)&&
 (a.direction==='LONG'?a.stop<a.entry&&a.entry<a.take:
  a.take<a.entry&&a.entry<a.stop)&&
 Number.isSafeInteger(a.sentAt)&&a.sentAt>0;
}
function isClosedBar(c,now){
 return c&&[c.time,c.closeTime,c.open,c.high,c.low,c.close].every(Number.isFinite)&&
 Number.isSafeInteger(c.time)&&c.closeTime===c.time+MINUTE&&
 c.time%MINUTE===0&&c.time>0&&c.closeTime<=now-1000&&
 c.low>0&&c.high>=Math.max(c.open,c.close)&&
 c.low<=Math.min(c.open,c.close);
}
function evaluateAfterTouch(a,barMap,from,now){
 const ending=a.sentAt+HORIZON;
 let studied=0;
 for(let time=from;time+MINUTE<=ending;time+=MINUTE){
  const c=barMap.get(time);
  if(!c||!isClosedBar(c,now))
   return now<time+MINUTE+1000?{status:'PENDING',minute:null}:
    {status:'NO_DATA',minute:null};
  studied++;
  const tp=a.direction==='LONG'?c.high>=a.take:c.low<=a.take;
  const sl=a.direction==='LONG'?c.low<=a.stop:c.high>=a.stop;
  if(tp&&sl)return {status:'AMBIGUOUS',minute:c.closeTime};
  if(tp)return {status:'TP_TOUCHED',minute:c.closeTime};
  if(sl)return {status:'SL_TOUCHED',minute:c.closeTime};
 }
 return now<ending+1000?{status:'PENDING',minute:null}:
  studied>0?{status:'NEITHER_TOUCHED',minute:null}:
  {status:'INSUFFICIENT_AFTER_TOUCH',minute:null};
}

export function studyRealAlertOneMinute(a,candles,now=Date.now()){
 const result=(status,more={})=>({
  mode:'CLOSED_1M_SHADOW',status,limit:null,requiredBps:null,
  postTouchStatus:null,postTouchAt:null,tradeReady:false,filled:false,...more
 });
 if(!validateAlert(a)||!Number.isSafeInteger(now))return result('BAD_ALERT');
 if(!Number.isSafeInteger(a.expiresAt)||a.expiresAt<=a.sentAt||
    a.expiresAt-a.sentAt>180_000)return result('UNKNOWN_DEADLINE');
 if(!Array.isArray(candles))return result('NO_DATA');
 const better=requiredPassiveImprovement(a);
 if(!better)return result('NO_VIABLE_PRICE');
 const requiredBps=Math.max(MIN_BETTER_BPS,better.bps);
 if(requiredBps>MAX_BETTER_BPS)return result('NO_VIABLE_PRICE');
 const side=a.direction==='LONG'?1:-1;
 const limit=a.entry*(1-side*requiredBps/10000);
 if(!(side===1?a.stop<limit&&limit<a.take:a.take<limit&&limit<a.stop))
  return result('INVALID_LEVEL');
 const props={limit:Number(limit.toPrecision(11)),requiredBps};
 const start=Math.ceil(a.sentAt/MINUTE)*MINUTE;
 // Ignore any candle already in progress when notification was delivered.
 // Expiry must come from the ORIGINAL ntfy timestamp, not scan time.
 const eligible=[];
 for(let t=start;t+MINUTE<=a.expiresAt;t+=MINUTE)eligible.push(t);
 if(!eligible.length)return result('INSUFFICIENT_1M_RESOLUTION',props);
 const map=new Map();
 for(const bar of candles){
  if(!bar||!Number.isSafeInteger(bar.time))continue;
  if(map.has(bar.time))return result('NO_DATA',props);
  map.set(bar.time,bar);
 }
 for(const time of eligible){
  const c=map.get(time);
  if(!c||!isClosedBar(c,now))
   return result(now<time+MINUTE+1000?'PENDING':'NO_DATA',props);
  // A level already marketable at minute OPEN cannot establish a
  // passive maker order; don't award a cheap maker fee.
  if(side===1?c.open<=limit:c.open>=limit)
   return result('GAP_OR_MARKETABLE',{...props,minute:c.closeTime});
  const touched=side===1?c.low<=limit:c.high>=limit;
  const atTake=side===1?c.high>=a.take:c.low<=a.take;
  const atStop=side===1?c.low<=a.stop:c.high>=a.stop;
  if(touched&&(atTake||atStop))
   return result('AMBIGUOUS_1M',{...props,minute:c.closeTime});
  // If take/stop was already reached before the desired entry, that
  // setup cannot be evaluated as the same original signal.
  if(atTake||atStop)
   return result('INVALIDATED_BEFORE_TOUCH',{...props,minute:c.closeTime});
  if(touched){
   const after=evaluateAfterTouch(a,map,c.closeTime,now);
   return result('TOUCH_POSSIBLE',{...props,minute:c.closeTime,
    postTouchStatus:after.status,postTouchAt:after.minute});
  }
 }
 return result('NO_TOUCH',props);
}

const STATUS=['TOUCH_POSSIBLE','NO_TOUCH','PENDING','NO_DATA',
 'NO_VIABLE_PRICE','UNKNOWN_DEADLINE','BAD_ALERT','INVALID_LEVEL',
 'INSUFFICIENT_1M_RESOLUTION','GAP_OR_MARKETABLE','AMBIGUOUS_1M',
 'INVALIDATED_BEFORE_TOUCH'];
export function summarizeRealOneMinute(rows){
 if(!Array.isArray(rows))throw Error('Bad confirmed alerts');
 const counts=Object.fromEntries(STATUS.map(x=>[x,0]));
 const postTouch={TP_TOUCHED:0,SL_TOUCHED:0,AMBIGUOUS:0,
  PENDING:0,NO_DATA:0,NEITHER_TOUCHED:0,INSUFFICIENT_AFTER_TOUCH:0};
 for(const row of rows){
  const s=row?.oneMinuteResearch?.status;
  counts[s in counts?s:'BAD_ALERT']++;
  if(s==='TOUCH_POSSIBLE'){
   const x=row.oneMinuteResearch.postTouchStatus;
   postTouch[x in postTouch?x:'NO_DATA']++;
  }
 }
 return {
  total:rows.length,counts,postTouch,
  entryTime:'Only FULL 1m candles starting after the ntfy arrival',
  deadline:'Exact ⏰ До HH:mm:ss in original ntfy, Europe/Berlin, at most 3m after arrival',
  requiredImprovement:'At least 2 bps better than alert price; or more, to reach optimistic maker-only modeled R/R >=1.5. Maximum 60 bps.',
  execution:'OHLC touches may occur with no queue fill. The full minute of touch is excluded from subsequent TP/SL scoring.',
  safety:'Read-only, no limit orders, no real trades or auto execution, no personalized fees. Maker-only economics assume zero spread.'
 };
}
