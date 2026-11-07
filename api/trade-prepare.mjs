// POST: authenticated, one-time, server-side trade proposal. Never places orders.
import {randomBytes} from 'node:crypto';
import {put} from '@vercel/blob';
import {_test} from './signals.mjs';
import {weex,configured,validateHumanPassword,requireSameOrigin,liveEnabled,
  verifyAccount,checkAvailableMargin,checkPositions,checkOrders,marketPlan,fingerprint} from '../lib/weex-order.mjs';
async function createProposal(symbol) {
  const s=await _test.scanSymbol(symbol);
  if(s.status!=='ok'||s.exchange!=='WEEX'||!s.direction)throw Error('Нет нового подтверждённого сигнала WEEX');
  const [info,book,account,positions,orders,balance,apiTradingSymbols]=await Promise.all([
    weex.info(symbol),weex.book(symbol),weex.account(),weex.positions(),weex.openOrders(),weex.balance(),weex.apiTradingSymbols()
  ]);
  if(!Array.isArray(apiTradingSymbols)||!apiTradingSymbols.includes(symbol))
    throw Error('WEEX API Futures trading is not available for this symbol');
  verifyAccount(account);checkAvailableMargin(balance);
  const opened=checkPositions(positions,symbol);
  checkOrders(orders);
  const plan=marketPlan(s,info,book);
  return {...plan,opened,allowedConcurrent:3,requiresConfirmation:true};
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireSameOrigin(req))return res.status(403).json({error:'Use the official WEEX RADAR website'});
  if(!validateHumanPassword(req.body?.password))return res.status(401).json({error:'Wrong approval password or it is not configured'});
  if(!configured()||!process.env.BLOB_READ_WRITE_TOKEN)return res.status(503).json({error:'Account or private store not configured'});
  const symbol=req.body?.symbol;
  if(!_test.SYMBOLS.includes(symbol))return res.status(400).json({error:'Unsupported coin'});
  try{
    const plan=await createProposal(symbol);
    // Proposal and token are usable once, for at most 45 seconds.
    const token=randomBytes(32).toString('hex');
    const expiresAt=Math.min(plan.expiresAt,Date.now()+45000);
    await put('trading/proposals/'+fingerprint(token)+'.json',
      JSON.stringify({plan,expiresAt}),
      {access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json'});
    return res.status(200).json({ok:true,proposal:token,expiresAt,
      liveEnabled:liveEnabled(),trade:plan,
      note:'No order was placed. Review all details and explicitly confirm.'});
  }catch(err){
    return res.status(409).json({error:String(err?.message||'Unable to prepare proposal').slice(0,160)});
  }
}
