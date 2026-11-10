// Read-only, non-blocking FORECAST context. All observations are derived from
// completed 5m WEEX candles supplied by the existing forecast scanner.
// Candle patterns are NOT actual resting orders, stop locations or institutions.
const FIVE=300_000;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const round=(v,n=8)=>Number(v.toFixed(n));
const valid=(c,i,arr,now)=>c&&Number.isSafeInteger(c.time)&&
 Number.isSafeInteger(c.closeTime)&&c.time+FIVE===c.closeTime&&
 c.time%FIVE===0&&c.closeTime<=now-1000&&
 [c.open,c.high,c.low,c.close,c.volume].every(finite)&&
 Math.min(c.open,c.low,c.close)>0&&
 c.high>=Math.max(c.open,c.close,c.low)&&
 c.low<=Math.min(c.open,c.close)&&c.volume>=0&&
 (i===0||c.time===arr[i-1].closeTime);

const observedHighs=(bars)=> {
 const out=[];
 // Each pivot must have a completed candle on BOTH sides by forecast time.
 for(let i=1;i<bars.length-1;i++)if(
  bars[i].high>=bars[i-1].high&&bars[i].high>bars[i+1].high)
  out.push({price:bars[i].high,closeTime:bars[i].closeTime});
 return out;
};
const observedLows=(bars)=>{
 const out=[];
 for(let i=1;i<bars.length-1;i++)if(
  bars[i].low<=bars[i-1].low&&bars[i].low<bars[i+1].low)
  out.push({price:bars[i].low,closeTime:bars[i].closeTime});
 return out;
};
// Equal swing highs/lows can be areas to WATCH, not verifiable stop orders.
function clusterNearest(pivots,reference,tolerance,side){
 const eligible=pivots.filter(p=>side==='ABOVE'?p.price>reference:p.price<reference);
 const pools=[];
 for(const p of eligible){
  const matches=eligible.filter(q=>Math.abs(q.price-p.price)<=tolerance);
  if(matches.length<2)continue;
  const level=matches.reduce((s,v)=>s+v.price,0)/matches.length;
  pools.push({level,touches:matches.length});
 }
 pools.sort((a,b)=>Math.abs(a.level-reference)-Math.abs(b.level-reference)||
  b.touches-a.touches);
 return pools.length?{level:round(pools[0].level),touches:pools[0].touches}:null;
}
function candleZone(bars,direction,atr){
 for(let i=bars.length-3;i>=Math.max(7,bars.length-25);i--){
  const source=bars[i],next=bars[i+1],prior=bars.slice(i-5,i+1);
  if(prior.length<6)continue;
  const bullish=direction==='LONG';
  if(bullish?source.close>=source.open:source.close<=source.open)continue;
  const body=Math.abs(next.close-next.open);
  if(body<0.6*atr)continue;
  const crossed=bullish?
   next.close>Math.max(...prior.map(c=>c.high))+0.04*atr:
   next.close<Math.min(...prior.map(c=>c.low))-0.04*atr;
  if(!crossed)continue;
  const lower=bullish?source.low:source.open;
  const upper=bullish?source.open:source.high;
  // A later, *already closed* candle must not have invalidated the zone.
  const broken=bars.slice(i+2).some(c=>bullish?
   c.close<source.low:c.close>source.high);
  if(broken)continue;
  return {kind:bullish?'BULLISH_CANDLE_PROXY':'BEARISH_CANDLE_PROXY',
   lower:round(lower),upper:round(upper),sourceCloseTime:source.closeTime,
   displacementConfirmedAt:next.closeTime,
   ageFiveMinuteBars:bars.length-1-i,verifiedOrders:false};
 }
 return null;
}
export function forecastContextStudy(five,{
 direction,referencePrice,atr5,structure=null,now=Date.now()
}={}){
 const unavailable={mode:'SHADOW_FORECAST_CONTEXT',available:false,
  blocksTrade:false,changesForecastEligibility:false};
 if(!Array.isArray(five)||five.length<40||five.length>500||
  !['LONG','SHORT'].includes(direction)||!finite(referencePrice)||
  referencePrice<=0||!finite(atr5)||atr5<=0||!Number.isSafeInteger(now))
  return {...unavailable,reason:'INSUFFICIENT_DATA'};
 const bars=five.slice(-40);
 if(bars.some((c,i)=>!valid(c,i,bars,now))||
   now-bars.at(-1).closeTime>11*60_000)
  return {...unavailable,reason:'GAPPED_OR_STALE_DATA'};
 const earlier=bars.slice(-24,-12),recent=bars.slice(-12);
 const high0=Math.max(...earlier.map(c=>c.high));
 const low0=Math.min(...earlier.map(c=>c.low));
 const high1=Math.max(...recent.map(c=>c.high));
 const low1=Math.min(...recent.map(c=>c.low));
 const trend=high1>high0&&low1>low0?'UP':
  high1<high0&&low1<low0?'DOWN':'MIXED';
 const alignment=trend==='MIXED'?'UNCLEAR':
  (direction==='LONG'&&trend==='UP'||direction==='SHORT'&&trend==='DOWN')?
   'ALIGNED':'OPPOSING';
 const last25=bars.slice(-25);
 const tolerance=0.12*atr5;
 return {
  mode:'SHADOW_FORECAST_CONTEXT',available:true,blocksTrade:false,
  changesForecastEligibility:false,
  structure:{trend,alignment,
   possibleTrapWarning:structure?.failedBreakAt!==null&&
    structure?.failedBreakAt!==undefined},
  liquidity:{source:'CLOSED_5M_SWING_PROXIES',
   above:clusterNearest(observedHighs(last25),referencePrice,tolerance,'ABOVE'),
   below:clusterNearest(observedLows(last25),referencePrice,tolerance,'BELOW'),
   actualStopsKnown:false,orderBookChecked:false},
  orderBlock:candleZone(bars,direction,atr5),
  limitations:'5m candle heuristics only. No live order book, actual stop orders, validated institutional order blocks or calibrated direction probability.'
 };
}
