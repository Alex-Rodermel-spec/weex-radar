// Read-only 1m WEEX paper observation for a browser-controlled FIVE-WIN test.
// Never places orders, touches accounts/secrets or modifies main/cron/ntfy.
// The browser, not this serverless handler, stores signals BEFORE their 5m outcome.
import {normalizeOneMinute} from './one-minute-entry-research.mjs';
import {DEFAULTS,twoFilterCandidate} from './scalp-two-filter-research.mjs';
const WEEX='https://api-contract.weex.com/capi/v3/market/klines';
const MINUTE=60_000,MAX_BYTES=28_000;
const STRATEGIES=['BAND_BREAKOUT','BAND_REENTRY'];

export function buildPaperMinuteSnapshot(rows,now=Date.now()){
 if(!Array.isArray(rows)||rows.length<40||rows.length>120)
  throw Error('BAD_PAPER_MINUTE_INPUT');
 if(!Number.isSafeInteger(now))throw Error('INVALID_NOW');
 const one=normalizeOneMinute(rows,now);
 const last=one.at(-1);
 if(one.length<35||!last||now-last.closeTime>90_000||
  now<last.closeTime+1000)throw Error('STALE_OR_TOO_FEW_PAPER_CANDLES');
 for(let i=1;i<one.length;i++)
  if(one[i].time!==one[i-1].closeTime)throw Error('GAPPED_PAPER_CANDLES');
 const recent=[];
 for(let i=one.length-5;i<one.length;i++){
  for(const strategy of STRATEGIES){
   const checked=twoFilterCandidate(one.slice(0,i+1),one[i].closeTime+1000,
    {...DEFAULTS,strategy,qualityProfile:'CAUTIOUS'});
   if(checked.direction)recent.push({
    strategy,direction:checked.direction,closedAt:one[i].closeTime,
    observedClose:one[i].close,volumeRatio:checked.volumeRatio,
    notATrade:true
   });
  }
 }
 return {
  mode:'PAPER_1M_WEEX_ONLY',generatedAt:now,closedAt:last.closeTime,
  candleCount:one.length,notATrade:true,ordersSent:0,tradeReady:false,
  assumedRoundTripCostsBps:22,
  // Include actual completed 1m bars so future snapshots can settle already
  // recorded test positions using next-minute OPEN and fifth-minute CLOSE.
  // No future bars are accessible at signal registration time.
  bars:one.map(c=>({time:c.time,open:c.open,close:c.close})),
  recent,
  disclaimer:'Candle-only forward paper model. No spread, actual fills, SL/TP, funding, latency or leverage. Do not infer profitable live trading.'
 };
}

export async function handlePaperMinuteWatch(req,res,symbols){
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const symbol=req.query?.symbol;
 if(!Array.isArray(symbols)||typeof symbol!=='string'||!symbols.includes(symbol))
  return res.status(400).json({error:'Unsupported WEEX market'});
 try{
  const url=WEEX+'?symbol='+encodeURIComponent(symbol)+'&interval=1m&limit=100';
  const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(8000),
   headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-PAPER-RESEARCH/1.0'}});
  if(!response.ok)throw Error('WEEX_PAPER_HTTP_'+response.status);
  const size=Number(response.headers?.get?.('content-length')||0);
  if(size>MAX_BYTES)throw Error('RESPONSE_TOO_LARGE');
  const body=await response.text();
  if(body.length>MAX_BYTES)throw Error('RESPONSE_TOO_LARGE');
  const parsed=JSON.parse(body);
  const records=Array.isArray(parsed)?parsed:parsed?.data;
  const snapshot=buildPaperMinuteSnapshot(records,Date.now());
  return res.status(200).json({...snapshot,exchange:'WEEX',symbol});
 }catch(e){
  console.warn('PAPER_1M_WEEX_UNAVAILABLE '+String(e?.message||e).slice(0,90));
  return res.status(503).json({error:'Fresh public WEEX 1m paper data unavailable',symbol,
   tradeReady:false,ordersSent:0});
 }
}
