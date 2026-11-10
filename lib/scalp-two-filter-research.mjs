// Research-only 1m Bollinger Bands + relative volume scalp candidates.
// No order placement, push, account data, changed 5m scanner gates or live decisions.
// A candidate is NOT a recommended trade; historical results do not include real fills.
export const DEFAULTS=Object.freeze({
 bandPeriod:20,bandStd:2,volumePeriod:20,minVolumeRatio:1.15
});
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const positive=n=>finite(n)&&n>0;
const rounded=(v,n=3)=>Number(v.toFixed(n));
function bands(bars){
 const mean=bars.reduce((s,c)=>s+c.close,0)/bars.length;
 const variance=bars.reduce((s,c)=>s+(c.close-mean)**2,0)/bars.length;
 const deviation=Math.sqrt(variance);
 return {mid:mean,upper:mean+2*deviation,lower:mean-2*deviation};
}
function validOneMinute(c){
 return c&&Number.isSafeInteger(c.time)&&Number.isSafeInteger(c.closeTime)&&
  c.time%60_000===0&&c.closeTime===c.time+60_000&&
  [c.open,c.high,c.low,c.close,c.volume].every(finite)&&
  Math.min(c.open,c.close,c.low)>0&&c.high>=Math.max(c.open,c.close,c.low)&&
  c.low<=Math.min(c.open,c.close)&&c.volume>=0;
}
export function twoFilterCandidate(candles,now=Date.now(),config=DEFAULTS){
 const insufficient={mode:'SHADOW_BB_VOLUME_1M',direction:null,notATrade:true};
 if(!Array.isArray(candles)||!Number.isSafeInteger(now)||
  config?.bandPeriod!==20||config?.bandStd!==2||
  config?.volumePeriod!==20||!finite(config?.minVolumeRatio)||
  config.minVolumeRatio<1||config.minVolumeRatio>4||
  candles.length<21)return {...insufficient,reason:'INSUFFICIENT_OR_INVALID'};
 const last21=candles.slice(-21);
 if(last21.some((c,i)=>!validOneMinute(c)||
  (i>0&&c.time!==last21[i-1].closeTime))||
  last21.at(-1).closeTime>now-1000)return {...insufficient,reason:'INCOMPLETE_OR_GAPPED_CANDLES'};
 const last=last21.at(-1),previous=last21.at(-2);
 const before=last21.slice(0,20),after=last21.slice(1);
 const prior=bands(before),current=bands(after);
 const avgVolume=before.reduce((s,c)=>s+c.volume,0)/20;
 if(!(avgVolume>0))return {...insufficient,reason:'MISSING_VOLUME'};
 const ratio=last.volume/avgVolume;
 const long=previous.close<=prior.upper&&last.close>current.upper;
 const short=previous.close>=prior.lower&&last.close<current.lower;
 const direction=ratio>=config.minVolumeRatio?(long?'LONG':short?'SHORT':null):null;
 return {
  ...insufficient,direction,reason:direction?'BB_BREAKOUT_AND_VOLUME':
   ratio<config.minVolumeRatio?'LOW_VOLUME':'NO_BB_CROSS',
  closeTime:last.closeTime,observedClose:last.close,
  volumeRatio:rounded(ratio),bandUpper:rounded(current.upper,8),
  bandLower:rounded(current.lower,8),bandMid:rounded(current.mid,8)
 };
}
// Next 1m OPEN is a hypothetical entry; exit is a later CLOSE at fixed horizon.
// Round-trip expenses are assumed, never inferred from historical bid/ask.
// This is a sensitivity study of directional follow-through, NOT realized P&L.
export function replayTwoFilterCandles(candles,{
 minVolumeRatio=1.15,horizonMinutes=5,feeBpsEachSide=8,
 slippageBpsEachSide=3
}={}){
 if(!Array.isArray(candles)||candles.length>2000||
  !Number.isInteger(horizonMinutes)||horizonMinutes<1||horizonMinutes>30||
  !finite(feeBpsEachSide)||feeBpsEachSide<0||feeBpsEachSide>25||
  !finite(slippageBpsEachSide)||slippageBpsEachSide<0||slippageBpsEachSide>50)
  throw Error('INVALID_RESEARCH_INPUT');
 const costs=2*(feeBpsEachSide+slippageBpsEachSide);
 const rows=[];
 for(let i=20;i+horizonMinutes<candles.length;i++){
  const previous=candles.slice(i-20,i+1);
  const result=twoFilterCandidate(previous,candles[i].closeTime+1000,
   {...DEFAULTS,minVolumeRatio});
  if(!result.direction)continue;
  const future=candles.slice(i+1,i+1+horizonMinutes);
  if(future.some((c,k)=>!validOneMinute(c)||
   c.time!==(k===0?candles[i].closeTime:future[k-1].closeTime)))continue;
  const entry=future[0].open,exit=future.at(-1).close;
  const signed=(result.direction==='LONG'?1:-1)*(exit-entry)/entry*10000;
  rows.push({direction:result.direction,signalCloseTime:result.closeTime,
   grossBps:rounded(signed,2),netBps:rounded(signed-costs,2)});
 }
 const aggregate=values=>({signals:values.length,
  netPositive:values.filter(v=>v.netBps>0).length,
  averageGrossBps:values.length?rounded(values.reduce((s,x)=>s+x.grossBps,0)/values.length,2):null,
  averageNetBps:values.length?rounded(values.reduce((s,x)=>s+x.netBps,0)/values.length,2):null
 });
 return {mode:'SHADOW_BB_VOLUME_1M',tradeReady:false,changesLiveSignals:false,
  horizonMinutes,minVolumeRatio,assumedRoundTripCostsBps:costs,
  total:aggregate(rows),byDirection:{
   LONG:aggregate(rows.filter(x=>x.direction==='LONG')),
   SHORT:aggregate(rows.filter(x=>x.direction==='SHORT'))
  },notes:'Historical next-minute-open proxy; no live spread, actual fills, TP/SL, funding, execution latency or independent out-of-sample validation.'};
}
