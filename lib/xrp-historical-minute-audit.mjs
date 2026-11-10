// Fixed-date, reproducible WEEX historical XRP 1m research sample.
// READ-ONLY: public market klines, no auth, trade/order, account, ntfy, cron or secrets.
// The 10-hour historical slice predates the V2 changes and cannot be reused
// as proof of forward profitability or a calibrated strategy.
import {normalizeOneMinute} from './one-minute-entry-research.mjs';
import {replayTwoFilterCandles} from './scalp-two-filter-research.mjs';

const BASE_URL='https://api-contract.weex.com/capi/v3/market/historyKlines';
const START=Date.UTC(2026,10,8,0,0,0); // 2026-11-08, 00:00Z, fixed for reproducibility
const MINUTE=60_000,COUNT=600,PAGE=100,MAX_BYTES=45_000;
const sampleEnd=START+COUNT*MINUTE;

async function historyPage(start,fetchImpl=fetch){
 const end=start+(PAGE-1)*MINUTE;
 const url=BASE_URL+'?symbol=XRPUSDT&interval=1m&priceType=LAST&limit=100'+
  '&startTime='+start+'&endTime='+end;
 const response=await fetchImpl(url,{cache:'no-store',signal:AbortSignal.timeout(9000),
  headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-RESEARCH/1.0'}});
 if(!response.ok)throw Error('WEEX_HISTORY_HTTP_'+response.status);
 if(Number(response.headers?.get?.('content-length')||0)>MAX_BYTES)
  throw Error('WEEX_HISTORY_TOO_LARGE');
 const body=await response.text();
 if(body.length>MAX_BYTES)throw Error('WEEX_HISTORY_TOO_LARGE');
 const parsed=JSON.parse(body);
 const data=Array.isArray(parsed)?parsed:parsed?.data;
 if(!Array.isArray(data)||data.length>PAGE)throw Error('WEEX_HISTORY_INVALID');
 for(const raw of data){
  const time=Number(raw?.[0]);
  if(!Array.isArray(raw)||raw.length<6||!Number.isSafeInteger(time)||
   time<start||time>end||time%MINUTE!==0)
   throw Error('WEEX_HISTORY_OUT_OF_WINDOW');
 }
 return data;
}

export async function handleXrpHistoricalMinuteAudit(req,res){
 res.setHeader('Cache-Control','public, s-maxage=3600');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 if(req.query?.symbol!=='XRPUSDT'||req.query?.history!=='1')
  return res.status(400).json({error:'Fixed public XRP historical audit only'});
 if(Date.now()<sampleEnd+MINUTE)
  return res.status(503).json({error:'Historical window is not closed'});
 try{
  const pages=[];
  // Rate-limited research: 6 public history requests, three concurrently.
  for(let i=0;i<COUNT/PAGE;i+=3){
   const batch=await Promise.all([0,1,2].map(n=>
    historyPage(START+(i+n)*PAGE*MINUTE)));
   pages.push(...batch);
  }
  const now=Date.now(),one=normalizeOneMinute(pages.flat(),now);
  // No silent substitution with latest candles or another trading pair.
  if(one.length<450||one[0].time<START||
   one.at(-1).closeTime>sampleEnd)throw Error('HISTORICAL_COVERAGE_TOO_SMALL');
  const countGaps=one.slice(1).filter((bar,i)=>bar.time!==one[i].closeTime).length;
  const options=[
   {key:'breakout5m',strategy:'BAND_BREAKOUT',qualityProfile:'BASE',cooldownMinutes:0},
   {key:'breakoutCautious5m',strategy:'BAND_BREAKOUT',qualityProfile:'CAUTIOUS',cooldownMinutes:5},
   {key:'reentry5m',strategy:'BAND_REENTRY',qualityProfile:'BASE',cooldownMinutes:0},
   {key:'reentryCautious5m',strategy:'BAND_REENTRY',qualityProfile:'CAUTIOUS',cooldownMinutes:5}
  ];
  const strategies={};
  for(const {key,...settings} of options)
   strategies[key]=replayTwoFilterCandles(one,{...settings,horizonMinutes:5});
  return res.status(200).json({
   mode:'HISTORICAL_XRP_SHADOW',exchange:'WEEX',symbol:'XRPUSDT',
   generatedAt:now,windowStartUtc:new Date(START).toISOString(),
   windowEndUtc:new Date(sampleEnd).toISOString(),
   bars:one.length,gaps:countGaps,
   assumptions:'Research uses next 1m open, five-minute close, 22bps modeled round-trip costs, zero real spread; no fills, TP/SL or funding.',
   tradeReady:false,changesLiveSignals:false,ordersSent:0,
   strategies,
   warning:'Different past day, but still retrospective and not true forward validation. Never activate live entries based on this alone.'
  });
 }catch(e){
  console.warn('XRP_HISTORICAL_RESEARCH_UNAVAILABLE '+String(e?.message||e).slice(0,85));
  return res.status(503).json({error:'Historical WEEX 1m research unavailable; live radar unaffected.'});
 }
}
