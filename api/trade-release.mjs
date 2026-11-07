// Manual release after owner has verified TP and SL directly in WEEX.
// Does NOT place or close orders.
import {get,put,del} from '@vercel/blob';
import {weex,validateHumanPassword,requireSameOrigin} from '../lib/weex-order.mjs';
import {verifyActiveProtection} from '../lib/trade-protection.mjs';
const LOCK='trading/execution-global.lock';
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireSameOrigin(req))return res.status(403).json({error:'Open official WEEX RADAR'});
  if(!validateHumanPassword(req.body?.password))return res.status(401).json({error:'Approval password incorrect'});
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
    const active=positions.filter(x=>Number(x.size)>0);
    if(active.length>3)throw Error('Too many positions; do not unlock');
    const same=active.filter(x=>x.symbol===lock.symbol);
    if(same.length!==1||same[0].side!==lock.direction)
      throw Error('Expected exactly one matching position; inspect WEEX.');
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
