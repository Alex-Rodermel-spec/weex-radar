// POST-only same-origin login/status/logout. No WEEX account calls or order writes.
// Session cookie is HttpOnly (JavaScript cannot read it) and expires after 30m.
import {requireSameOrigin,validateHumanPassword} from '../lib/weex-order.mjs';
import {
 issueTradeSession,authenticatedTradeSession,cookieForSession,cookieForLogout,
 SESSION_SECONDS
} from '../lib/trade-session.mjs';

export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 if(!requireSameOrigin(req))return res.status(403).json({error:'Open official WEEX RADAR website'});
 const action=req.body?.action;
 if(action==='status'){
  const session=authenticatedTradeSession(req);
  return res.status(200).json({ok:true,authenticated:Boolean(session),
   expiresAt:session?.expiresAt||null,minutes:SESSION_SECONDS/60});
 }
 if(action==='logout'){
  res.setHeader('Set-Cookie',cookieForLogout());
  return res.status(200).json({ok:true,authenticated:false});
 }
 if(action!=='login')return res.status(400).json({error:'Invalid session action'});
 if(!validateHumanPassword(req.body?.password))
  return res.status(401).json({error:'Неверный пароль RADAR. Сессия не создана.'});
 const session=issueTradeSession();
 res.setHeader('Set-Cookie',cookieForSession(session.token));
 return res.status(200).json({ok:true,authenticated:true,
  expiresAt:session.expiresAt,minutes:SESSION_SECONDS/60,
  note:'30-minute secure session. Every real order still needs explicit approval.'});
}
