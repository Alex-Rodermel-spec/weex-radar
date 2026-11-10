// Public read-only one-coin investigation, never changes live signals
// or the authenticated/manual WEEX trade proposal/confirmation path.
import {normalizeBacktestCandles} from './strategy-backtest.mjs';
import {normalizeOneMinute,replayOneMinute} from './one-minute-entry-research.mjs';
import {replayTwoFilterCandles} from './scalp-two-filter-research.mjs';
const URL='https://api-contract.weex.com/capi/v3/market/klines';
const MAX_BYTES=240_000;
async function candles(symbol,interval,limit,fetchImpl=fetch){
 const url=URL+'?symbol='+encodeURIComponent(symbol)+
  '&interval='+interval+'&limit='+limit;
 const r=await fetchImpl(url,{cache:'no-store',signal:AbortSignal.timeout(10000),
  headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-RESEARCH/1.0'}});
 if(!r.ok)throw Error('WEEX_KLINES_HTTP_'+r.status);
 const len=Number(r.headers?.get?.('content-length')||0);
 if(len>MAX_BYTES)throw Error('CANDLES_TOO_LARGE');
 const raw=await r.text();
 if(raw.length>MAX_BYTES)throw Error('CANDLES_TOO_LARGE');
 const value=JSON.parse(raw);
 if(!Array.isArray(value)&&!Array.isArray(value?.data))
  throw Error('BAD_WEEX_CANDLES');
 return Array.isArray(value)?value:value.data;
}
export async function handleOneMinuteResearch(req,res,symbols){
 res.setHeader('Cache-Control','public, s-maxage=120, stale-while-revalidate=120');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const symbol=req.query?.symbol;
 if(typeof symbol!=='string'||!Array.isArray(symbols)||!symbols.includes(symbol))
  return res.status(400).json({error:'Choose one supported WEEX market'});
 try{
  const [rawOne,rawFive,rawFifteen]=await Promise.all([
   candles(symbol,'1m',1000),candles(symbol,'5m',350),candles(symbol,'15m',150)
  ]);
  const now=Date.now(),one=normalizeOneMinute(rawOne,now),
   five=normalizeBacktestCandles(rawFive,'5m',now),
   fifteen=normalizeBacktestCandles(rawFifteen,'15m',now);
  if(!one.length||!five.length||!fifteen.length||
   now-one.at(-1).closeTime>3*60000||
   now-five.at(-1).closeTime>10*60000||
   now-fifteen.at(-1).closeTime>30*60000)
   throw Error('STALE_MARKETS');
  const result=replayOneMinute(one,five,fifteen);
  // Side-by-side SHADOW observation only. The BB+volume scalp uses a fixed
  // 5m/10m close horizon, not the 60m stop/take replay above. Do not merge
  // their win rates or treat the scalp as an approved WEEX order.
  const shadowBBVolume={
   horizon5m:replayTwoFilterCandles(one,{horizonMinutes:5,strategy:'BAND_BREAKOUT'}),
   horizon10m:replayTwoFilterCandles(one,{horizonMinutes:10,strategy:'BAND_BREAKOUT'}),
   reentry5m:replayTwoFilterCandles(one,{horizonMinutes:5,strategy:'BAND_REENTRY'}),
   reentry10m:replayTwoFilterCandles(one,{horizonMinutes:10,strategy:'BAND_REENTRY'})
  };
  return res.status(200).json({
   symbol,exchange:'WEEX',generatedAt:now,
   historyHours:Number(((one.at(-1).closeTime-one[0].time)/3600000).toFixed(1)),
   ...result,
   shadowBBVolume,
   warnings:'Research outcomes cannot trigger orders. Live WEEX scanner and ntfy remain unchanged.'
  });
 }catch(e){
  console.warn('RADAR_ONE_MINUTE_RESEARCH_UNAVAILABLE '+String(e?.message||e).slice(0,90));
  return res.status(503).json({error:'WEEX 1m research temporarily unavailable; live radar unaffected.'});
 }
}
