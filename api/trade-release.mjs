// Manual release after owner has verified TP and SL directly in WEEX.
// Does NOT place or close orders.
import {get,put,del} from '@vercel/blob';
import {weex,requireSameOrigin} from '../lib/weex-order.mjs';
import {authenticatedTradeSession} from '../lib/trade-session.mjs';
import {verifyActiveProtection} from '../lib/trade-protection.mjs';
import {TRADE_LIMITS} from '../lib/trade-plan.mjs';
import {readOwnedPortfolio,verifyOtherBotProtection} from '../lib/trade-ownership.mjs';
const LOCK='trading/execution-global.lock';
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireSameOrigin(req))return res.status(403).json({error:'Open official WEEX RADAR'});
  if(!authenticatedTradeSession(req))return res.status(401).json({error:'Сессия RADAR истекла. Войди ещё раз.'});
  if(req.body?.confirmation!=='CHECKED_TP_SL_ON_WEEX')
    return res.status(400).json({error:'Confirm that you personally verified TP and SL on WEEX'});
  try{
    const record=await get(LOCK,{access:'private'});
    if(!record)return res.status(409).json({error:'No outstanding trade lock'});
    const lock=JSON.parse(await new Response(record.stream).text());
    if(!/^[A-Z0-9]{4,24}$/.test(lock.symbol)||!/^[a-f0-9]{64}$/.test(lock.nonce||''))
      return res.status(409).json({error:'Invalid lock; manual support required'});
    if(!['LONG','SHORT'].includes(lock.direction)||!(Number(lock.stopLoss)>0)||!(Number(lock.takeProfit)>0))
      throw Error('Missing verified risk limits in trade lock. Manual review required.');
    const [positions,orders,algoOrders]=await Promise.all([
      weex.positions(),weex.openOrders(),weex.openAlgoOrders(lock.symbol)
    ]);
    if(!Array.isArray(positions)||!Array.isArray(orders))throw Error('Cannot reconcile WEEX orders');
    if(orders.some(x=>x.reduceOnly!==true))throw Error('Pending opening order; wait and check WEEX');
    const portfolio=await readOwnedPortfolio(positions);
    if(portfolio.botOpenPositions>TRADE_LIMITS.maxConcurrent)
      throw Error('Exceeded RADAR position cap. Do not unlock');
    const active=portfolio.active;
    const same=active.filter(x=>x.symbol===lock.symbol);
    if(same.length!==1||same[0].side!==lock.direction)
      throw Error('Expected exactly one matching position; inspect WEEX.');
    if(!portfolio.bot.some(({position:p})=>p.symbol===lock.symbol&&p.side===lock.direction))
      throw Error('Locked position lacks verified RADAR ownership; manual review required');
    await verifyOtherBotProtection(portfolio,sym=>sym===lock.symbol?
      Promise.resolve(algoOrders):weex.openAlgoOrders(sym));
    const protection=verifyActiveProtection(algoOrders,lock,same[0]);
    if(!protection.verified)
      throw Error('WEEX has not verified BOTH active closing Stop-Loss and Take-Profit orders. Trade lock stays.');
    // Journaling never overwrites. This owner action is permanent.
    const path='trading/manual-release/'+lock.nonce+'.json';
    await put(path,JSON.stringify({symbol:lock.symbol,at:Date.now(),positionPresent:true,protectionVerified:true}),
      {access:'private',allowOverwrite:false,addRandomSuffix:false,contentType:'application/json'});
    await del(LOCK);
    return res.status(200).json({ok:true,released:true,
      message:'WEEX verified active closing Stop-Loss and Take-Profit orders. New proposals can be prepared.'});
  }catch(err){
    return res.status(409).json({error:String(err?.message||err).slice(0,150),released:false});
  }
}
