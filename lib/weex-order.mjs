// WEEX V3 Futures: signed REST client and conservative trading invariants.
// Never print signed headers, request bodies containing credentials, or secrets.
import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
import {createReadOnlyPlan, TRADE_LIMITS} from './trade-plan.mjs';

const WEEX_BASE = 'https://api-contract.weex.com';
const PRIVATE_PATHS = new Set([
  '/capi/v3/account/accountConfig',
  '/capi/v3/account/balance',
  '/capi/v3/account/position/allPosition',
  '/capi/v3/account/symbolConfig',
  '/capi/v3/openOrders',
  '/capi/v3/order',
  '/capi/v3/account/marginType',
  '/capi/v3/account/leverage',
  '/capi/v3/closePositions'
]);
const PUBLIC_PATHS = new Set([
  '/capi/v3/market/exchangeInfo',
  '/capi/v3/market/ticker/bookTicker',
  '/capi/v3/market/apiTradingSymbols'
]);
export function safeEqual(a,b) {
  if(typeof a!=='string'||typeof b!=='string'||!a||!b) return false;
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&timingSafeEqual(x,y);
}
export function configured() {
  return ['WEEX_API_KEY','WEEX_API_SECRET','WEEX_API_PASSPHRASE']
    .every(k=>typeof process.env[k]==='string'&&process.env[k].length>0);
}
export function validateHumanPassword(input) {
  const password=process.env.WEEX_TRADE_APPROVAL_PASSWORD;
  return typeof password==='string'&&password.length>=20&&safeEqual(input,password);
}
export function liveEnabled() {
  return process.env.WEEX_TRADING_ENABLED==='true' &&
    process.env.WEEX_CONFIRM_EACH_ORDER==='true' &&
    process.env.WEEX_MARGIN_USDT==='50' &&
    process.env.WEEX_LEVERAGE==='10' &&
    process.env.WEEX_MAX_OPEN_POSITIONS==='3';
}
export function signedHeaders(method,path,query='',body='',stamp=Date.now(),c={
  key:process.env.WEEX_API_KEY,
  secret:process.env.WEEX_API_SECRET,
  passphrase:process.env.WEEX_API_PASSPHRASE
}) {
  if(!PRIVATE_PATHS.has(path))throw Error('Unapproved private endpoint');
  if(![c.key,c.secret,c.passphrase].every(x=>typeof x==='string'&&x.length))throw Error('WEEX credentials missing');
  // Copy/paste from the exchange interface can include an accidental newline
  // or space. WEEX API identifiers and the alphanumeric passphrase cannot
  // contain such leading or trailing whitespace.
  const creds={key:c.key.trim(),secret:c.secret.trim(),passphrase:c.passphrase.trim()};
  if(![creds.key,creds.secret,creds.passphrase].every(Boolean))throw Error('WEEX credentials missing');
  const t=String(stamp);
  if(!/^\d{13}$/.test(t))throw Error('Invalid timestamp');
  const data=t+method.toUpperCase()+path+(query?'?'+query:'')+body;
  return {
    'ACCESS-KEY':creds.key,
    'ACCESS-SIGN':createHmac('sha256',creds.secret).update(data).digest('base64'),
    'ACCESS-PASSPHRASE':creds.passphrase,
    'ACCESS-TIMESTAMP':t,
    'Content-Type':'application/json',
    'User-Agent':'WEEX-RADAR/2.0',
    Accept:'application/json'
  };
}
export function parseExchangeResponse(raw,path) {
  const obj=JSON.parse(raw);
  if(path==='/capi/v3/order' && obj && !Array.isArray(obj)){
    const match=raw.match(/"orderId"\s*:\s*(?:"(\d+)"|(\d+))/);
    if(match)obj.orderId=match[1]||match[2];
  }
  return obj;
}
async function jsonFetch(path,method='GET',query='',body='',isPrivate=true,fetchFn=fetch) {
  if(!(isPrivate?PRIVATE_PATHS:PUBLIC_PATHS).has(path))throw Error('Unapproved endpoint');
  const url=WEEX_BASE+path+(query?'?'+query:'');
  const headers=isPrivate?signedHeaders(method,path,query,body):{'User-Agent':'WEEX-RADAR/2.0',Accept:'application/json'};
  const response=await fetchFn(url,{method,headers,...(body?{body}:{}),cache:'no-store',signal:AbortSignal.timeout(7500)});
  // Only numeric error codes may reach client, never upstream raw text.
  const raw=await response.text();
  let obj;
  try{obj=parseExchangeResponse(raw,path);}
  catch{throw Error('WEEX_HTTP_'+response.status);}
  const rawCode=obj?.code;
  const code=(typeof rawCode==='number'||typeof rawCode==='string')?String(rawCode):'';
  if(!response.ok||(code&&!['200','00000','0'].includes(code))){
    if(/^-?\d{1,6}$/.test(code))throw Error('WEEX_CODE_'+code);
    throw Error('WEEX_HTTP_'+response.status);
  }
  return obj;
}
export function qs(symbol) {
  if(!/^[A-Z0-9]{4,24}$/.test(symbol))throw Error('Invalid symbol');
  return 'symbol='+encodeURIComponent(symbol);
}
export const weex={
  account:()=>jsonFetch('/capi/v3/account/accountConfig'),
  balance:()=>jsonFetch('/capi/v3/account/balance'),
  positions:()=>jsonFetch('/capi/v3/account/position/allPosition'),
  symbolConfig:(symbol)=>jsonFetch('/capi/v3/account/symbolConfig','GET',qs(symbol)),
  openOrders:()=>jsonFetch('/capi/v3/openOrders'),
  apiTradingSymbols:()=>jsonFetch('/capi/v3/market/apiTradingSymbols','GET','','',false),
  info:(symbol)=>jsonFetch('/capi/v3/market/exchangeInfo','GET',qs(symbol),'',false),
  book:(symbol)=>jsonFetch('/capi/v3/market/ticker/bookTicker','GET',qs(symbol),'',false),
  placeOrder:(order)=>jsonFetch('/capi/v3/order','POST','',JSON.stringify(order)),
  order:(orderId)=>{
    if(!/^\d{1,30}$/.test(String(orderId)))throw Error('Invalid order ID');
    return jsonFetch('/capi/v3/order','GET','orderId='+orderId);
  },
  marginIsolated:(symbol)=>jsonFetch('/capi/v3/account/marginType','POST','',JSON.stringify({
    symbol,marginType:'ISOLATED',separatedType:'COMBINED'
  })),
  setLeverage:(symbol)=>jsonFetch('/capi/v3/account/leverage','POST','',JSON.stringify({
    symbol,marginType:'ISOLATED',isolatedLongLeverage:'10',isolatedShortLeverage:'10'
  })),
  closeById:(symbol,positionId)=>{
    if(!/^\d{1,30}$/.test(String(positionId)))throw Error('Invalid position id');
    return jsonFetch('/capi/v3/closePositions','POST','',JSON.stringify({symbol,positionId:String(positionId)}));
  }
};
export function verifyAccount(account) {
  if(!account||typeof account.canTrade!=='boolean'||typeof account.dualSidePosition!=='boolean')throw Error('Invalid account response');
  if(!account.canTrade)throw Error('Account cannot trade');
  // Fail closed: one-way position mode needs different order parameters.
  if(account.dualSidePosition!==true)throw Error('Enable dual-side/hedge position mode in WEEX first');
}
export function checkAvailableMargin(value) {
  if(!Array.isArray(value))throw Error('Cannot verify futures margin');
  const usdt=value.find(x=>x?.asset==='USDT');
  const available=Number(usdt?.availableBalance);
  if(!Number.isFinite(available)||available<55)throw Error('Need at least 55 available USDT for margin and fees');
}
export function checkPositions(value,symbol) {
  if(!Array.isArray(value))throw Error('Invalid WEEX positions');
  const active=[];
  for(const p of value){
    const size=Number(p.size);
    if(!Number.isFinite(size)||size<0||typeof p.symbol!=='string')throw Error('Unknown position');
    if(size>0)active.push(p);
  }
  if(active.length>=TRADE_LIMITS.maxConcurrent)throw Error('Maximum 3 positions reached');
  if(active.some(p=>p.symbol===symbol))throw Error('This coin already has an open position');
  return active.length;
}
export function checkOrders(orders) {
  if(!Array.isArray(orders))throw Error('Cannot verify pending orders');
  // Any pending opening order might add a position between prepare and confirm.
  if(orders.some(o=>o.reduceOnly!==true))throw Error('Pending opening order exists');
}
export function checkSymbolSettings(rows,symbol,allowSetup=false) {
  if(!Array.isArray(rows))throw Error('Invalid symbol settings');
  const cfg=rows.find(r=>r?.symbol===symbol);
  if(!cfg)throw Error('Symbol settings unavailable');
  if(cfg.separatedType!=='COMBINED')throw Error('Unsupported position separation mode');
  if(!['CROSSED','ISOLATED'].includes(cfg.marginType))throw Error('Unknown margin mode');
  const matched=cfg.marginType==='ISOLATED'&&
    Number(cfg.isolatedLongLeverage)===10&&
    Number(cfg.isolatedShortLeverage)===10;
  if(!matched&&!allowSetup)throw Error('Margin/leverage must be ISOLATED 10x');
  return matched;
}
export function marketPlan(signal,info,book,now=Date.now()) {
  const m=info?.symbols?.find(x=>x.symbol===signal.symbol);
  const b=(Array.isArray(book)?book:[book]).find(x=>x?.symbol===signal.symbol);
  return createReadOnlyPlan(signal,b,m,now);
}
export function clientOrderId(plan) {
  const fingerprint=[plan.symbol,plan.direction,plan.candleCloseTime].join(':');
  return 'radar-'+createHash('sha256').update(fingerprint).digest('hex').slice(0,25);
}
export function orderPayload(plan) {
  if(plan.exchange!=='WEEX'||!['LONG','SHORT'].includes(plan.direction) ||
    plan.leverage!==10||plan.marginUsdt!==50||!(plan.estimatedLossUsdt>0&&plan.estimatedLossUsdt<=10) ||
    !(plan.stopLoss>0&&plan.takeProfit>0))throw Error('Unsafe trade plan');
  if(plan.direction==='LONG'&&!(plan.stopLoss<plan.entryEstimate&&plan.takeProfit>plan.entryEstimate))throw Error('Wrong LONG stops');
  if(plan.direction==='SHORT'&&!(plan.stopLoss>plan.entryEstimate&&plan.takeProfit<plan.entryEstimate))throw Error('Wrong SHORT stops');
  return {
    symbol:plan.symbol, side:plan.direction==='LONG'?'BUY':'SELL',
    positionSide:plan.direction,type:'MARKET',quantity:String(plan.quantity),
    newClientOrderId:clientOrderId(plan),
    slTriggerPrice:String(plan.stopLoss),tpTriggerPrice:String(plan.takeProfit),
    SlWorkingType:'MARK_PRICE',TpWorkingType:'CONTRACT_PRICE',reduceOnly:false
  };
}
export function isAccepted(result,clientId) {
  return Boolean(result&&result.success===true&&String(result.orderId||'').length>0&&String(result.orderId)!=='0'&&
    result.clientOrderId===clientId);
}
export function requireSameOrigin(req) {
  const origin=String(req.headers.origin||'');
  const host=String(req.headers.host||'');
  // Only canonical production hostname may send a money-changing request.
  return origin==='https://weex-radar.vercel.app' && host==='weex-radar.vercel.app' &&
    String(req.headers['x-radar-trade-intent']||'')==='manual-confirm' &&
    String(req.headers['content-type']||'').toLowerCase().startsWith('application/json');
}
export function fingerprint(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}
