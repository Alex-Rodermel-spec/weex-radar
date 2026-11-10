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

export function buildPaperMinuteSnapshot(rows,now=Date.now(),{quick=false}={}){
 if(typeof quick!=='boolean')throw Error('BAD_PAPER_MODE');
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
 // A separate retrospective candle-only diagnostic allows the owner
 // to see whether this very selective method ever triggers, without
 // fabricating PAPER fills or backfilling a forward trade.
 // The 66-market minute monitor uses quick=1 every minute to avoid
 // re-playing 90 historic candles × 2 strategies × 66 markets each scan.
 // Full historic diagnostics can be requested every 10 minutes separately.
 const historical90m=quick?null:{kind:'PAST_CANDLES_ONLY_NOT_PAPER',
  notATrade:true,observedMinutes:Math.min(90,one.length-20),
  rawCandidates:0,guardedCandidates:0,qualityRejected:0,
  lastSignals:[]};
 if(!quick)for(let i=Math.max(20,one.length-90);i<one.length;i++){
  const candlesAtSignal=one.slice(0,i+1),time=one[i].closeTime+1000;
  for(const strategy of STRATEGIES){
   const base=twoFilterCandidate(candlesAtSignal,time,
    {...DEFAULTS,strategy,qualityProfile:'BASE'});
   const guarded=twoFilterCandidate(candlesAtSignal,time,
    {...DEFAULTS,strategy,qualityProfile:'CAUTIOUS'});
   if(base.direction)historical90m.rawCandidates++;
   if(base.direction&&!guarded.direction)historical90m.qualityRejected++;
   if(guarded.direction){
    historical90m.guardedCandidates++;
    historical90m.lastSignals.push({
     closedAt:one[i].closeTime,strategy,direction:guarded.direction,
     observedClose:one[i].close,notATrade:true
    });
   }
  }
 }
 if(historical90m)historical90m.lastSignals=historical90m.lastSignals.slice(-10);
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
  assumedRoundTripCostsBps:22,marketWatch,historical90m,
  // Completed OHLC bars allow an adverse-excursion WARNING for ×50 paper
  // leverage. One-minute wicks cannot prove real liquidation or exit fills.
  // No future bars are accessible at signal registration time.
  bars:one.map(c=>({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close})),
  recent,
  disclaimer:'Forward paper candidates require fresh public WEEX bid/ask snapshot, but actual order fills, future exit spread, funding, SL/TP and leverage remain unknown. Do not infer profitable live trading.'
 };
}

// Read-only public WEEX 1m data. Reused by individual and small-batch API
// to minimize Vercel invocations (66 singles/min => 11 batches/min).
async function readPaperSymbol(symbol,quick){
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
 const snapshot=buildPaperMinuteSnapshot(records,Date.now(),{quick});
 let paperEntryQuote=null;
 if(snapshot.recent.some(e=>e.closedAt===snapshot.closedAt)){
  try{paperEntryQuote=await candidateBookQuote(symbol,snapshot.closedAt)}
  catch{
   // Fail closed on missing or old public WEEX bookTicker.
  }
 }
 return {...snapshot,exchange:'WEEX',symbol,
  paperEntryQuote,quoteRequiredForNewPaper:true};
}
export async function handlePaperMinuteWatch(req,res,symbols){
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const allowed=Array.isArray(symbols)?new Set(symbols):new Set();
 if(req.query?.batch==='1'){
  // The batch limit bounds memory, CPU and WEEX rate pressure per invocation.
  const raw=req.query?.symbols;
  if(typeof raw!=='string'||raw.length>160)
   return res.status(400).json({error:'Invalid research batch'});
  const selections=raw.split(',');
  if(selections.length<1||selections.length>6||
   new Set(selections).size!==selections.length||
   selections.some(s=>!allowed.has(s)))
   return res.status(400).json({error:'Unsupported or oversized WEEX batch'});
  const quick=req.query?.quick==='1';
  const results=await Promise.all(selections.map(async symbol=>{
   try{
    return {symbol,status:'ok',data:await readPaperSymbol(symbol,quick)};
   }catch(e){
    console.warn('PAPER_1M_BATCH_UNAVAILABLE '+symbol+' '+
     String(e?.message||e).slice(0,70));
    return {symbol,status:'unavailable',data:null};
   }
  }));
  return res.status(200).json({
   mode:'PAPER_1M_WEEX_BATCH',exchange:'WEEX',notATrade:true,
   ordersSent:0,generatedAt:Date.now(),results
  });
 }
 const symbol=req.query?.symbol;
 if(typeof symbol!=='string'||!allowed.has(symbol))
  return res.status(400).json({error:'Unsupported WEEX market'});
 try{
  return res.status(200).json(await readPaperSymbol(symbol,req.query?.quick==='1'));
 }catch(e){
  console.warn('PAPER_1M_WEEX_UNAVAILABLE '+String(e?.message||e).slice(0,90));
  return res.status(503).json({error:'Fresh public WEEX 1m paper data unavailable',symbol,
   tradeReady:false,ordersSent:0});
 }
}
