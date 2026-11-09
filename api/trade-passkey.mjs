// Android fingerprint/PIN Passkey registration and sign-in.
// Registration requires existing password-authenticated RADAR session.
// Trade approval is checked later inside /api/trade-confirm, not here.
import {get} from '@vercel/blob';
import {requireSameOrigin} from '../lib/weex-order.mjs';
import {authenticatedTradeSession} from '../lib/trade-session.mjs';
import {
 readPasskey,registrationOptions,registrationFinish,
 authenticationOptions,authenticatedAssertion,sessionForPasskey,
 tradeContext,clearFlowCookie
} from '../lib/trade-passkey.mjs';
import {fingerprint} from '../lib/weex-order.mjs';

export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 if(!requireSameOrigin(req))return res.status(403).json({error:'Open official RADAR website'});
 const action=req.body?.action;
 try{
  if(action==='status'){
   const session=authenticatedTradeSession(req);
   if(!session)return res.status(200).json({ok:true,loggedIn:false,enrolled:null});
   const record=await readPasskey();
   return res.status(200).json({ok:true,loggedIn:true,enrolled:Boolean(record)});
  }
  if(action==='register-begin'){
   if(!authenticatedTradeSession(req))return res.status(401).json({error:'Enter RADAR password once to enable fingerprint'});
   if(await readPasskey())return res.status(409).json({error:'Passkey already registered; do not overwrite it'});
   const {options,flow}=await registrationOptions();
   res.setHeader('Set-Cookie',flow.cookie);
   return res.status(200).json({ok:true,options});
  }
  if(action==='register-finish'){
   if(!authenticatedTradeSession(req))return res.status(401).json({error:'RADAR login required'});
   if(await readPasskey())return res.status(409).json({error:'Passkey already registered'});
   if(!req.body?.response)return res.status(400).json({error:'Missing device response'});
   const done=await registrationFinish(req,req.body.response);
   res.setHeader('Set-Cookie',clearFlowCookie());
   return res.status(200).json({...done,enrolled:true});
  }
  if(action==='login-begin'){
   const record=await readPasskey();
   if(!record)return res.status(409).json({error:'First sign in with password and register phone passkey'});
   const {options,flow}=await authenticationOptions('login','',record);
   res.setHeader('Set-Cookie',flow.cookie);
   return res.status(200).json({ok:true,options});
  }
  if(action==='login-finish'){
   const record=await readPasskey();
   if(!record)return res.status(409).json({error:'Passkey not registered'});
   await authenticatedAssertion(req,req.body?.response,'login','',record);
   const s=sessionForPasskey();
   res.setHeader('Set-Cookie',[s.cookie,clearFlowCookie()]);
   return res.status(200).json({ok:true,authenticated:true,expiresAt:s.expiresAt});
  }
  if(action==='trade-begin'){
   if(!authenticatedTradeSession(req))return res.status(401).json({error:'RADAR session expired; sign in again'});
   const record=await readPasskey();
   if(!record)return res.status(409).json({error:'Passkey not registered; use manual confirmation'});
   const proposal=req.body?.proposal;
   if(typeof proposal!=='string'||!/^[a-f0-9]{64}$/.test(proposal))
    return res.status(400).json({error:'Invalid manual trade proposal'});
   const row=await get('trading/proposals/'+fingerprint(proposal)+'.json',{access:'private'});
   if(!row)return res.status(409).json({error:'Proposal not found'});
   const p=JSON.parse(await new Response(row.stream).text());
   if(!Number.isFinite(p?.expiresAt)||Date.now()>p.expiresAt-12000)
    return res.status(409).json({error:'Trade proposal expired. Prepare a new one.'});
   const {options,flow}=await authenticationOptions('trade',tradeContext(proposal),record);
   res.setHeader('Set-Cookie',flow.cookie);
   return res.status(200).json({ok:true,required:true,options,
    note:'This is a one-time device verification for a single manually reviewed order.'});
  }
  return res.status(400).json({error:'Unsupported passkey action'});
 }catch{
  return res.status(409).json({error:'Проверка отпечатка / Passkey не завершена. Повтори действие. Реальный ордер не отправлялся.'});
 }
}
