import {effectiveQuantityPrecision,TRADE_LIMITS} from './trade-plan.mjs';
// Read-only sanity checks against WEEX Futures. Never place an order.
export function readinessSummary({symbol,account,balance,positions,orders,settings,info,book,apiTradingSymbols,portfolio},now=Date.now()) {
 const validPositions=Array.isArray(positions)&&positions.every(p=>
   typeof p?.symbol==='string'&&Number.isFinite(Number(p?.size))&&Number(p.size)>=0);
 const active=validPositions?positions.filter(p=>Number(p.size)>0):[];
 const usdt=Array.isArray(balance)?balance.find(b=>b?.asset==='USDT'):null;
 const available=Number(usdt?.availableBalance);
 const cfg=Array.isArray(settings)?settings.find(s=>s?.symbol===symbol):null;
 const market=Array.isArray(info?.symbols)?info.symbols.find(s=>s?.symbol===symbol):null;
 const quote=(Array.isArray(book)?book:[book]).find(b=>b?.symbol===symbol);
 const bid=Number(quote?.bidPrice),ask=Number(quote?.askPrice),time=Number(quote?.time);
 const checks={
  accountTradeFlag:account?.canTrade===true,
  hedgeMode:account?.dualSidePosition===true,
  collateral55Usdt:Number.isFinite(available)&&available>=55,
  positionCapacity:validPositions&&portfolio?.active?.length===active.length&&
    Array.isArray(portfolio?.bot)&&Array.isArray(portfolio?.manual)&&
    portfolio.bot.length+portfolio.manual.length===active.length&&
    portfolio.bot.length<TRADE_LIMITS.maxConcurrent,
  noSameCoinPosition:validPositions&&!active.some(p=>p.symbol===symbol),
  noPendingEntryOrders:Array.isArray(orders)&&orders.every(o=>o?.reduceOnly===true),
  apiListed:Array.isArray(apiTradingSymbols)&&apiTradingSymbols.includes(symbol),
  supportedMarket:market?.quoteAsset==='USDT'&&market?.marginAsset==='USDT'&&
   market?.contractType==='PERPETUAL'&&market?.forwardContractFlag===true&&
   Number(market?.maxLeverage)>=10&&Number(market?.minOrderSize)>0,
  freshOrderBook:Number.isFinite(time)&&Math.abs(now-time)<=30000&&bid>0&&ask>=bid,
  quantityPrecisionValid:(()=>{
    try {effectiveQuantityPrecision(market);return true}catch{return false}
  })(),
  compatiblePositionSettings:cfg?.separatedType==='COMBINED'&&
   ['CROSSED','ISOLATED'].includes(cfg?.marginType)
 };
 const isolated10x=Boolean(cfg?.marginType==='ISOLATED'&&
  Number(cfg?.isolatedLongLeverage)===10&&Number(cfg?.isolatedShortLeverage)===10);
 return {
  symbol,
  checks,
  passed:Object.values(checks).every(Boolean),
  openPositions:active.length,
  botOpenPositions:portfolio?.botOpenPositions??null,
  manualOpenPositions:portfolio?.manualOpenPositions??null,
  isolated10x,
  requiresLeverageSetup:checks.compatiblePositionSettings&&!isolated10x,
  apiOrderPermission:'NOT_VERIFIED',
  ordersSent:0
 };
}
