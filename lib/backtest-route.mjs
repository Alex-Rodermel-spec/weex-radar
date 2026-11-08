// Public, read-only historical research. Never polls account data, writes
// to GitHub/Blob, sends pushes or changes production signal selection.
// Only two WEEX public klines requests for a SINGLE explicit symbol.
import {
 normalizeBacktestCandles,replayHistory,DEFAULT_FEE_BPS,
 DEFAULT_SLIPPAGE_BPS
} from './strategy-backtest.mjs';

const MAX_BODY=650_000;
const URL='https://api-contract.weex.com/capi/v3/market/klines';
async function klines(symbol,interval,limit,fetchImpl=fetch){
 const url=URL+'?symbol='+encodeURIComponent(symbol)+'&interval='+
   interval+'&limit='+limit;
 const r=await fetchImpl(url,{
  signal:AbortSignal.timeout(9500),cache:'no-store',
  headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-RESEARCH/1.0'}
 });
 if(!r.ok)throw Error('MARKET_HTTP_'+r.status);
 const size=Number(r.headers?.get?.('content-length')||0);
 if(size>MAX_BODY)throw Error('MARKET_TOO_LARGE');
 const text=await r.text();
 if(text.length>MAX_BODY)throw Error('MARKET_TOO_LARGE');
 const payload=JSON.parse(text);
 return Array.isArray(payload)?payload:payload?.data;
}

function rate(raw,defaultValue,max){
 if(raw===undefined||raw===null||raw==='')return defaultValue;
 const candidate=Number(raw);
 if(typeof raw!=='string'||raw.length>6||!Number.isFinite(candidate)||
   candidate<0||candidate>max||!/^\d{1,2}(?:\.\d{1,2})?$/.test(raw))
  return null;
 return candidate;
}

export async function handleBacktest(req,res,symbols){
 res.setHeader('Cache-Control','public, s-maxage=90, stale-while-revalidate=180');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const symbol=req.query?.symbol||'BTCUSDT';
 const feeBps=rate(req.query?.feeBps,DEFAULT_FEE_BPS,25);
 const slippageBps=rate(req.query?.slippageBps,DEFAULT_SLIPPAGE_BPS,50);
 if(typeof symbol!=='string'||!symbols.includes(symbol)||
  feeBps===null||slippageBps===null)
  return res.status(400).json({error:'Некорректная монета или параметры издержек.'});
 try{
  // 48h of 5m candles and >60h of 15m candles include EMA warm-up.
  // No historical orderbook/quote is available: next 5m open is only a proxy.
  const [fiveBody,fifteenBody]=await Promise.all([
   klines(symbol,'5m',576),klines(symbol,'15m',260)
  ]);
  const now=Date.now();
  const five=normalizeBacktestCandles(fiveBody,'5m',now),
   fifteen=normalizeBacktestCandles(fifteenBody,'15m',now);
  if(five.length<80||fifteen.length<60||
   now-five.at(-1).closeTime>10*60_000||
   now-fifteen.at(-1).closeTime>30*60_000)
   throw Error('STALE_OR_SHORT_HISTORY');
  const result=replayHistory(five,fifteen,{feeBps,slippageBps});
  return res.status(200).json({
   generatedAt:now,symbol,exchange:'WEEX',
   backtestOnly:true,changesLiveSignals:false,changesOrders:false,
   dataDays:Math.round((five.at(-1).closeTime-five[0].time)/86_400_000*10)/10,
   ...result,
   warnings:[
    'Вместо реальной текущей котировки используется OPEN следующей 5м свечи; точность повторения live-сканера ограничена.',
    'Исторический 5м OHLC не показывает порядок касаний TP/SL внутри свечи. Неопределённые исходы исключены из результата.',
    'Время доставки push, реальные спреды, проскальзывание, funding, ликвидации и исполнение ордеров не восстановлены.',
    'Это один и тот же исторический отрезок для сравнения, не проверка на независимых будущих данных. Маленькая выборка ненадёжна.',
    'Результаты не гарантируют будущую прибыль, а пересекающиеся сигналы не являются реальным портфелем.'
   ]
  });
 }catch(e){
  console.warn('RADAR_BACKTEST_UNAVAILABLE '+String(e?.message||e).slice(0,75));
  return res.status(503).json({
   error:'Исторический тест сейчас недоступен. Сканы и push продолжают работать.'
  });
 }
}
