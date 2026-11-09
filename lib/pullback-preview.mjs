// Read-only "buy a dip / sell a bounce" candidate from completed WEEX 1m candles.
// NEVER submit this candidate as an order: live limit execution still needs
// cancellation, fill/partial-fill reconciliation, and verified TP/SL protection.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const MINUTE=60_000;

function roundLimit(price,precision,side) {
 if(!Number.isInteger(precision)||precision<0||precision>12)return null;
 const unit=10**precision;
 const n=side==='LONG'?Math.floor(price*unit+1e-9):Math.ceil(price*unit-1e-9);
 const result=Number((n/unit).toFixed(precision));
 return finite(result)&&result>0?result:null;
}

export function planPullbackPreview({
 signal,quote,candles,pricePrecision,now=Date.now()
}={}){
 if(signal?.status!=='ok'||signal.exchange!=='WEEX'||
   !['LONG','SHORT'].includes(signal.direction)||
   !finite(signal.expiresAt)||signal.expiresAt<=now+30_000||
   !finite(signal.candleCloseTime)||signal.candleCloseTime>now||
   now-signal.candleCloseTime>180_000||
   !finite(signal.stop)||!finite(signal.take)||signal.stop<=0||signal.take<=0||
   !Array.isArray(candles)||candles.length<3)return null;
 const bid=Number(quote?.bidPrice),ask=Number(quote?.askPrice),quoteTime=Number(quote?.time);
 if(![bid,ask,quoteTime].every(finite)||bid<=0||ask<bid||
   quoteTime>now+5000||now-quoteTime>30_000||
   (ask-bid)/((bid+ask)/2)>0.004)return null;
 const recent=candles.slice(-3);
 for(let i=0;i<recent.length;i++){
  const c=recent[i],prev=recent[i-1];
  if(!c||![c.time,c.closeTime,c.open,c.high,c.low,c.close,c.volume].every(finite)||
    c.low<=0||c.open<=0||c.close<=0||c.high<Math.max(c.open,c.close)||
    c.low>Math.min(c.open,c.close)||c.volume<0||
    c.closeTime!==c.time+MINUTE||c.closeTime>now-1000||
    (prev&&c.time!==prev.time+MINUTE))return null;
 }
 if(now-recent.at(-1).closeTime>MINUTE+5000)return null;
 const isLong=signal.direction==='LONG';
 const raw=isLong?Math.min(...recent.map(c=>c.low)):Math.max(...recent.map(c=>c.high));
 const limitPrice=roundLimit(raw,pricePrecision,signal.direction);
 if(limitPrice===null)return null;
 // Must be a genuine pullback away from the current crossing-side quote.
 // Never chase an already-breached level, cross the spread, or place an
 // aggressive marketable LIMIT order.
 const current=isLong?ask:bid;
 const gap=(isLong?current-limitPrice:limitPrice-current)/current;
 if(!(gap>=0.0002&&gap<=0.006))return null;
 if(isLong?!(limitPrice<bid&&signal.stop<limitPrice&&limitPrice<signal.take):
  !(limitPrice>ask&&signal.take<limitPrice&&limitPrice<signal.stop))return null;
 // Do not propose a 1m dip after a later 1m candle closed beyond the
 // planned stop; such scenarios are stale/invalid.
 if(recent.some(c=>isLong?c.close<=signal.stop:c.close>=signal.stop))return null;
 const expiresAt=Math.min(signal.expiresAt,now+90_000);
 return {
  status:'PREVIEW_ONLY',canPlaceOrder:false,mode:'CLOSED_1M_PULLBACK',
  symbol:signal.symbol,exchange:'WEEX',direction:signal.direction,
  limitPrice,marketEntryEstimate:current,stopLoss:signal.stop,
  takeProfit:signal.take,referenceCandleCloseTime:recent.at(-1).closeTime,
  signalCandleCloseTime:signal.candleCloseTime,
  gapPercent:Number((gap*100).toFixed(3)),expiresAt,
  note:'Candidate only, from lows/highs of last three completed 1m candles. No live LIMIT orders or automatic fills. TP/SL protection and net-cost validation must be implemented and tested separately.'
 };
}
