// Independent, ON-DEMAND read-only option Greeks laboratory.
// Data belongs to Deribit option contracts, NEVER to WEEX perpetual futures.
// No cron, trading, phone alerts, secrets, derived probabilities or signal gates.
const BASE='https://www.deribit.com/api/v2/public/';
const ASSETS=Object.freeze({BTCUSDT:'BTC',ETHUSDT:'ETH'});
const MONTHS=Object.freeze({JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11});
const DAY=86_400_000,MAX_BYTES=2_500_000;
const num=n=>(typeof n==='number'||(typeof n==='string'&&n.trim()))&&Number.isFinite(Number(n))?Number(n):null;
const positive=n=>num(n)!==null&&num(n)>0;
function parseOption(name,currency){
 if(typeof name!=='string')return null;
 const match=name.match(/^([A-Z]{3})-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:\.\d+)?)-([CP])$/);
 if(!match||match[1]!==currency||!(match[3] in MONTHS))return null;
 const expiry=Date.UTC(2000+Number(match[4]),MONTHS[match[3]],Number(match[2]),8);
 if(!Number.isSafeInteger(expiry)||new Date(expiry).getUTCDate()!==Number(match[2]))return null;
 const strike=Number(match[5]);
 if(!positive(strike))return null;
 return {name,expiry,strike,type:match[6]};
}
export function selectAtmPair(summary,currency,now=Date.now()){
 if(!Array.isArray(summary)||summary.length>5000||!['BTC','ETH'].includes(currency))return null;
 const grouped=new Map();
 for(const row of summary){
  const parsed=parseOption(row?.instrument_name,currency);
  if(!parsed)continue;
  const days=(parsed.expiry-now)/DAY;
  if(days<3||days>45||!positive(row.underlying_price)||!positive(row.mark_iv)||
   !positive(row.open_interest))continue;
  const u=num(row.underlying_price);
  if(Math.abs(Math.log(parsed.strike/u))>.12)continue;
  const key=parsed.expiry+':'+parsed.strike;
  const pair=grouped.get(key)||{expiry:parsed.expiry,strike:parsed.strike};
  pair[parsed.type]={name:parsed.name,underlying:u,oi:num(row.open_interest)};
  grouped.set(key,pair);
 }
 const pairs=[...grouped.values()].filter(x=>x.C&&x.P&&
  Math.abs(x.C.underlying-x.P.underlying)/x.C.underlying<.025);
 pairs.sort((a,b)=>{
  const s=x=>Math.abs(Math.log(x.strike/x.C.underlying))*12+
   Math.abs((x.expiry-now)/DAY-14)/60+
   1/(1+x.C.oi+x.P.oi);
  return s(a)-s(b);
 });
 return pairs[0]||null;
}
async function getPublic(path,fetchImpl){
 const r=await fetchImpl(BASE+path,{cache:'no-store',
  signal:AbortSignal.timeout(7500),
  headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-GREEKS-RESEARCH/1.0'}});
 if(!r?.ok)throw Error('DERIBIT_HTTP');
 const declared=num(r.headers?.get?.('content-length'));
 if(declared!==null&&declared>MAX_BYTES)throw Error('DERIBIT_TOO_LARGE');
 const text=await r.text();
 if(text.length>MAX_BYTES)throw Error('DERIBIT_TOO_LARGE');
 const obj=JSON.parse(text);
 if(obj?.error||!obj||!Object.hasOwn(obj,'result'))throw Error('DERIBIT_DATA_UNAVAILABLE');
 return obj.result;
}
function validatedTicker(ticker,contract,now){
 if(!ticker||ticker.instrument_name!==contract.name||
  ticker.state!=='open'||!Number.isSafeInteger(ticker.timestamp)||
  ticker.timestamp>now+5000||now-ticker.timestamp>180_000||
  !positive(ticker.underlying_price)||!positive(ticker.mark_iv))
  return null;
 const g=ticker.greeks;
 const delta=num(g?.delta),gamma=num(g?.gamma),vega=num(g?.vega),
  theta=num(g?.theta),rho=num(g?.rho);
 if([delta,gamma,vega,theta,rho].some(n=>n===null)||
  Math.abs(delta)>1.01||gamma<0||vega<0||
  [gamma,vega,theta,rho].some(n=>Math.abs(n)>1e7)||
  (contract.type==='C'&&delta<-.01)||
  (contract.type==='P'&&delta>.01))
  return null;
 return {instrument:contract.name,optionType:contract.type==='C'?'CALL':'PUT',
  timestamp:ticker.timestamp,
  underlyingPrice:num(ticker.underlying_price),
  markIvPct:num(ticker.mark_iv),
  openInterest:num(ticker.open_interest),
  delta,gamma,vega,theta,rho};
}
export function greeksBase(symbol){
 return {mode:'OPTIONS_GREEKS_SHADOW_V1',symbol,
  source:'DERIBIT_PUBLIC_OPTIONS',externalToWEEX:true,
  available:false,notTrade:true,ordersSent:0,signalPermission:false,
  affectsForecast:false,affectsNotifications:false,
  predictiveProbability:false};
}
export async function readGreeksShadow(symbol,{fetchImpl=fetch,now=Date.now()}={}){
 const result=greeksBase(symbol),currency=ASSETS[symbol];
 if(!currency)return {...result,reason:'NO_VERIFIED_OPTIONS_GREEKS_FOR_THIS_WEEX_SYMBOL'};
 const summary=await getPublic('get_book_summary_by_currency?currency='+currency+'&kind=option',fetchImpl);
 const pair=selectAtmPair(summary,currency,now);
 if(!pair)throw Error('NO_LIQUID_NEAR_ATM_PAIR');
 const quotes=await Promise.all([
  getPublic('ticker?instrument_name='+encodeURIComponent(pair.C.name),fetchImpl),
  getPublic('ticker?instrument_name='+encodeURIComponent(pair.P.name),fetchImpl)
 ]);
 const call=validatedTicker(quotes[0],{...pair.C,type:'C'},now);
 const put=validatedTicker(quotes[1],{...pair.P,type:'P'},now);
 if(!call||!put||Math.abs(call.underlyingPrice-put.underlyingPrice)/call.underlyingPrice>.025)
  throw Error('NO_FRESH_MATCHED_OPTION_QUOTES');
 return {...result,available:true,currency,
  expiryTimestamp:pair.expiry,strike:pair.strike,
  daysToExpiry:Number(((pair.expiry-now)/DAY).toFixed(2)),
  contracts:{call,put},
  note:'Actual Greeks of one near-ATM Deribit CALL/PUT pair; different exchange and product from WEEX perpetuals. Exchange-native units, not directional probabilities or GEX aggregation.'};
}
export async function handleGreeksShadow(req,res,{fetchImpl=fetch,now=Date.now()}={}){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const symbol=req.query?.symbol;
 if(typeof symbol!=='string'||!/^[A-Z0-9]{4,24}$/.test(symbol))
  return res.status(400).json({error:'Unsupported market'});
 if(!Object.hasOwn(ASSETS,symbol))
  return res.status(200).json({...greeksBase(symbol),
   reason:'NO_VERIFIED_OPTIONS_GREEKS_FOR_THIS_WEEX_SYMBOL'});
 try{return res.status(200).json(await readGreeksShadow(symbol,{fetchImpl,now}))}
 catch(e){
  console.warn('GREEKS_SHADOW_UNAVAILABLE '+symbol+' '+String(e.message||e).slice(0,65));
  return res.status(503).json({...greeksBase(symbol),
   reason:'NO_FRESH_DERIBIT_OPTIONS_DATA'});
 }
}
