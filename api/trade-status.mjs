// Protected read-only status. Returns no secrets, identifiers or balances.
import {weex,configured,validateHumanPassword,requireSameOrigin,liveEnabled} from '../lib/weex-order.mjs';
import {TRADE_LIMITS} from '../lib/trade-plan.mjs';
// Translate numeric WEEX codes into safe guidance. Never forward raw response text.
export function describeConnectionFailure(err){
 const code=String(err?.message||'').match(/^WEEX_CODE_(-?\d{1,6})$/)?.[1];
 const known={
 '-1043':'Время запроса WEEX неверное.',
 '-1044':'WEEX не узнаёт API Key.',
 '-1046':'Время запроса истекло.',
 '-1047':'WEEX отклонил подпись API.',
 '-1049':'WEEX считает API Key или Passphrase неверными.',
 '-1051':'Доступ к аккаунту запрещён.',
 '-1052':'У API-ключа недостаточно прав.',
 '-1053':'Проверка прав API не пройдена.',
 '-1055':'WEEX требует дополнительную защиту аккаунта.',
 '-1056':'IP-адрес сервера не разрешён.',
 '40005':'WEEX отклонил время запроса.',
 '40006':'WEEX не узнаёт API Key.',
 '40008':'Время запроса истекло.',
 '40009':'WEEX отклонил подпись API.',
 '40012':'WEEX считает API Key или Passphrase неверными.',
 '40014':'У API-ключа недостаточно прав.',
 '40018':'IP-адрес сервера не разрешён.'
 };
 if(code)return {code,message:known[code]||'WEEX отклонил запрос (код '+code+').'};
 const http=String(err?.message||'').match(/^WEEX_HTTP_(\d{3})$/)?.[1];
 if(http)return {code:null,message:'WEEX вернул HTTP '+http+'. Авторизация не подтверждена.'};
 return {code:null,message:'Нет ответа WEEX или произошла ошибка связи. Ордер не отправлялся.'};
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireSameOrigin(req))return res.status(403).json({error:'Open official WEEX RADAR'});
  if(!validateHumanPassword(req.body?.password))return res.status(401).json({error:'Approval password not configured or incorrect'});
  if(!configured())return res.status(503).json({error:'WEEX keys missing'});
  // Separate the account and positions check so users see where the
  // read-only connection failed; never return secret details or balances.
  let account;
  try{account=await weex.account();}
  catch(err){const diagnostic=describeConnectionFailure(err);
    return res.status(502).json({ok:false,stage:'account',code:diagnostic.code,error:diagnostic.message});}
  if(typeof account?.canTrade!=='boolean'||typeof account?.dualSidePosition!=='boolean')
    return res.status(502).json({ok:false,stage:'accountFormat',
      error:'WEEX вернул неожиданный ответ аккаунта. Реальная торговля заблокирована.'});
  let positions;
  try{positions=await weex.positions();}
  catch(err){const diagnostic=describeConnectionFailure(err);
    return res.status(502).json({ok:false,stage:'positions',code:diagnostic.code,error:diagnostic.message});}
  if(!Array.isArray(positions))return res.status(502).json({ok:false,stage:'positionsFormat',
    error:'WEEX вернул неожиданный список позиций. Реальная торговля заблокирована.'});
  const active=positions.filter(x=>Number(x?.size)>0);
  return res.status(200).json({ok:true,connected:true,canTrade:account.canTrade,
    hedgeMode:account.dualSidePosition,openPositions:active.length,
    liveEnabled:liveEnabled(),marginUsdt:50,leverage:10,maxConcurrent:TRADE_LIMITS.maxConcurrent,
    note:'canTrade is not a proof of API Futures order permission. No order placed.'});
}
