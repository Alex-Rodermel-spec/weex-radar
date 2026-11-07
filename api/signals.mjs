// WEEX RADAR — market data only, no exchange keys and no trading.
const SYMBOLS=['BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT','ALGOUSDT','1000SHIBUSDT','DOGEUSDT','XAUTUSDT','ZECUSDT','1000PEPEUSDT','HYPEUSDT'];
const DUR={'5m':300000,'15m':900000};
function numeric(x){const n=Number(x);return Number.isFinite(n)?n:NaN;}
function normalizeRows(rows,interval){
 if(!Array.isArray(rows))throw Error('Invalid candlestick response');
 const now=Date.now(),len=DUR[interval],unique=new Map();
 for(const r of rows){
  if(!Array.isArray(r)||r.length<6)continue;
  const [time,open,high,low,close,volume]=r.slice(0,6).map(numeric);
  if(![time,open,high,low,close,volume].every(Number.isFinite))continue;
  if(open<=0||high<=0||low<=0||close<=0||volume<0||high<low||high<open||high<close||low>open||low>close)continue;
  if(time>now+len||time<now-45*86400000)continue;
  const closeTime=time+len;
  if(closeTime<=now-1000)unique.set(time,{time,closeTime,open,high,low,close,volume});
 }
 const closed=[...unique.values()].sort((a,b)=>a.time-b.time);
 if(closed.length<60)throw Error('Not enough completed candles');
 if(now-closed.at(-1).closeTime>len*2+30000)throw Error('Stale market data');
 return closed;
}
function ema(values,period){
 let n=values.slice(0,period).reduce((a,b)=>a+b,0)/period;
 for(let i=period;i<values.length;i++)n=values[i]*2/(period+1)+n*(1-2/(period+1));
 return n;
}
function rsi(closes,p=14){
 let g=0,l=0;
 for(let i=1;i<=p;i++){const d=closes[i]-closes[i-1];g+=Math.max(d,0);l+=Math.max(-d,0)}
 g/=p;l/=p;
 for(let i=p+1;i<closes.length;i++){const d=closes[i]-closes[i-1];g=(g*(p-1)+Math.max(d,0))/p;l=(l*(p-1)+Math.max(-d,0))/p;}
 return l===0?(g===0?50:100):100-100/(1+g/l);
}
function atr(c,p=14){
 let a=[];
 for(let i=1;i<c.length;i++)a.push(Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close)));
 let v=a.slice(0,p).reduce((x,y)=>x+y,0)/p;
 for(let i=p;i<a.length;i++)v=(v*(p-1)+a[i])/p;
 return v;
}
function getAnalysis(five,fifteen){
 const last=five.at(-1),c5=five.map(c=>c.close),c15=fifteen.map(c=>c.close);
 const e20=ema(c5,20),e50=ema(c5,50),t20=ema(c15,20),t50=ema(c15,50);
 const r=rsi(c5),volatility=atr(five),previous=five.slice(-13,-1);
 const upper=Math.max(...previous.map(x=>x.high)),lower=Math.min(...previous.map(x=>x.low));
 const avgVolume=five.slice(-21,-1).reduce((a,c)=>a+c.volume,0)/20;
 const volumeRatio=avgVolume>0?last.volume/avgVolume:0;
 const longTrend=e20>e50&&t20>t50&&fifteen.at(-1).close>t20;
 const shortTrend=e20<e50&&t20<t50&&fifteen.at(-1).close<t20;
 const longBreak=last.close>upper&&last.close>e20&&r>=55&&r<=77;
 const shortBreak=last.close<lower&&last.close<e20&&r>=23&&r<=45;
 const tentative=longTrend&&longBreak?'LONG':shortTrend&&shortBreak?'SHORT':null;
 const expiresAt=tentative?last.closeTime+180000:null;
 const active=Boolean(tentative&&Date.now()<expiresAt);
 const direction=active?tentative:null;
 const score=direction?Math.round(Math.min(95,65+(volumeRatio>=1.3?12:0)+(volumeRatio>=1.8?6:0)+((direction==='LONG'?r>=60:r<=40)?4:0)+(Math.abs(e20-e50)/last.close>.003?5:0)+(Math.abs(t20-t50)/last.close>.004?5:0))):null;
 return {direction,level:direction?(score>=85?'STRONG':'NORMAL'):'WAIT',score,price:last.close,candleCloseTime:last.closeTime,expiresAt:active?expiresAt:null,
 stop:direction?(direction==='LONG'?last.close-1.2*volatility:last.close+1.2*volatility):null,
 take:direction?(direction==='LONG'?last.close+2.4*volatility:last.close-2.4*volatility):null,
 indicators:{rsi:Math.round(r*10)/10,volumeRatio:Math.round(volumeRatio*100)/100,trend15:t20>t50?'UP':'DOWN'},
 reason:direction?'Пробой диапазона · тренд 5м/15м · RSI '+Math.round(r):'Нет свежего подтверждённого пробоя'};
}
async function fetchJson(url){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4800);
 try{const response=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json','User-Agent':'WEEX-RADAR/1.0'}});
 if(!response.ok)throw Error('HTTP '+response.status);return await response.json();
 }finally{clearTimeout(timer)}
}
async function fetchCandles(symbol,interval,exchange){
 if(exchange==='WEEX'){
  const body=await fetchJson('https://api-contract.weex.com/capi/v3/market/klines?symbol='+symbol+'&interval='+interval+'&limit=125');
  return normalizeRows(Array.isArray(body)?body:body?.data,interval);
 }
 const body=await fetchJson('https://api.bybit.com/v5/market/kline?category=linear&symbol='+symbol+'&interval='+interval.replace('m','')+'&limit=125');
 if(body?.retCode!==0||!Array.isArray(body?.result?.list))throw Error(body?.retMsg||'Bybit invalid response');
 return normalizeRows(body.result.list,interval);
}
async function scanSymbol(symbol){
 const errors=[];
 for(const exchange of ['WEEX','Bybit']){
  try{
   const [five,fifteen]=await Promise.all([fetchCandles(symbol,'5m',exchange),fetchCandles(symbol,'15m',exchange)]);
   return {symbol,exchange,status:'ok',...getAnalysis(five,fifteen)};
  }catch(e){errors.push(exchange+': '+String(e.message||e).slice(0,85));}
 }
 return {symbol,exchange:null,status:'error',direction:null,level:'UNAVAILABLE',reason:errors.join(' / ')};
}
async function scanAll(){
 const results=[];
 for(let i=0;i<SYMBOLS.length;i+=4)results.push(...await Promise.all(SYMBOLS.slice(i,i+4).map(scanSymbol)));
 return results;
}
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{
  const symbols=await scanAll();
  res.setHeader('Cache-Control','public, s-maxage=25, stale-while-revalidate=15');
  res.setHeader('X-Content-Type-Options','nosniff');
  return res.status(200).json({generatedAt:Date.now(),interval:'5m',confirmationInterval:'15m',signalLifetimeMinutes:3,sourcePolicy:'WEEX first; Bybit if WEEX fails; never mix exchanges',notes:'Read-only indicative analysis. Not verified profitable.',symbols});
 }catch(e){return res.status(502).json({error:'Market data unavailable',detail:String(e.message||e).slice(0,140)})}
}
export const _test={SYMBOLS,normalizeRows,ema,rsi,atr,getAnalysis,scanSymbol};