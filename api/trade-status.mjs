// Protected read-only status. Returns no secrets, identifiers or balances.
import {weex,configured,validateHumanPassword,requireSameOrigin,liveEnabled} from '../lib/weex-order.mjs';
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireSameOrigin(req))return res.status(403).json({error:'Open official WEEX RADAR'});
  if(!validateHumanPassword(req.body?.password))return res.status(401).json({error:'Approval password not configured or incorrect'});
  if(!configured())return res.status(503).json({error:'WEEX keys missing'});
  try{
    const account=await weex.account();
    if(typeof account?.canTrade!=='boolean'||typeof account?.dualSidePosition!=='boolean')
      throw Error('WEEX credentials rejected or unexpected response');
    const positions=await weex.positions();
    if(!Array.isArray(positions))throw Error('Position read failed');
    const active=positions.filter(x=>Number(x?.size)>0);
    return res.status(200).json({ok:true,connected:true,canTrade:account.canTrade,
      hedgeMode:account.dualSidePosition,openPositions:active.length,
      liveEnabled:liveEnabled(),marginUsdt:50,leverage:10,maxConcurrent:3,
      note:'canTrade means account capability, not API Futures permission. No order placed.'});
  }catch{
    return res.status(502).json({ok:false,connected:false,
      error:'WEEX did not accept the authenticated read-only check. Check key permission and server IP.'});
  }
}
