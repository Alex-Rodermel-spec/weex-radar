// Manual release after owner has verified TP and SL directly in WEEX.
// Does NOT place or close orders.
import {get,put,del} from '@vercel/blob';
import {weex,validateHumanPassword,requireSameOrigin,fingerprint} from '../lib/weex-order.mjs';
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
    const [positions,orders]=await Promise.all([weex.positions(),weex.openOrders()]);
    if(!Array.isArray(positions)||!Array.isArray(orders))throw Error('Cannot reconcile WEEX orders');
    if(orders.some(x=>x.reduceOnly!==true))throw Error('Pending opening order; wait and check WEEX');
    const active=positions.filter(x=>Number(x.size)>0);
    if(active.length>3)throw Error('Too many positions; do not unlock');
    const same=active.filter(x=>x.symbol===lock.symbol);
    if(same.length!==1)throw Error('Expected exactly one open position on the traded coin; inspect manually');
    // Journaling never overwrites. This owner action is permanent.
    const path='trading/manual-release/'+lock.nonce+'.json';
    await put(path,JSON.stringify({symbol:lock.symbol,at:Date.now(),positionPresent:true}),
      {access:'private',allowOverwrite:false,addRandomSuffix:false,contentType:'application/json'});
    await del(LOCK);
    return res.status(200).json({ok:true,released:true,
      message:'You confirmed on WEEX that the live position has active Stop-Loss and Take-Profit. New proposals can be prepared.'});
  }catch(err){
    return res.status(409).json({error:String(err?.message||err).slice(0,150),released:false});
  }
}
