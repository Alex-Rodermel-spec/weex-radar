// WEEX RADAR — market data only, no exchange keys and no trading.
import {checkConfirmedEntry} from '../lib/entry-quality.mjs';
import {ACTIVE_STRATEGY} from '../lib/strategy-profile.mjs';
import {assessNetCosts} from '../lib/net-costs.mjs';
import {adviseSymbol,summarizeAdvisor} from '../lib/advisor.mjs';
import {evaluateStructure} from '../lib/market-structure.mjs';
import {evaluateLevelReview} from '../lib/level-review.mjs';
import {checkSidewaysEntry} from '../lib/sideways-gate.mjs';
import {evaluateRetestBoth} from '../lib/retest-check.mjs';
import {shadowIndicators} from '../lib/shadow-indicators.mjs';
import {evaluateTrapRisk} from '../lib/trap-risk.mjs';
import {classifyFilterStage} from '../lib/filter-diagnostics.mjs';
const ORIGINAL_SYMBOLS=['BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT','ALGOUSDT','1000SHIBUSDT','DOGEUSDT','XAUTUSDT','ZECUSDT','1000PEPEUSDT','HYPEUSDT','BNBUSDT','ADAUSDT','LINKUSDT','SUIUSDT','AVAXUSDT'];
const FORECAST_EXTRA_SYMBOLS=['TRXUSDT','XAUUSDT','XAGUSDT','AUDUSDT','CADUSDT','JPYUSDT','GBPUSDT','CHFUSDT','EURUSDT','GOOGLUSDT','MRNAUSDT','NVDAUSDT','AMDUSDT','MSFTUSDT','CSCOUSDT','KOUSDT'];
// All 32 markets receive identical READ-ONLY 1m early, 5m/15m confirmed
// and 1m/5m/10m forecast analysis. A missing WEEX quote/candle fails closed.
const FORECAST_SYMBOLS=[...ORIGINAL_SYMBOLS,...FORECAST_EXTRA_SYMBOLS];
const SYMBOLS=FORECAST_SYMBOLS;
// Critical: broadening market coverage must NEVER silently broaden access to
// real order endpoints. Only the old 16 remain eligible for manual trading.
const TRADE_SYMBOLS=ORIGINAL_SYMBOLS;
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
// Heuristic anti-chase filters: only suppress poor entries; no guarantee of profit.
function breakoutQuality(direction,last,upper,lower,ema20,atrValue){
 if(!['LONG','SHORT'].includes(direction)||!Number.isFinite(atrValue)||atrValue<=0)
  return {ok:false,reason:'Нет данных для проверки качества пробоя'};
 const range=last.high-last.low;
 if(!Number.isFinite(range)||range<=0)return {ok:false,reason:'Некорректный диапазон пробойной свечи'};
 // Reject a candle with a large wick against the trade, an exhausted breakout
 // or a price far from the 5-minute EMA. Symmetric for SHORT and LONG.
 const rejectionWick=direction==='LONG'?(last.high-last.close)/range:(last.close-last.low)/range;
 const extension=direction==='LONG'?last.close-upper:lower-last.close;
 if(rejectionWick>0.35||range>2.6*atrValue||extension>0.85*atrValue||
    Math.abs(last.close-ema20)>2.6*atrValue)
  return {ok:false,reason:'Резкий пробой или откат от вершины — сигнал пропущен'};
 return {ok:true,reason:null};
}
function currentPriceQuality(direction,close,atrValue,livePrice){
 if(!['LONG','SHORT'].includes(direction)||![close,atrValue,livePrice].every(Number.isFinite)||
    close<=0||livePrice<=0||atrValue<=0)
  return {ok:false,reason:'Нет подтверждения свежей цены — сигнал пропущен'};
 // Tolerances adapt to volatility and spread, with a tiny percentage floor.
 const reverseTolerance=Math.max(0.28*atrValue,close*0.0005);
 const chaseTolerance=Math.max(0.65*atrValue,close*0.0012);
 const progress=direction==='LONG'?livePrice-close:close-livePrice;
 if(progress< -reverseTolerance)return {ok:false,reason:'Цена уже развернулась против входа — сигнал пропущен'};
 if(progress>chaseTolerance)return {ok:false,reason:'Цена ушла слишком далеко — вход запоздал'};
 return {ok:true,reason:null};
}
// Pure, display-only history of the CLOSED breakout candle. Neither a
// prediction nor an additional entry gate; never influences LONG/SHORT.
export function closedFiveMinuteMoveBps(direction,open,close){
 if(!['LONG','SHORT'].includes(direction)||!Number.isFinite(open)||
  !Number.isFinite(close)||open<=0||close<=0)return null;
 const bps=Math.round((direction==='LONG'?1:-1)*(close-open)/open*100_000)/10;
 return bps===0?0:bps;
}

