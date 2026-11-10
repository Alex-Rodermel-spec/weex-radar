// Read-only 1m WEEX paper observation for a browser-controlled FIVE-WIN test.
// Never places orders, touches accounts/secrets or modifies main/cron/ntfy.
// The browser, not this serverless handler, stores signals BEFORE their 5m outcome.
import {normalizeOneMinute} from './one-minute-entry-research.mjs';
import {DEFAULTS,twoFilterCandidate} from './scalp-two-filter-research.mjs';
import {researchRegime} from './market-regime-research.mjs';
const WEEX='https://api-contract.weex.com/capi/v3/market/klines';
const MINUTE=60_000,MAX_BYTES=28_000;
const STRATEGIES=['BAND_BREAKOUT','BAND_REENTRY'];
const BOOK='https://api-contract.weex.com/capi/v3/market/ticker/bookTicker';
const BOOK_MAX_BYTES=12000;
// Only request a public book quote when a NEW completed 1m candle actually
// qualifies; all other minute checks continue to fetch candles only.
export async function candidateBookQuote(symbol,closeTime,now=Date.now()){
 const response=await fetch(BOOK+'?symbol='+encodeURIComponent(symbol),{
  cache:'no-store',signal:AbortSignal.timeout(3000),
  headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-PAPER-RESEARCH/1.0'}
 });
 if(!response.ok)throw Error('WEEX_BOOK_HTTP_'+response.status);
 if(Number(response.headers?.get?.('content-length')||0)>BOOK_MAX_BYTES)
  throw Error('WEEX_BOOK_TOO_LARGE');
 const body=await response.text();
 if(body.length>BOOK_MAX_BYTES)throw Error('WEEX_BOOK_TOO_LARGE');
 const value=JSON.parse(body);
 const book=(Array.isArray(value)?value:[value])
  .find(row=>row?.symbol===symbol);
 const bid=Number(book?.bidPrice),ask=Number(book?.askPrice),
  quotedAt=Number(book?.time);
 if(!Number.isSafeInteger(quotedAt)||quotedAt<closeTime||quotedAt>now+5000||
  now-quotedAt>12000||!Number.isFinite(bid)||!Number.isFinite(ask)||
  bid<=0||ask<bid||(ask-bid)/((ask+bid)/2)>0.004)
  throw Error('WEEX_BOOK_STALE_OR_INVALID');
 const spreadBps=(ask-bid)/((ask+bid)/2)*10000;
 return {source:'WEEX_PUBLIC_BOOKTICKER',bid,ask,quotedAt,
  spreadBps:Number(spreadBps.toFixed(2)),notATrade:true};
}

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
 // WATCH is a low-priority observational stage, NOT a trading signal.
 // It raises visibility without altering the stricter, separately scored PAPER entries.
 // Indicators use exclusively closed candles known at the snapshot time.
 const state=twoFilterCandidate(one,now,{...DEFAULTS,
  strategy:'BAND_BREAKOUT',qualityProfile:'BASE'});
 const width=state.bandUpper-state.bandLower;
 const validBands=Number.isFinite(width)&&width>0&&
  Number.isFinite(state.bandMid)&&state.bandMid>0;
 const distance=validBands?Math.min(Math.abs(last.close-state.bandUpper),
  Math.abs(last.close-state.bandLower))/width:null;
 const side=validBands&&last.close>=state.bandMid?'LONG':'SHORT';
 const ratio=Number.isFinite(state.volumeRatio)?state.volumeRatio:0;
 const near=Number.isFinite(distance)&&distance<=0.3&&ratio>=0.8;
 const active=ratio>=1.15;
 const regime=researchRegime(one);
 // More frequent non-trading observations: momentum and Bollinger squeeze
 // are context tags only, never a lower threshold for executable entries.
 const kind=near?'NEAR_BAND':active?'VOLUME_ACTIVITY':
  regime.momentumWatch?'MOMENTUM':regime.squeezed?'SQUEEZE':'QUIET';
 // Typical recent one-minute high-low range, not a forecast of a 5m directional move.
 // Relative to modeled 22bps round-trip costs (true spread can make them higher).
 const recent20=one.slice(-20);
 const meanOneMinuteRangeBps=recent20.reduce((sum,bar)=>
  sum+(bar.high-bar.low)/bar.close*10000,0)/recent20.length;
 const marketWatch={
  kind,direction:near?side:null,regime,
  nearBand:near,relativeVolume:Number(ratio.toFixed(3)),
  bandDistancePct:distance===null?null:Number((distance*100).toFixed(1)),
  oneMinuteRangeBps:Number(meanOneMinuteRangeBps.toFixed(2)),
  // Fixed descriptive proxy only, no modeled trade and no claimed expectancy.
  modeledCostBps:22,
  rangeToCostRatio:Number((meanOneMinuteRangeBps/22).toFixed(2)),
  notATrade:true
 };
 const recent=[];
 for(let i=one.length-5;i<one.length;i++){
  for(const strategy of STRATEGIES){
   const checked=twoFilterCandidate(one.slice(0,i+1),one[i].closeTime+1000,
    {...DEFAULTS,strategy,qualityProfile:'CAUTIOUS'});
   if(checked.direction){
    // Indicators MUST be calculated at the candidate's own historical
    // candle close, never using the later snapshot's newer bars.
    const atSignal=researchRegime(one.slice(0,i+1));
    const signalTrend=atSignal.available?atSignal.trend:'UNKNOWN';
    const trendAligned=checked.direction==='LONG'?signalTrend==='UP':
     signalTrend==='DOWN';
    recent.push({
     strategy,direction:checked.direction,closedAt:one[i].closeTime,
     observedClose:one[i].close,volumeRatio:checked.volumeRatio,
     signalTrend,trendAligned,
     signalRsi14:atSignal.available?atSignal.rsi14:null,
     signalAtr14Bps:atSignal.available?atSignal.atr14Bps:null,
     signalBbWidthBps:atSignal.available?atSignal.bbWidthBps:null,
     notATrade:true
    });
   }
  }
 }
 return {
  mode:'PAPER_1M_WEEX_ONLY',generatedAt:now,closedAt:last.closeTime,
  candleCount:one.length,notATrade:true,ordersSent:0,tradeReady:false,
  assumedRoundTripCostsBps:22,marketWatch,
  // Include actual completed 1m bars so future snapshots can settle already
  // recorded test positions using next-minute OPEN and fifth-minute CLOSE.
  // No future bars are accessible at signal registration time.
  bars:one.map(c=>({time:c.time,open:c.open,close:c.close})),
  recent,
  disclaimer:'Forward paper candidates require fresh public WEEX bid/ask snapshot, but actual order fills, future exit spread, funding, SL/TP and leverage remain unknown. Do not infer profitable live trading.'
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
  let paperEntryQuote=null;
  if(snapshot.recent.some(e=>e.closedAt===snapshot.closedAt)){
   try{paperEntryQuote=await candidateBookQuote(symbol,snapshot.closedAt)}
   catch{
    // Do not invent a quote or turn a missing book into a paper fill.
    // WATCH still works and the browser will skip the paper candidate.
   }
  }
  return res.status(200).json({...snapshot,exchange:'WEEX',symbol,
   paperEntryQuote,quoteRequiredForNewPaper:true});
 }catch(e){
  console.warn('PAPER_1M_WEEX_UNAVAILABLE '+String(e?.message||e).slice(0,90));
  return res.status(503).json({error:'Fresh public WEEX 1m paper data unavailable',symbol,
   tradeReady:false,ordersSent:0});
 }
}
