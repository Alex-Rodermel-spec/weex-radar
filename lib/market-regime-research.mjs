// Read-only market regime context for experimental 1m WATCH (not an entry).
// Uses only completed, contiguous candles. Never reads accounts, secrets or orders.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const rounded=(n,k=2)=>Number(n.toFixed(k));
const MINUTE=60000;
function ema(prices,length){
 if(prices.length<length)return null;
 let value=prices.slice(0,length).reduce((a,b)=>a+b,0)/length;
 const alpha=2/(length+1);
 for(let i=length;i<prices.length;i++)value=prices[i]*alpha+value*(1-alpha);
 return value;
}
function rsiWilder(prices,period=14){
 if(prices.length<=period)return null;
 let up=0,down=0;
 for(let i=1;i<=period;i++){
  const d=prices[i]-prices[i-1];
  up+=Math.max(0,d);down+=Math.max(0,-d);
 }
 up/=period;down/=period;
 for(let i=period+1;i<prices.length;i++){
  const d=prices[i]-prices[i-1];
  up=(up*(period-1)+Math.max(0,d))/period;
  down=(down*(period-1)+Math.max(0,-d))/period;
 }
 if(up===0&&down===0)return 50;
 if(down===0)return 100;
 return 100-100/(1+up/down);
}
function width(bars){
 const mean=bars.reduce((s,x)=>s+x.close,0)/bars.length;
 const sd=Math.sqrt(bars.reduce((s,x)=>s+(x.close-mean)**2,0)/bars.length);
 return mean>0?4*sd/mean*10000:null;
}
const median=values=>{
 const a=[...values].sort((x,y)=>x-y);
 return a.length%2?a[Math.floor(a.length/2)]:
  (a[a.length/2-1]+a[a.length/2])/2;
};
export function researchRegime(candles,{modeledCostBps=22}={}){
 const unavailable={mode:'RESEARCH_MARKET_REGIME',available:false,
  notATrade:true,tradeReady:false,tags:[]};
 if(!Array.isArray(candles)||candles.length<65||!finite(modeledCostBps)||
  modeledCostBps<=0)return {...unavailable,reason:'INSUFFICIENT_DATA'};
 const rows=candles.slice(-80);
 if(rows.some((c,i)=>!c||!Number.isSafeInteger(c.time)||
  c.time%MINUTE!==0||c.closeTime!==c.time+MINUTE||
  [c.open,c.high,c.low,c.close,c.volume].some(x=>!finite(x))||
  c.low<=0||c.high<Math.max(c.open,c.close,c.low)||
  c.low>Math.min(c.open,c.close)||c.volume<0||
  (i>0&&c.time!==rows[i-1].closeTime)))
  return {...unavailable,reason:'INVALID_OR_GAPPED_CANDLES'};
 const prices=rows.map(c=>c.close),last=rows.at(-1);
 const fast=ema(prices,20),slow=ema(prices,50),rsi=rsiWilder(prices);
 const trueRanges=rows.slice(1).map((bar,i)=>Math.max(
  bar.high-bar.low,Math.abs(bar.high-rows[i].close),
  Math.abs(bar.low-rows[i].close)));
 const atr=trueRanges.slice(-14).reduce((sum,x)=>sum+x,0)/14;
 const atrBps=atr/last.close*10000;
 const bbWidths=[];
 for(let i=rows.length-30;i<=rows.length;i++)
  bbWidths.push(width(rows.slice(i-20,i)));
 const recentMedianWidthBps=median(bbWidths.slice(0,-1));
 const latestWidthBps=bbWidths.at(-1);
 const squeeze=recentMedianWidthBps>0&&
  latestWidthBps<=0.75*recentMedianWidthBps;
 const fiveMinuteChangeBps=(last.close/prices.at(-6)-1)*10000;
 const volumeMean=rows.slice(-21,-1).reduce((a,b)=>a+b.volume,0)/20;
 const relativeVolume=volumeMean>0?last.volume/volumeMean:0;
 const trend=fast>slow&&last.close>fast?'UP':
  fast<slow&&last.close<fast?'DOWN':'MIXED';
 const momentumWatch=Math.abs(fiveMinuteChangeBps)>=18&&relativeVolume>=0.8;
 const tags=[];
 if(squeeze)tags.push('BB_SQUEEZE');
 if(momentumWatch)tags.push('FIVE_MINUTE_MOMENTUM');
 if(atrBps<modeledCostBps)tags.push('COST_PRESSURE');
 if(rsi>70)tags.push('RSI_OVERBOUGHT');
 if(rsi<30)tags.push('RSI_OVERSOLD');
 return {
  mode:'RESEARCH_MARKET_REGIME',available:true,notATrade:true,tradeReady:false,
  trend,rsi14:rounded(rsi,1),ema20:rounded(fast,8),ema50:rounded(slow,8),
  atr14Bps:rounded(atrBps),fiveMinuteChangeBps:rounded(fiveMinuteChangeBps),
  bbWidthBps:rounded(latestWidthBps),
  recentMedianBBWidthBps:rounded(recentMedianWidthBps),
  relativeVolume:rounded(relativeVolume,3),
  costPressure:atrBps<modeledCostBps,
  squeezed:squeeze,momentumWatch,tags,
  note:'Closed 1m EMA20/50, Wilder RSI14, ATR14, BB20/2 relative width and trailing 5m momentum. Descriptive ONLY; neither cost pressure nor squeezes predict forward profitable trades.'
 };
}
