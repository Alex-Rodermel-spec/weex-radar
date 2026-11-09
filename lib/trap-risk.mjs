// Potential liquidity traps from completed 5m candles on ONE exchange.
// Research-only annotations. No request, account, orders, trading thresholds
// or changes to existing scanner/alert eligibility.
const LOOKBACK=12;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=(x,p=3)=>Number(x.toFixed(p));
const side=d=>d==='LONG'?1:-1;
function valid(candles,atr){
 return Array.isArray(candles)&&candles.length>=40&&candles.length<=500&&
  finite(atr)&&atr>0&&candles.every((c,i)=>c&&
   [c.open,c.high,c.low,c.close,c.volume,c.closeTime].every(finite)&&
   c.open>0&&c.close>0&&c.low>0&&c.high>=Math.max(c.open,c.close)&&
   c.low<=Math.min(c.open,c.close)&&c.volume>=0&&
   (i===0||c.closeTime>candles[i-1].closeTime));
}
function levelAt(candles,index,direction){
 const prev=candles.slice(index-LOOKBACK,index);
 return direction==='LONG'?Math.max(...prev.map(x=>x.high)):
  Math.min(...prev.map(x=>x.low));
}
function failedSweep(candles,atr,index,direction){
 const candle=candles[index],level=levelAt(candles,index,direction),sign=side(direction);
 const excess=sign*(direction==='LONG'?candle.high-level:level-candle.low);
 const range=candle.high-candle.low;
 const wick=direction==='LONG'?candle.high-Math.max(candle.open,candle.close):
  Math.min(candle.open,candle.close)-candle.low;
 const rejected=sign*(candle.close-level)<-0.02*atr;
 if(range<=0||excess<Math.max(0.04*atr,level*0.00002)||
    !rejected||wick/range<0.42)return null;
 const average=candles.slice(index-LOOKBACK,index)
  .reduce((sum,x)=>sum+x.volume,0)/LOOKBACK;
 return {kind:direction==='LONG'?'HIGH_SWEEP':'LOW_SWEEP',riskFor:direction,
  observedAt:candle.closeTime,ageBars:candles.length-1-index,
  referenceLevel:round(level,10),wickPct:round(100*wick/range,1),
  penetrationAtr:round(excess/atr,2),
  volumeRatio:average>0?round(candle.volume/average,2):null};
}
function failedBreakout(candles,atr,index,direction){
 if(index>=candles.length-1)return null;
 const level=levelAt(candles,index,direction),sign=side(direction);
 const breakBar=candles[index];
 if(sign*(breakBar.close-level)<0.12*atr)return null;
 // Require an actual NEXT completed candle to close back inside the
 // broken level. Never infer the reversal from the current live bar.
 for(let j=index+1;j<=Math.min(index+2,candles.length-1);j++){
  const bar=candles[j];
  if(sign*(bar.close-level)<-0.08*atr){
   return {kind:direction==='LONG'?'BULL_TRAP':'BEAR_TRAP',
    riskFor:direction,observedAt:bar.closeTime,
    ageBars:candles.length-1-j,referenceLevel:round(level,10),
    failedWithinBars:j-index};
  }
 }
 return null;
}
export function evaluateTrapRisk(candles,atr){
 if(!valid(candles,atr))return {mode:'SHADOW_TRAPS',available:false,recent:[],
  byDirection:{LONG:null,SHORT:null},
  note:'Нет полных закрытых свечей для проверки возможных ловушек'};
 const n=candles.length,events=[];
 for(const direction of ['LONG','SHORT']){
  for(let i=Math.max(LOOKBACK,n-5);i<n;i++){
   const sweep=failedSweep(candles,atr,i,direction);
   if(sweep)events.push(sweep);
   const failed=failedBreakout(candles,atr,i,direction);
   if(failed)events.push(failed);
  }
 }
 // Two complete 5m bars since the event is the display lifetime.
 // Dedupe repeated pattern matches that refer to the same level/time.
 const recent=events.filter(x=>x.ageBars<=2)
  .sort((a,b)=>b.observedAt-a.observedAt||
   (a.kind.endsWith('_TRAP')?-1:1))
  .filter((x,i,arr)=>i===arr.findIndex(y=>
   y.kind===x.kind&&y.riskFor===x.riskFor&&y.observedAt===x.observedAt))
  .slice(0,6);
 const byDirection={LONG:null,SHORT:null};
 for(const direction of ['LONG','SHORT']){
  byDirection[direction]=recent.find(x=>x.riskFor===direction)||null;
 }
 return {mode:'SHADOW_TRAPS',available:true,timeframe:'5m',recent,
  byDirection,note:'Возможные ловушки по закрытым свечам; только предупреждение. Не изменяет число сигналов.'};
}
