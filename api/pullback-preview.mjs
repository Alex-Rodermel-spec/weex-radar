// Public market-only preview. NEVER opens, changes, or cancels an order.
import {_test} from './signals.mjs';
import {planPullbackPreview} from '../lib/pullback-preview.mjs';
const SYMBOLS=new Set(_test.SYMBOLS);
async function getJson(url){
 const r=await fetch(url,{signal:AbortSignal.timeout(6500),cache:'no-store',
  headers:{Accept:'application/json','User-Agent':'WEEX-RADAR/1.0'}});
 if(!r.ok)throw Error('WEEX market HTTP '+r.status);
 return r.json();
}
function closedOneMinute(rows,now){
 if(!Array.isArray(rows))return [];
 const map=new Map();
 for(const row of rows){
  if(!Array.isArray(row)||row.length<6)continue;
  const [time,open,high,low,close,volume]=row.slice(0,6).map(Number);
  if(![time,open,high,low,close,volume].every(Number.isFinite)||
   time>now||time<now-120*60_000||
   time+60_000>now-1000||open<=0||close<=0||low<=0||
   high<Math.max(open,close)||low>Math.min(open,close)||volume<0)continue;
  map.set(time,{time,closeTime:time+60_000,open,high,low,close,volume});
 }
 return [...map.values()].sort((a,b)=>a.time-b.time);
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const symbol=typeof req.query?.symbol==='string'?req.query.symbol:'';
 if(!SYMBOLS.has(symbol))return res.status(400).json({error:'Unsupported symbol'});
 try{
  const signal=await _test.scanSymbol(symbol);
  if(signal.status!=='ok'||signal.exchange!=='WEEX'||!signal.direction)
   return res.status(409).json({status:'NO_SETUP',error:'No fresh confirmed WEEX 5m signal'});
  const base='https://api-contract.weex.com';
  const [rawCandles,book,info]=await Promise.all([
   getJson(base+'/capi/v3/market/klines?symbol='+symbol+'&interval=1m&limit=20'),
   getJson(base+'/capi/v3/market/ticker/bookTicker?symbol='+symbol),
   getJson(base+'/capi/v3/market/exchangeInfo?symbol='+symbol)
  ]);
  const market=info?.symbols?.find(x=>x.symbol===symbol);
  const quote=(Array.isArray(book)?book:[book]).find(x=>x?.symbol===symbol);
  const rows=closedOneMinute(Array.isArray(rawCandles)?rawCandles:rawCandles?.data,Date.now());
  const candidate=planPullbackPreview({signal,quote,candles:rows,
   pricePrecision:Number(market?.pricePrecision)});
  if(!candidate)
   return res.status(409).json({status:'NO_SETUP',error:'No safe pullback candidate near the fresh quote'});
  return res.status(200).json(candidate);
 }catch(e){
  return res.status(409).json({status:'PREVIEW_UNAVAILABLE',error:'Market-only pullback preview unavailable'});
 }
}
