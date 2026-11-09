// Read-only price-level explanation for the manual WEEX RADAR advisor.
// All inputs are completed 5m OHLCV from ONE exchange. Previous 12 candles
// define levels; never use a signal candle's own high/low as its threshold.
// This is neither a calibrated prediction nor proof of a profitable breakout.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const round=(n,p=8)=>Number(n.toFixed(p));
const LOOKBACK=12;
export const LEVEL_MODE='CLOSED_5M_OBSERVATION';

function thresholds(candles,index){
 if(index<LOOKBACK)return null;
 const prior=candles.slice(index-LOOKBACK,index);
 return {
  resistance:Math.max(...prior.map(x=>x.high)),
  support:Math.min(...prior.map(x=>x.low)),
  avgVolume:prior.reduce((n,x)=>n+x.volume,0)/prior.length
 };
}

function rejection(candle,prior,atr){
 const upper=candle.high>prior.resistance+0.08*atr&&
  candle.close<prior.resistance-0.02*atr;
 const lower=candle.low<prior.support-0.08*atr&&
  candle.close>prior.support+0.02*atr;
 if(upper&&lower)return 'BOTH';
 return upper?'LONG':lower?'SHORT':null;
}

export function evaluateLevelReview(candles,atr){
 if(!Array.isArray(candles)||candles.length<LOOKBACK+5||candles.length>1000||
   !finite(atr)||atr<=0)return null;
 for(let i=0;i<candles.length;i++){
  const c=candles[i],p=candles[i-1];
  if(!c||![c.time,c.closeTime,c.open,c.high,c.low,c.close,c.volume].every(finite)||
   c.open<=0||c.low<=0||c.close<=0||c.high<Math.max(c.open,c.close)||
   c.low>Math.min(c.open,c.close)||c.volume<0||
   c.closeTime<=c.time||(p&&c.time<=p.time))return null;
 }
 const n=candles.length,last=candles.at(-1),prev=thresholds(candles,n-1);
 const ratio=prev.avgVolume>0?last.volume/prev.avgVolume:null;
 const above=last.close>prev.resistance,below=last.close<prev.support;
 const fakeout=rejection(last,prev,atr);
 const body=Math.abs(last.close-last.open),range=last.high-last.low;
 const candleState=above?'BREAK_UP':below?'BREAK_DOWN':
  fakeout==='LONG'?'FAKE_UP':fakeout==='SHORT'?'FAKE_DOWN':
  fakeout==='BOTH'?'TWO_SIDED_SWEEP':'INSIDE_RANGE';
 const side=above?'LONG':below?'SHORT':null;
 const opposingWick=side===null?null:side==='LONG'?
  (last.high-last.close)/Math.max(range,1e-12):
  (last.close-last.low)/Math.max(range,1e-12);
 const strongClose=side!==null&&ratio!==null&&ratio>=1.10&&
  body>=0.15*atr&&opposingWick<=0.40&&
  (side==='LONG'?last.close-prev.resistance:prev.support-last.close)>=0.08*atr;
 // Scan only the 3 previously completed candles. Each level is derived from
 // candles strictly BEFORE that historical bar (no look-ahead).
 const recentFakeouts={LONG:null,SHORT:null};
 for(let i=n-2;i>=Math.max(LOOKBACK,n-4);i--){
  const levels=thresholds(candles,i);
  const kind=rejection(candles[i],levels,atr);
  if(kind==='LONG'||kind==='BOTH')recentFakeouts.LONG??={
   barsAgo:n-1-i,level:round(levels.resistance)
  };
  if(kind==='SHORT'||kind==='BOTH')recentFakeouts.SHORT??={
   barsAgo:n-1-i,level:round(levels.support)
  };
 }
 return {
  mode:LEVEL_MODE,lookback:LOOKBACK,interval:'5m',
  candleCloseTime:last.closeTime,
  support:round(prev.support),resistance:round(prev.resistance),
  close:round(last.close),candleState,
  breakoutDirection:side,
  closeQuality:side?(strongClose?'SUPPORTED':'WEAK'):'NONE',
  volumeRatio:ratio===null?null:round(ratio,2),
  recentFakeouts,
  note:'12 previous completed 5m candles; false-break warnings are observations, not a prediction or trade signal'
 };
}
