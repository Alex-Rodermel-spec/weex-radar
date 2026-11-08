// Candle-based market-structure observations, used in SHADOW MODE only.
// All inputs must be completed 5m candles from a SINGLE exchange. No future
// candle, orderbook request, account API, order execution or extra data fetch.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=(x,n=2)=>Math.round(x*10**n)/10**n;
const SIDE=['LONG','SHORT'];

export function evaluateStructure(candles,atr,direction){
 if(!SIDE.includes(direction)||!Array.isArray(candles)||candles.length<40||
    !finite(atr)||atr<=0)return null;
 const n=candles.length;
 if(candles.some(c=>!c||![c.high,c.low,c.open,c.close,c.volume].every(finite)||
    c.low<=0||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||
    c.volume<0))return null;
 const isLong=direction==='LONG',last=candles[n-1];
 // Last 24 candles BEFORE the newly completed breakout candle: no lookahead.
 const context=candles.slice(n-25,n-1);
 const contextHigh=Math.max(...context.map(c=>c.high));
 const contextLow=Math.min(...context.map(c=>c.low));
 const widthAtr=(contextHigh-contextLow)/atr;
 let travelled=0;
 for(let i=1;i<context.length;i++)travelled+=Math.abs(context[i].close-context[i-1].close);
 const efficiency=travelled>0?
  Math.abs(context.at(-1).close-context[0].close)/travelled:0;
 const flat=widthAtr<4.5&&efficiency<0.24;
 const previous=candles.slice(n-13,n-1);
 const level=isLong?Math.max(...previous.map(c=>c.high)):Math.min(...previous.map(c=>c.low));
 const progress=isLong?last.close-level:level-last.close;
 const avgVolume=context.slice(-20).reduce((sum,c)=>sum+c.volume,0)/20;
 const volumeRatio=avgVolume>0?last.volume/avgVolume:null;
 const weakBreakout=progress>0&&progress<0.12*atr&&
   volumeRatio!==null&&volumeRatio<1.0;

 // Recent failed breakout / liquidity sweep. For every historical bar compare
 // ONLY against the 12 candles completed BEFORE that bar.
 let failedBreakAt=null,failedBreakLevel=null;
 for(let i=Math.max(12,n-6);i<n-1;i++){
  const prior=candles.slice(i-12,i);
  const barrier=isLong?Math.max(...prior.map(c=>c.high)):Math.min(...prior.map(c=>c.low));
  const c=candles[i];
  const penetrated=isLong?c.high>=barrier+0.08*atr:c.low<=barrier-0.08*atr;
  const rejected=isLong?c.close<barrier-0.02*atr:c.close>barrier+0.02*atr;
  if(penetrated&&rejected){failedBreakAt=c.closeTime??c.time??i;failedBreakLevel=barrier;}
 }

 // Optional retest evidence: prior confirmed breakout, followed by an actual
 // touch AND hold of that older level on this completed candle.
 let retestLevel=null;
 for(let i=n-2;i>=Math.max(12,n-6);i--){
  const prior=candles.slice(i-12,i);
  const barrier=isLong?Math.max(...prior.map(c=>c.high)):Math.min(...prior.map(c=>c.low));
  const c=candles[i];
  const broke=isLong?c.close>barrier+0.08*atr:c.close<barrier-0.08*atr;
  const touched=isLong?last.low<=barrier+0.15*atr:last.high>=barrier-0.15*atr;
  const held=isLong?last.close>barrier+0.10*atr:last.close<barrier-0.10*atr;
  if(broke&&touched&&held){retestLevel=barrier;break}
 }
 const reasons=[];
 if(flat)reasons.push('Узкий боковик перед пробоем');
 if(failedBreakAt!==null)reasons.push('Недавний ложный пробой этого направления');
 if(weakBreakout)reasons.push('Слабый пробой без роста объёма');
 // Lack of a retest is NOT itself a failed entry or a reason to skip.
 const warning=reasons.length>0;
 return {
  mode:'SHADOW',version:1,direction,
  decision:warning?'SKIP':'OBSERVE',
  label:warning?'⚠️ ТЕСТ: ПРОПУСТИТЬ':'🔎 ТЕСТ: БЕЗ ЗАМЕЧАНИЙ',
  warning,reasons,
  breakoutLevel:round(level,8),breakoutAtr:round(progress/atr,3),
  flat,failedBreakAt,failedBreakLevel:failedBreakLevel===null?null:round(failedBreakLevel,8),
  weakBreakout,retestConfirmed:retestLevel!==null,
  retestLevel:retestLevel===null?null:round(retestLevel,8),
  context:{widthAtr:round(widthAtr),efficiency:round(efficiency,3),
   volumeRatio:volumeRatio===null?null:round(volumeRatio,2)},
  note:'Режим наблюдения: НЕ блокирует LONG/SHORT, не подтверждает прибыльность.'
 };
}
