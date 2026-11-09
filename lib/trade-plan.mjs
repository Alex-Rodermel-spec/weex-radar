// Read-only futures trade plans. This module must never place exchange orders.
import {assessNetCosts,COST_MIN_NET_RR} from './net-costs.mjs';
export const TRADE_LIMITS = Object.freeze({
  // Two bot-owned positions; manually opened WEEX positions are accounted
  // for separately. All account-level free collateral checks remain active.
  marginUsdt: 50, leverage: 10, maxConcurrent: 2, maxRiskUsdt: 10
});
function number(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw Error('Invalid ' + name);
  return n;
}
function digits(value, max = 12) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) throw Error('Invalid market precision');
  return n;
}
function quantize(value, precision, direction) {
  const factor = 10 ** precision;
  const scaled = value * factor;
  const rounded = direction === 'down' ? Math.floor(scaled + 1e-8) : Math.ceil(scaled - 1e-8);
  return Number((rounded / factor).toFixed(precision));
}
export function effectiveQuantityPrecision(market){
 if(!market||typeof market!=='object')throw Error('Invalid market precision');
 const primary=Number(market.quantityPrecision);
 return digits(primary===-1?market.baseAssetPrecision:primary);
}
export function createReadOnlyPlan(signal, book, market, now = Date.now()) {
  if (!signal || signal.status !== 'ok' || signal.exchange !== 'WEEX' ||
      !['LONG', 'SHORT'].includes(signal.direction)) throw Error('No confirmed WEEX signal');
  if (!Number.isFinite(signal.expiresAt) || signal.expiresAt < now + 30000) throw Error('Signal expired or too close to expiry');
  if (!Number.isFinite(signal.candleCloseTime) || now - signal.candleCloseTime > 180000) throw Error('Signal too old');
  const bTime = Number(book.time);
  if (!Number.isFinite(bTime) || Math.abs(now - bTime) > 30000) throw Error('Outdated order book');
  const side = signal.direction;
  const entry = number(side === 'LONG' ? book.askPrice : book.bidPrice, 'entry price');
  const bid = number(book.bidPrice, 'bid');
  const ask = number(book.askPrice, 'ask');
  if (ask < bid) throw Error('Crossed order book');
  const reference = number(signal.price, 'signal price');
  if (Math.abs(entry / reference - 1) > 0.005) throw Error('Price moved too far from signal');
  if (!market || market.symbol !== signal.symbol ||
      market.quoteAsset !== 'USDT' || market.marginAsset !== 'USDT' ||
      market.contractType !== 'PERPETUAL' ||
      !market.forwardContractFlag || Number(market.maxLeverage) < TRADE_LIMITS.leverage)
    throw Error('Futures contract unavailable or unsupported');
  // WEEX may publish quantityPrecision=-1 for certain contracts.
  // In that case use the separately published base-asset quantity precision.
  // Other negative/invalid precision values remain blocked.
  const quantityPrecision=effectiveQuantityPrecision(market);
  const pricePrecision = digits(market.pricePrecision);
  const qty = quantize(TRADE_LIMITS.marginUsdt * TRADE_LIMITS.leverage / entry, quantityPrecision, 'down');
  const minimum = number(market.minOrderSize, 'minimum size');
  const maximum = number(market.marketOpenLimitSize || market.maxOrderSize, 'market maximum');
  if (qty < minimum || qty > maximum || qty <= 0) throw Error('Order size outside market limits');
  const stop = quantize(number(signal.stop, 'stop'), pricePrecision, side === 'LONG' ? 'down' : 'up');
  const take = quantize(number(signal.take, 'take'), pricePrecision, side === 'LONG' ? 'up' : 'down');
  if (side === 'LONG' ? !(stop < entry && take > entry) : !(take < entry && stop > entry))
    throw Error('Stop/take are invalid for current price');
  const risk = qty * Math.abs(entry - stop);
  const reward = qty * Math.abs(take - entry);
  if (!(risk > 0 && risk <= TRADE_LIMITS.maxRiskUsdt) || reward / risk < 1.2)
    throw Error('Trade exceeds risk cap or has poor reward/risk');
  const notional = qty * entry;
  if (notional > 500.00001 || notional < 475) throw Error('Calculated notional outside permitted range');
  // HARD execution gate: unlike advisory SHADOW_COSTS, this plan rejects
  // trades with weak net reward/risk or >10 USDT modeled stop loss AFTER
  // round-trip taker fees, current bid/ask spread and assumed slippage.
  // Unknown account-specific fees, future spread, funding and gaps remain risks.
  const mid=(bid+ask)/2;
  const costs=assessNetCosts({
    exchange:'WEEX',direction:side,entryMid:mid,stop,take,bid,ask
  });
  if(!costs||costs.status!=='PASS_ESTIMATE'||
     !Number.isFinite(costs.netRR)||costs.netRR<COST_MIN_NET_RR)
    throw Error('Estimated WEEX costs make net reward/risk unacceptable');
  const midNotional=qty*mid;
  const rawNetLoss=midNotional*costs.netStopLossBps/10000;
  const rawNetProfit=midNotional*costs.netTargetBps/10000;
  if(!Number.isFinite(rawNetLoss)||!Number.isFinite(rawNetProfit)||
     rawNetLoss<=0||rawNetProfit<=0||rawNetLoss>TRADE_LIMITS.maxRiskUsdt)
    throw Error('Trade exceeds 10 USDT estimated risk after fees and slippage');
  // Round the displayed modeled loss UP and the profit DOWN.
  const netLoss=Math.ceil((rawNetLoss-1e-10)*10000)/10000;
  const netProfit=Math.floor((rawNetProfit+1e-10)*10000)/10000;
  if(netLoss>TRADE_LIMITS.maxRiskUsdt)
    throw Error('Trade exceeds 10 USDT estimated risk after fees and slippage');
  return {
    status:'PREVIEW_ONLY', canPlaceOrder:false, symbol:signal.symbol, exchange:'WEEX',
    direction:side, level:signal.level, marginUsdt:TRADE_LIMITS.marginUsdt,
    leverage:TRADE_LIMITS.leverage, maxConcurrent:TRADE_LIMITS.maxConcurrent,
    quantity:String(qty), entryEstimate:entry, stopLoss:stop, takeProfit:take,
    notionalEstimate:Number(notional.toFixed(4)),
    estimatedLossUsdt:Number(risk.toFixed(4)), estimatedProfitUsdt:Number(reward.toFixed(4)),
    riskReward:Number((reward/risk).toFixed(2)),
    estimatedNetLossUsdt:netLoss,estimatedNetProfitUsdt:netProfit,
    estimatedNetRR:costs.netRR,costGate:'PASS_ESTIMATE',
    estimatedExtraCostsAtStopUsdt:Math.max(0,Number((netLoss-risk).toFixed(4))),
    costAssumptions:{
      feeBpsEachSide:costs.feeBpsEachSide,
      slippageBpsEachSide:costs.slippageBpsEachSide,
      observedSpreadBps:costs.observedSpreadBps
    },
    candleCloseTime:signal.candleCloseTime, expiresAt:signal.expiresAt,
    generatedAt:now,
    warning:'Estimated net costs are a mandatory plan filter, NOT a loss guarantee. Real account fees, funding, fill prices, price gaps and liquidation can exceed the estimate.'
  };
}
