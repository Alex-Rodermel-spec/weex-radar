// WEEX RADAR V2: opt-in PUBLIC-MARKET read-only research universe.
// The original 16 live/prod/cron markets remain completely unchanged.
// This module never calls private account, order or secret APIs.
export const BASE_MARKETS=Object.freeze([
 'BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT','ALGOUSDT','1000SHIBUSDT',
 'DOGEUSDT','XAUTUSDT','ZECUSDT','1000PEPEUSDT','HYPEUSDT',
 'BNBUSDT','ADAUSDT','LINKUSDT','SUIUSDT','AVAXUSDT'
]);
// Ordered candidate pool (>50): API eligibility is checked using WEEX's
// official public apiTradingSymbols endpoint, never assumed from this list.
export const EXTRA_CANDIDATES=Object.freeze([
 'TRXUSDT','BCHUSDT','LTCUSDT','DOTUSDT','ETCUSDT','ATOMUSDT',
 'NEARUSDT','APTUSDT','ARBUSDT','OPUSDT','INJUSDT','FILUSDT',
 'ICPUSDT','UNIUSDT','AAVEUSDT','TAOUSDT','TONUSDT','ENAUSDT',
 'ONDOUSDT','HBARUSDT','XLMUSDT','VETUSDT','TIAUSDT','SEIUSDT',
 'WLDUSDT','JUPUSDT','PYTHUSDT','JTOUSDT','STXUSDT','IMXUSDT',
 'LDOUSDT','RENDERUSDT','RUNEUSDT','FETUSDT','PENDLEUSDT',
 'ARUSDT','GALAUSDT','SANDUSDT','MANAUSDT','AXSUSDT','CHZUSDT',
 'CRVUSDT','COMPUSDT','SNXUSDT','EIGENUSDT','STRKUSDT','ZROUSDT',
 'ZKUSDT','ETHFIUSDT','ENSUSDT','ORDIUSDT','BLURUSDT','APEUSDT',
 'CAKEUSDT','GMXUSDT','RSRUSDT','IOTAUSDT','QTUMUSDT','XTZUSDT',
 'NEOUSDT','CELOUSDT','KAVAUSDT','MINAUSDT','ROSEUSDT','CFXUSDT',
 'ACHUSDT','ONEUSDT','DYDXUSDT','TRUMPUSDT','PNUTUSDT',
 'POPCATUSDT','TURBOUSDT','MEWUSDT','NEIROUSDT','ACTUSDT',
 'GOATUSDT','WIFUSDT','BONKUSDT','1000BONKUSDT','1000FLOKIUSDT',
 'FLOKIUSDT','1000LUNCUSDT','1000XECUSDT','DEGENUSDT',
 'POLUSDT','MATICUSDT','KASUSDT','BERAUSDT','OMUSDT','AKTUSDT',
 'SUSHIUSDT','YFIUSDT','BATUSDT','ZILUSDT','ILVUSDT','FLOWUSDT',
 'SAGAUSDT','NOTUSDT','MEMEUSDT','1000SATSUSDT','1000RATSUSDT',
 'NTRNUSDT','BIGTIMEUSDT','IDUSDT','AIUSDT','MOVRUSDT','SPELLUSDT'
]);
export const EXTRA_COUNT=50;
const set=new Set(BASE_MARKETS);
if(BASE_MARKETS.length!==16||set.size!==16||
 EXTRA_CANDIDATES.some(s=>set.has(s))||
 new Set(EXTRA_CANDIDATES).size!==EXTRA_CANDIDATES.length)
 throw Error('Invalid WEEX study universe');
export const PAPER_ALLOWED=Object.freeze([...BASE_MARKETS,...EXTRA_CANDIDATES]);
const SOURCE='https://api-contract.weex.com/capi/v3/market/apiTradingSymbols';
const STATS='https://api-contract.weex.com/capi/v3/market/ticker/24hr';
const TIMEOUT_MS=8500,MAX_BYTES=2_000_000;
async function fetchBounded(url,fetchImpl){
 const r=await fetchImpl(url,{cache:'no-store',
  signal:AbortSignal.timeout(TIMEOUT_MS),
  headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-RESEARCH/1.0'}});
 if(!r.ok)throw Error('PUBLIC_WEEX_HTTP_'+r.status);
 const len=Number(r.headers?.get?.('content-length')||0);
 if(len>MAX_BYTES)throw Error('PUBLIC_WEEX_TOO_LARGE');
 const text=await r.text();
 if(text.length>MAX_BYTES)throw Error('PUBLIC_WEEX_TOO_LARGE');
 return JSON.parse(text);
}
// Selection is pure and deterministic given official eligible pairs and optional
// live 24h USDT quote turnover. Never imply future performance or book depth.
export function selectWeexPaperMarkets(official,marketStats=null){
 if(!Array.isArray(official)||official.length<50||official.length>25000||
  official.some(x=>typeof x!=='string'))throw Error('INVALID_WEEX_ELIGIBILITY');
 const eligible=new Set(official);
 const turnover=new Map();
 if(Array.isArray(marketStats)){
  for(const x of marketStats){
   const val=Number(x?.quoteVolume);
   if(eligible.has(x?.symbol)&&Number.isFinite(val)&&val>=0)
    turnover.set(x.symbol,val);
  }
 }
 const candidates=EXTRA_CANDIDATES.filter(s=>eligible.has(s));
 // Liquidity proxy: sort descending by 24h USDT volume, stable priority tie-break.
 const top=turnover.size?
  [...candidates].sort((a,b)=>(turnover.get(b)||0)-(turnover.get(a)||0)||
   EXTRA_CANDIDATES.indexOf(a)-EXTRA_CANDIDATES.indexOf(b)):
  candidates;
 const additions=top.slice(0,EXTRA_COUNT);
 if(additions.length!==EXTRA_COUNT)throw Error('FEWER_THAN_50_ELIGIBLE');
 return {
  baseMarkets:[...BASE_MARKETS],extraMarkets:additions,
  markets:[...BASE_MARKETS,...additions],targetBase:16,targetExtra:EXTRA_COUNT,
  totalMarkets:66,selection:turnover.size?'WEEX_PUBLIC_24H_TURNOVER':'WEEX_ELIGIBLE_PRIORITY',
  notATrade:true,ordersSent:0
 };
}
export async function handleWeexPaperUniverse(req,res,{fetchImpl=fetch}={}){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{
  const eligible=await fetchBounded(SOURCE,fetchImpl);
  // Turnover is a ranked preference only; a failure cannot falsely
  // invalidate the official WEEX API eligibility gate.
  let stats=null;
  try{stats=await fetchBounded(STATS,fetchImpl)}catch{/* optional */}
  const universe=selectWeexPaperMarkets(eligible,stats);
  return res.status(200).json({
   mode:'WEEX_PAPER_UNIVERSE',exchange:'WEEX',
   generatedAt:Date.now(),...universe,
   note:'50 additional API-eligible futures pairs selected by public WEEX data, WATCH/PAPER only. No auto trades or new production scan.'
  });
 }catch(e){
  console.warn('WEEX_PAPER_UNIVERSE_UNAVAILABLE '+String(e?.message||e).slice(0,110));
  return res.status(503).json({error:'WEEX public futures eligible-pair verification unavailable',
   mode:'WEEX_PAPER_UNIVERSE_UNAVAILABLE',notATrade:true,ordersSent:0});
 }
}
