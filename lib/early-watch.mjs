// WEEX RADAR early-watch: independent read-only one-minute analysis.
// Never sends trading orders and never labels one-minute watches as confirmed signals.
import {_test as indicators} from '../api/signals.mjs';
import {preBreakCandidate,forecastPreBreak} from './forecast-watch.mjs';

const MS1=60_000,MS15=900_000;
function closed(rows,duration,now){
 if(!Array.isArray(rows))throw Error('Invalid WEEX candles');
 const unique=new Map();
 for(const v of rows){
  if(!Array.isArray(v)||v.length<6)continue;
  const [time,open,high,low,close,volume]=v.slice(0,6).map(Number);
  if(![time,open,high,low,close,volume].every(Number.isFinite)||
     open<=0||high<=0||low<=0||close<=0||volume<0||
     high<Math.max(open,close,low)||low>Math.min(open,close)||time>now+duration||
     time<now-45*86400000||time+duration>now-1000)continue;
  unique.set(time,{time,closeTime:time+duration,open,high,low,close,volume});
 }
 const candles=[...unique.values()].sort((a,b)=>a.time-b.time);
 if(candles.length<60)throw Error('Too few completed WEEX candles');
 if(now-candles.at(-1).closeTime>duration*2+30000)throw Error('Stale WEEX candle feed');
 return candles;
}
function scanEarly(one,fifteen,now=Date.now(),livePrice=null){
 const last=one.at(-1),prev=one.at(-2);
 const out={status:'ok',exchange:'WEEX',interval:'1m',contextInterval:'15m',
   level:'WAIT',direction:null,candleCloseTime:last.closeTime,expiresAt:null,
   closePrice:last.close,livePrice:Number.isFinite(livePrice)&&livePrice>0?livePrice:null,
   reason:'Нет раннего пробоя, ждём',indicators:{}};
 if(now-last.closeTime>MS1){out.reason='Сигнал минутной свечи уже устарел';return out;}
 const prices=one.map(x=>x.close),htf=fifteen.map(x=>x.close);
 const {ema,rsi,atr,breakoutQuality,currentPriceQuality}=indicators;
 const fast=ema(prices,20),slow=ema(prices,50),fast15=ema(htf,20),slow15=ema(htf,50);
 const vol=atr(one),r=rsi(prices);
 const previous=one.slice(-13,-1),upper=Math.max(...previous.map(x=>x.high)),lower=Math.min(...previous.map(x=>x.low));
 const volumeAverage=one.slice(-21,-1).reduce((sum,x)=>sum+x.volume,0)/20;
 const volumeRatio=volumeAverage>0?last.volume/volumeAverage:0;
 const priorBeforePrev=one.slice(-14,-2);
 const previousHigh=Math.max(...priorBeforePrev.map(x=>x.high));
 const previousLow=Math.min(...priorBeforePrev.map(x=>x.low));
 out.indicators={rsi:Number(r.toFixed(1)),volumeRatio:Number(volumeRatio.toFixed(2)),trend15:fast15>slow15?'UP':'DOWN'};
 const trendLong=fast>slow&&fast15>slow15&&fifteen.at(-1).close>fast15;
 const trendShort=fast<slow&&fast15<slow15&&fifteen.at(-1).close<fast15;
 const firstLongBreak=prev.close<=previousHigh&&last.close>upper;
 const firstShortBreak=prev.close>=previousLow&&last.close<lower;
 const candidate=trendLong&&firstLongBreak&&r>=52&&r<=72?'LONG':
   trendShort&&firstShortBreak&&r>=28&&r<=48?'SHORT':null;
 if(!candidate){
  // A separate PRE-break forecast can fire BEFORE any 1m breakout.
  // This is not a trade entry and never alters the existing breakout gate.
  if(preBreakCandidate(one,fifteen,now)){
   out.needsForecastContext=true;
   out.reason='Есть предварительный сценарий, проверяем 5м и свежую котировку';
  }
  return out;
 }
 if(volumeRatio<1.15){out.reason='Пробой без достаточного объёма — пропущен';return out;}
 const candle=breakoutQuality(candidate,last,upper,lower,fast,vol);
 if(!candle.ok){out.reason=candle.reason;return out;}
 if(livePrice===null){out.reason='Требуется свежая котировка WEEX';return out;}
 const priceCheck=currentPriceQuality(candidate,last.close,vol,livePrice);
 if(!priceCheck.ok){out.reason=priceCheck.reason;return out;}
 out.level='EARLY_WATCH';out.direction=candidate;
 out.expiresAt=last.closeTime+MS1;
 out.reason='Минутный пробой · объём · 15м тренд · свежая цена WEEX. Не готовый вход.';
 return out;
}
// Chart data is shown only in the user's browser. This is not a TradingView Pine plot.
function emaSeries(candles,period){
 const result=Array(candles.length).fill(null);
 if(candles.length<period)return result;
 let value=candles.slice(0,period).reduce((sum,c)=>sum+c.close,0)/period;
 result[period-1]=value;
 for(let i=period;i<candles.length;i++){
  value=candles[i].close*(2/(period+1))+value*(1-2/(period+1));
  result[i]=value;
 }
 return result;
}
function chartCandles(one){
 const ema20=emaSeries(one,20),ema50=emaSeries(one,50);
 const offset=Math.max(0,one.length-75);
 return one.slice(offset).map((c,i)=>({
  time:c.closeTime,open:c.open,high:c.high,low:c.low,close:c.close,
  ema20:ema20[offset+i],ema50:ema50[offset+i]
 }));
}
async function fetchCandles(symbol,interval){
 const url='https://api-contract.weex.com/capi/v3/market/klines?symbol='+
   encodeURIComponent(symbol)+'&interval='+interval+'&limit=125';
 const response=await fetch(url,{signal:AbortSignal.timeout(7000),
   cache:'no-store',headers:{Accept:'application/json','User-Agent':'WEEX-RADAR/1.0'}});
 if(!response.ok)throw Error('WEEX candle API '+response.status);
 const data=await response.json();
 if(!Array.isArray(data))throw Error('Unexpected WEEX candle format');
 return data;
}
export async function scanEarlySymbol(symbol,includeChart=false){
 if(!indicators.SYMBOLS.includes(symbol))throw Error('Unsupported WEEX symbol');
 const now=Date.now();
 const [oneRows,fifteenRows]=await Promise.all([
  fetchCandles(symbol,'1m'),fetchCandles(symbol,'15m')]);
 const one=closed(oneRows,MS1,now),fifteen=closed(fifteenRows,MS15,now);
 const candidate=scanEarly(one,fifteen,now);
 const display=watch=>includeChart?{...watch,chart:chartCandles(one)}:watch;
 if(candidate.needsForecastContext){
  // Request the 5m timeframe ONLY for promising PRE-break candidates.
  // Do not add a third 5m fetch to every market on every minute.
  try{
   const [fiveRows,quote]=await Promise.all([
    fetchCandles(symbol,'5m'),indicators.fetchCurrentQuote(symbol,'WEEX')
   ]);
   const five=closed(fiveRows,300000,Date.now());
   const prediction=forecastPreBreak(one,five,fifteen,quote.price,Date.now());
   if(prediction)return display({
    ...candidate,needsForecastContext:undefined,
    level:'EARLY_WATCH',watchType:'PRE_BREAK',direction:prediction.direction,
    expiresAt:one.at(-1).closeTime+MS1,
    livePrice:quote.price,forecast:prediction,
    reason:'ПРОГНОЗ ДО ПРОБОЯ · 1м/5м/15м · НЕ ВХОДИТЬ без подтверждения'
   });
  }catch{ /* Lack of fresh 5m data/quote cancels forecast, never invents it. */ }
  return display({...candidate,needsForecastContext:undefined,
   reason:'Предварительный сценарий не подтверждён свежими данными 5м/WEEX'});
 }
 if(candidate.reason!=='Требуется свежая котировка WEEX')return display(candidate);
 let livePrice=null;
 try{const quote=await indicators.fetchCurrentQuote(symbol,'WEEX');livePrice=quote.price;}
 catch{ /* Fail closed: never emit a watch without a fresh WEEX quote. */ }
 return display(scanEarly(one,fifteen,Date.now(),livePrice));
}
export async function handleEarlyWatch(req,res){
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const symbol=typeof req.query?.symbol==='string'?req.query.symbol:
  new URL(req.url,'https://weex-radar.vercel.app').searchParams.get('symbol');
 if(!indicators.SYMBOLS.includes(symbol))
  return res.status(400).json({error:'Unsupported WEEX futures symbol'});
 try{
  const watch=await scanEarlySymbol(symbol,req.query?.chart==='1');
  return res.status(200).json({symbol,generatedAt:Date.now(),...watch});
 }catch(e){
  return res.status(503).json({symbol,status:'unavailable',level:'UNAVAILABLE',
   direction:null,reason:'Не удалось проверить минутные свечи WEEX'});
 }
}
export const _test={closed,scanEarly,emaSeries,chartCandles};
