// Public read-only one-coin investigation, never changes live signals
// or the authenticated/manual WEEX trade proposal/confirmation path.
import {normalizeBacktestCandles} from './strategy-backtest.mjs';
import {normalizeOneMinute,replayOneMinute} from './one-minute-entry-research.mjs';
import {DEFAULTS,twoFilterCandidate,replayTwoFilterCandles} from './scalp-two-filter-research.mjs';
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
 // The response includes a minute-level 'fresh' status. Do not CDN-cache it:
 // a cached true could mislead users after WEEX data has gone stale.
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const symbol=req.query?.symbol;
 if(typeof symbol!=='string'||!Array.isArray(symbols)||!symbols.includes(symbol))
  return res.status(400).json({error:'Choose one supported WEEX market'});
 if(req.query?.history==='1'){
  const {handleXrpHistoricalMinuteAudit}=await import('./xrp-historical-minute-audit.mjs');
  return handleXrpHistoricalMinuteAudit(req,res);
 }
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
   reentry10m:replayTwoFilterCandles(one,{horizonMinutes:10,strategy:'BAND_REENTRY'}),
   // Experimental 5-minute "no-chase" profile: do not make live signals.
   guardedBreakout5m:replayTwoFilterCandles(one,{horizonMinutes:5,
    strategy:'BAND_BREAKOUT',qualityProfile:'CAUTIOUS',cooldownMinutes:5}),
   guardedReentry5m:replayTwoFilterCandles(one,{horizonMinutes:5,
    strategy:'BAND_REENTRY',qualityProfile:'CAUTIOUS',cooldownMinutes:5})
  };
  // LIVE-CANDLE OBSERVATION ONLY, NOT an executable or approved trade.
  // Fail closed on delayed data rather than claiming an up-to-date setup.
  const last=one.at(-1),fresh=now-last.closeTime<=90_000;
  const observation=fresh?{
   breakout:twoFilterCandidate(one,now,{...DEFAULTS,strategy:'BAND_BREAKOUT',
    qualityProfile:'CAUTIOUS'}),
   reentry:twoFilterCandidate(one,now,{...DEFAULTS,strategy:'BAND_REENTRY',
    qualityProfile:'CAUTIOUS'})
  }:null;
  const currentMinute={fresh,closedAt:last.closeTime,checkedAt:now,
   observedClose:last.close,market:'WEEX XRP/selected market public 1m',
   notATrade:true,observation};
  return res.status(200).json({
   symbol,exchange:'WEEX',generatedAt:now,
   historyHours:Number(((one.at(-1).closeTime-one[0].time)/3600000).toFixed(1)),
   ...result,
   shadowBBVolume,currentMinute,
   warnings:'Research outcomes cannot trigger orders. Live WEEX scanner and ntfy remain unchanged.'
  });
 }catch(e){
  console.warn('RADAR_ONE_MINUTE_RESEARCH_UNAVAILABLE '+String(e?.message||e).slice(0,90));
  return res.status(503).json({error:'WEEX 1m research temporarily unavailable; live radar unaffected.'});
 }
}