function getAnalysis(five,fifteen,livePrice=null,referenceNow=Date.now()){
 const last=five.at(-1),c5=five.map(c=>c.close),c15=fifteen.map(c=>c.close);
 // ADX and rolling VWAP are observations only; never alter selection/score/entry.
 const contextOnly=shadowIndicators(five);
 const e20=ema(c5,20),e50=ema(c5,50),t20=ema(c15,20),t50=ema(c15,50);
 const r=rsi(c5),volatility=atr(five),previous=five.slice(-13,-1);
 // Potential stop sweeps / failed breaks are contextual warnings only.
 const trapReview=evaluateTrapRisk(five,volatility);
 // Advisor-only 5m level explanation; never changes the existing signal gates.
 const levelReview=evaluateLevelReview(five,volatility);
 // Retest observations use already completed SAME-EXCHANGE 5m candles only.
 // They do not qualify an entry or cancel a fresh breakout notification.
 const aligned15=t20>t50&&fifteen.at(-1).close>t20?'LONG':
   t20<t50&&fifteen.at(-1).close<t20?'SHORT':null;
 const retest=evaluateRetestBoth(five,volatility,aligned15);
 const upper=Math.max(...previous.map(x=>x.high)),lower=Math.min(...previous.map(x=>x.low));
 const avgVolume=five.slice(-21,-1).reduce((a,c)=>a+c.volume,0)/20;
 const volumeRatio=avgVolume>0?last.volume/avgVolume:0;
 const longTrend=e20>e50&&t20>t50&&fifteen.at(-1).close>t20;
 const shortTrend=e20<e50&&t20<t50&&fifteen.at(-1).close<t20;
 const longBreak=last.close>upper&&last.close>e20&&r>=55&&r<=77;
 const shortBreak=last.close<lower&&last.close<e20&&r>=23&&r<=45;
 const candidate=longTrend&&longBreak?'LONG':shortTrend&&shortBreak?'SHORT':null;
 // Parallel observation ONLY: don't change existing alerts or entry filters.
 const shadowFilter=candidate?evaluateStructure(five,volatility,candidate):null;
 // Conservative flat-market suppression applies only to weak, low-volume 5m
 // breakouts. The rest of the shadow warnings do NOT block notifications.
 const sidewaysGate=candidate?checkSidewaysEntry(shadowFilter):null;
 const quality=candidate?breakoutQuality(candidate,last,upper,lower,e20,volatility):null;
 const priceQuality=candidate&&quality.ok?currentPriceQuality(candidate,last.close,volatility,livePrice):null;
 // Confirmed entries must still offer >=1.5R at the fresh quote and >=1R
 // room before an older same-exchange swing high/low. 1m watches are unchanged.
 const entryQuality=candidate&&quality.ok&&priceQuality.ok?
   checkConfirmedEntry(candidate,last.close,livePrice,volatility,five):null;
 const tentative=candidate&&quality.ok&&priceQuality.ok&&entryQuality?.ok&&
  !sidewaysGate?.blocked?candidate:null;
 const expiresAt=tentative?last.closeTime+180000:null;
 const active=Boolean(tentative&&referenceNow<expiresAt);
 const direction=active?tentative:null;
 // Diagnostic-only. Reads existing gate results; never affects direction or expiry.
 const filterDiagnostic={stage:classifyFilterStage({
  candidate,hasAlignedTrend:longTrend||shortTrend,quality,
  priceQuality,entryQuality,sidewaysGate,active
 })};
 const score=direction?Math.round(Math.min(95,65+(volumeRatio>=1.3?12:0)+(volumeRatio>=1.8?6:0)+((direction==='LONG'?r>=60:r<=40)?4:0)+(Math.abs(e20-e50)/last.close>.003?5:0)+(Math.abs(t20-t50)/last.close>.004?5:0))):null;
 return {direction,filterDiagnostic,level:direction?(score>=85?'STRONG':'NORMAL'):'WAIT',score,price:last.close,candleCloseTime:last.closeTime,expiresAt:active?expiresAt:null,
 closedFiveMinuteMoveBps:direction?closedFiveMinuteMoveBps(direction,last.open,last.close):null,
 stop:direction?(direction==='LONG'?last.close-ACTIVE_STRATEGY.stopAtr*volatility:last.close+ACTIVE_STRATEGY.stopAtr*volatility):null,
 take:direction?(direction==='LONG'?last.close+ACTIVE_STRATEGY.takeAtr*volatility:last.close-ACTIVE_STRATEGY.takeAtr*volatility):null,
 entryQuality,shadowFilter,sidewaysGate,retest,levelReview,shadowIndicators:contextOnly,trapReview,indicators:{rsi:Math.round(r*10)/10,volumeRatio:Math.round(volumeRatio*100)/100,trend15:t20>t50?'UP':'DOWN',atr:volatility},
 livePrice:Number.isFinite(livePrice)&&livePrice>0?livePrice:null,
 reason:direction?'Свежая котировка API · пробой 5м · тренд 15м · RSI '+Math.round(r):
 (quality&&!quality.ok?quality.reason:priceQuality&&!priceQuality.ok?priceQuality.reason:entryQuality&&!entryQuality.ok?entryQuality.reason:sidewaysGate?.blocked?sidewaysGate.reason:'Нет свежего подтверждённого пробоя')};
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
// Use the matching futures exchange's own bid/ask, never mix WEEX and Bybit.
async function fetchCurrentQuote(symbol,exchange,fetchImpl=fetch,now=Date.now()){
 if(!SYMBOLS.includes(symbol)||!['WEEX','Bybit'].includes(exchange))throw Error('Unsupported quote');
 const url=exchange==='WEEX'
  ?'https://api-contract.weex.com/capi/v3/market/ticker/bookTicker?symbol='+symbol
  :'https://api.bybit.com/v5/market/tickers?category=linear&symbol='+symbol;
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),3500);
 let data;
 try{
  const r=await fetchImpl(url,{signal:controller.signal,cache:'no-store',headers:{Accept:'application/json'}});
  if(!r.ok)throw Error('Quote HTTP '+r.status);
  data=await r.json();
 }finally{clearTimeout(timeout)}
 if(exchange==='Bybit'&&(data?.retCode!==0||!Array.isArray(data?.result?.list)))
  throw Error('Bybit quote invalid');
 const row=exchange==='WEEX'
  ?(Array.isArray(data)?data:[data]).find(x=>x?.symbol===symbol)
  :data.result.list.find(x=>x?.symbol===symbol);
 const bid=Number(exchange==='Bybit'?row?.bid1Price:row?.bidPrice),
       ask=Number(exchange==='Bybit'?row?.ask1Price:row?.askPrice);
 const timestamp=exchange==='WEEX'?Number(row?.time):Number(data?.time);
 if(!Number.isFinite(timestamp)||timestamp>now+5000||now-timestamp>30000)
  throw Error('Quote is stale');
 if(!Number.isFinite(bid)||!Number.isFinite(ask)||bid<=0||ask<=0||
    ask<bid||(ask-bid)/((ask+bid)/2)>0.004)
  throw Error('Invalid or wide-spread quote');
 return {price:(bid+ask)/2,bid,ask,time:timestamp};
}
async function scanSymbol(symbol){
 const errors=[];
 for(const exchange of ['WEEX','Bybit']){
  try{
   const [five,fifteen]=await Promise.all([fetchCandles(symbol,'5m',exchange),fetchCandles(symbol,'15m',exchange)]);
   // First check candles; request extra API data only for a plausible breakout.
   const tentative=getAnalysis(five,fifteen,five.at(-1).close);
   if(!tentative.direction)return {symbol,exchange,status:'ok',...tentative};
   try{
    const quote=await fetchCurrentQuote(symbol,exchange);
    const final=getAnalysis(five,fifteen,quote.price);
    // Read-only warning only. The user's confirmed LONG/SHORT decision and
    // delivery timing must never depend on the uncertain cost estimate.
    const costReview=final.direction?assessNetCosts({
      exchange,direction:final.direction,entryMid:quote.price,
      stop:final.stop,take:final.take,bid:quote.bid,ask:quote.ask
    }):null;
    return {symbol,exchange,status:'ok',...final,costReview};
   }catch(e){
    return {symbol,exchange,status:'ok',...getAnalysis(five,fifteen,null),
      filterDiagnostic:{stage:'quote_unavailable'},
      reason:'Текущая котировка недоступна — вход не подтверждён'};
   }
  }catch(e){errors.push(exchange+': '+String(e.message||e).slice(0,85));}
 }
 return {symbol,exchange:null,status:'error',direction:null,level:'UNAVAILABLE',
  filterDiagnostic:{stage:'data_unavailable'},reason:errors.join(' / ')};
}
async function scanAll(){
 // Keep four market scans in flight, including when one exchange is slow.
 // Dynamic workers avoid eight sequential batch barriers for 32 instruments,
 // while keeping WEEX request concurrency no higher than before.
 const results=Array(SYMBOLS.length);let next=0;
 async function worker(){
  while(next<SYMBOLS.length){
   const i=next++;
   results[i]=await scanSymbol(SYMBOLS[i]);
  }
 }
 await Promise.all(Array.from({length:Math.min(4,SYMBOLS.length)},()=>worker()));
 return results;
}
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 if(req.query?.mode==='v110-news'){
  // Public research only; no news enters the trade or forecast cron.
  const {handleV110NewsStudy}=await import('../lib/v110-news-shadow.mjs');
  return handleV110NewsStudy(req,res);
 }
 if(req.query?.mode==='greeks'){
  // Manual on-demand option data only; never part of cron, signal or forecast dispatch.
  const {handleGreeksShadow}=await import('../lib/greeks-shadow.mjs');
  return handleGreeksShadow(req,res);
 }
 if(req.query?.mode==='forecast'){
  // Observational 1/5/10m FORECAST is separate from actionable LONG/SHORT.
  const {handleStandaloneForecast}=await import('../lib/standalone-forecast.mjs');
  return handleStandaloneForecast(req,res,FORECAST_SYMBOLS);
 }
 if(req.query?.mode==='forecast-filter-replay'){
  // On-demand, per-symbol, read-only replay on closed public WEEX candles.
  // Does not run in the forecast cron or alter delivery/trading decisions.
  const {handleForecastFilterReplay}=await import('../lib/forecast-filter-replay.mjs');
  return handleForecastFilterReplay(req,res,FORECAST_SYMBOLS);
 }
 if(req.query?.mode==='early'){
  const {handleEarlyWatch}=await import('../lib/early-watch.mjs');
  return handleEarlyWatch(req,res);
 }
 if(req.query?.mode==='early-study'){
  const {handleEarlyStudy}=await import('../lib/early-study-route.mjs');
  return handleEarlyStudy(req,res);
 }
 if(req.query?.mode==='quality'){
  const {default:handleQuality}=await import('../lib/signal-quality-route.mjs');
  return handleQuality(req,res);
 }
 if(req.query?.mode==='backtest'){
  const {handleBacktest}=await import('../lib/backtest-route.mjs');
  return handleBacktest(req,res,SYMBOLS);
 }
 if(req.query?.mode==='one-minute-research'){
  const {handleOneMinuteResearch}=await import('../lib/one-minute-entry-research-route.mjs');
  return handleOneMinuteResearch(req,res,SYMBOLS);
 }
 if(req.query?.mode==='journal'||req.query?.mode==='journal-export'){
  const {handleJournal}=await import('../lib/journal-route.mjs');
  return handleJournal(req,res,req.query.mode);
 }
 if(req.query?.mode==='health'){
  const {handleHealth}=await import('../lib/health-route.mjs');
  return handleHealth(req,res,scanAll);
 }
 if(req.query?.mode==='liquidity'){
  const {handleLiquidity}=await import('../lib/liquidity-route.mjs');
  return handleLiquidity(req,res,SYMBOLS);
 }
 try{
  const scanned=await scanAll();
  const now=Date.now();
  // Display-only advice. 5m/15m scan now covers 32; entry and ntfy safety gates are unchanged.
  const symbols=scanned.map(s=>({...s,advisor:adviseSymbol(s,now)}));
  const advisorOverview=summarizeAdvisor(scanned,now);
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  return res.status(200).json({generatedAt:now,interval:'5m',confirmationInterval:'15m',signalLifetimeMinutes:3,sourcePolicy:'WEEX first; Bybit if WEEX fails; never mix exchanges',notes:'Read-only indicative analysis. Not verified profitable.',advisorOverview,symbols});
 }catch(e){return res.status(502).json({error:'Market data unavailable',detail:String(e.message||e).slice(0,140)})}
}
export const _test={SYMBOLS,FORECAST_SYMBOLS,TRADE_SYMBOLS,ORIGINAL_SYMBOLS,scanAll,normalizeRows,ema,rsi,atr,getAnalysis,breakoutQuality,currentPriceQuality,fetchCurrentQuote,scanSymbol};