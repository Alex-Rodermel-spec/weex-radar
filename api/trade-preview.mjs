import { _test } from './signals.mjs';
import { createReadOnlyPlan, TRADE_LIMITS } from '../lib/trade-plan.mjs';
const SYMBOLS = new Set(_test.SYMBOLS);
async function fetchMarket(path) {
  const response = await fetch('https://api-contract.weex.com' + path, {
    signal:AbortSignal.timeout(6000),
    headers:{Accept:'application/json','User-Agent':'WEEX-RADAR/1.0'}
  });
  if (!response.ok) throw Error('WEEX market HTTP ' + response.status);
  return response.json();
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  const symbol = typeof req.query?.symbol === 'string' ? req.query.symbol : '';
  if (!SYMBOLS.has(symbol)) return res.status(400).json({error:'Unsupported symbol'});
  try {
    const signal = await _test.scanSymbol(symbol);
    if (signal.exchange !== 'WEEX' || !signal.direction)
      return res.status(409).json({error:'No fresh WEEX signal. Bybit backup data must never execute on WEEX.'});
    const [info,quotes] = await Promise.all([
      fetchMarket('/capi/v3/market/exchangeInfo?symbol=' + encodeURIComponent(symbol)),
      fetchMarket('/capi/v3/market/ticker/bookTicker?symbol=' + encodeURIComponent(symbol))
    ]);
    const market = info?.symbols?.find(item=>item.symbol===symbol);
    const quote = (Array.isArray(quotes)?quotes:[quotes]).find(item=>item?.symbol===symbol);
    const plan = createReadOnlyPlan(signal,quote,market);
    return res.status(200).json(plan);
  } catch (e) {
    return res.status(409).json({error:String(e?.message||e).slice(0,160),status:'PREVIEW_UNAVAILABLE',limits:TRADE_LIMITS});
  }
}
