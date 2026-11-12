// Instrument-aware forecast regimes. These are initial NON-OPTIMIZED
// engineering bounds, not learned probabilities or claims of profitable
// indicators. The *actual* anti-chase thresholds are derived independently
// from each instrument's OWN 60 completed historical 1m returns.
// Does not fetch data, use time-of-day lookahead, or touch real trading.
export const MARKET_PROFILE_PROTOCOL=Object.freeze({
 version:'2026-11-12-per-market-closed-volatility-v1',
 returnsLookback:60,
 baselineLegacyBps:10,
 policy:'class bounds + individually observed recent volatility, never fitted on outcome labels',
 noOrders:true,extraWEEXQueries:0
});
const GROUPS=Object.freeze({
 MAJOR_CRYPTO:Object.freeze({label:'BTC/ETH',floor1:4,cap1:25,floor3:6,cap3:40}),
 ALT_CRYPTO:Object.freeze({label:'Альткоины',floor1:6,cap1:35,floor3:9,cap3:60}),
 MEME_CRYPTO:Object.freeze({label:'Мемкоины',floor1:10,cap1:55,floor3:15,cap3:85}),
 METALS:Object.freeze({label:'Металлы',floor1:3,cap1:20,floor3:5,cap3:35}),
 FX_DERIVED:Object.freeze({label:'Валютные инструменты WEEX',floor1:1.5,cap1:10,floor3:2.5,cap3:17}),
 EQUITY_DERIVED:Object.freeze({label:'Инструменты WEEX на акции',floor1:6,cap1:40,floor3:9,cap3:65})
});
const MEMBERS=Object.freeze({
 MAJOR_CRYPTO:['BTCUSDT','ETHUSDT'],
 ALT_CRYPTO:['XRPUSDT','SOLUSDT','ALGOUSDT','ZECUSDT','HYPEUSDT','BNBUSDT',
  'ADAUSDT','LINKUSDT','SUIUSDT','AVAXUSDT','TRXUSDT'],
 MEME_CRYPTO:['1000SHIBUSDT','DOGEUSDT','1000PEPEUSDT'],
 METALS:['XAUTUSDT','XAUUSDT','XAGUSDT'],
 FX_DERIVED:['AUDUSDT','CADUSDT','JPYUSDT','GBPUSDT','CHFUSDT','EURUSDT'],
 EQUITY_DERIVED:['GOOGLUSDT','MRNAUSDT','NVDAUSDT','AMDUSDT','MSFTUSDT','CSCOUSDT','KOUSDT']
});
const indexed=Object.entries(MEMBERS).flatMap(([group,items])=>items.map(symbol=>[symbol,group]));
if(new Set(indexed.map(([symbol])=>symbol)).size!==32||indexed.length!==32)
 throw Error('PROFILE_UNIVERSE_DUPLICATE_OR_MISSING');
const BY_SYMBOL=Object.freeze(Object.fromEntries(indexed));
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const round=n=>Math.round(n*10)/10;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export function marketForecastProfile(symbol){
 const group=BY_SYMBOL[symbol];
 if(!group)return null;
 return {symbol,group,label:GROUPS[group].label};
}
export function profileSymbols(){return Object.keys(BY_SYMBOL)}
export function adaptiveForecastThresholds(symbol,minuteBars,lastClosedAt){
 const profile=marketForecastProfile(symbol);
 if(!profile||!Number.isSafeInteger(lastClosedAt)||!Array.isArray(minuteBars)||
  minuteBars.length<65)return null;
 // 61 older closes -> 60 chronological returns. Exclude newest 1m/3m
 // closes that are being judged to prevent the current jump inflating
 // its own threshold. All measurements were already closed by observation.
 const before=minuteBars.slice(-65,-4);
 if(before.length!==61||before.some((r,i)=>!finite(r?.close)||r.close<=0||
  !Number.isSafeInteger(r.closeTime)||
  r.closeTime>lastClosedAt-4*60000||
  (i>0&&r.closeTime!==before[i-1].closeTime+60000)))return null;
 const absReturns=[];
 for(let i=1;i<before.length;i++)
  absReturns.push(10000*Math.abs(before[i].close-before[i-1].close)/before[i-1].close);
 absReturns.sort((a,b)=>a-b);
 const mid=(absReturns[29]+absReturns[30])/2;
 if(!finite(mid)||mid<=0)return null; // no meaningful volatility estimate
 const bounds=GROUPS[profile.group];
 const threshold1mBps=round(clamp(mid*2.25,bounds.floor1,bounds.cap1));
 const threshold3mBps=round(clamp(mid*3.8,bounds.floor3,bounds.cap3));
 return {...profile,ready:true,median1mAbsReturnBps:round(mid),
  threshold1mBps,threshold3mBps,
  referenceLastClosedAt:lastClosedAt,
  referenceEndsAt:before.at(-1).closeTime,
  returnsLookback:MARKET_PROFILE_PROTOCOL.returnsLookback,
  noLookahead:true};
}
