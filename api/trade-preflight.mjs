// Password-protected WEEX readiness probe. Only read-only requests.
import {weex,configured,validateHumanPassword,requireSameOrigin,liveEnabled} from '../lib/weex-order.mjs';
import {_test} from './signals.mjs';
import {readinessSummary} from '../lib/trade-readiness.mjs';
export default async function handler(req,res) {
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 if(!requireSameOrigin(req))return res.status(403).json({error:'Open official WEEX RADAR'});
 if(!validateHumanPassword(req.body?.password))return res.status(401).json({error:'Wrong RADAR approval password'});
 if(!configured())return res.status(503).json({error:'WEEX connection not configured'});
 const symbol=req.body?.symbol;
 if(!_test.SYMBOLS.includes(symbol))return res.status(400).json({error:'Unsupported coin'});
 try {
  const [account,balance,positions,orders,settings,info,book,apiTradingSymbols]=await Promise.all([
   weex.account(),weex.balance(),weex.positions(),weex.openOrders(),
   weex.symbolConfig(symbol),weex.info(symbol),weex.book(symbol),weex.apiTradingSymbols()
  ]);
  const summary=readinessSummary({symbol,account,balance,positions,orders,settings,info,book,apiTradingSymbols});
  return res.status(200).json({ok:true,...summary,liveEnabled:liveEnabled(),
   note:'Read-only. Account flag does not prove API Futures order permission or TP/SL execution.'});
 }catch(err) {
  const code=String(err?.message||'').match(/^WEEX_CODE_(-?\d{1,6})$/)?.[1]||null;
  return res.status(502).json({ok:false,error:'WEEX read-only preflight failed. No order was sent.',code});
 }
}
