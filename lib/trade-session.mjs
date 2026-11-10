// Time-limited same-browser trade approval session; every live order still needs fresh confirmation.
// A signed HttpOnly + Secure + SameSite=Strict cookie is issued ONLY after
// verifying the existing owner password. The password is never persisted
// client-side or sent with individual order requests.
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

export const SESSION_SECONDS=24*60*60;
export const SESSION_COOKIE='__Host-radar-trade-session';
const MAX_TTL=SESSION_SECONDS*1000;
const PREFIX='WEEX-RADAR:trade-session:v1:';
const DATE_PATTERN=/^v1\.(\d{13})\.(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/;

function key(env=process.env){
 const password=env?.WEEX_TRADE_APPROVAL_PASSWORD;
 if(typeof password!=='string'||password.length<20)return null;
 return createHash('sha256').update(PREFIX).update(password).digest();
}
function mac(base,secret){
 return createHmac('sha256',secret).update(base).digest('hex');
}
export function issueTradeSession(now=Date.now(),env=process.env){
 const secret=key(env);
 if(!secret||!Number.isSafeInteger(now)||now<1_000_000_000_000)
  throw Error('Session authentication unavailable');
 const expiresAt=now+MAX_TTL;
 const nonce=randomBytes(16).toString('hex');
 const base=['v1',now,expiresAt,nonce].join('.');
 return {token:base+'.'+mac(base,secret),expiresAt};
}
export function verifyTradeSession(token,now=Date.now(),env=process.env){
 const secret=key(env);
 if(!secret||typeof token!=='string'||token.length>200||!Number.isSafeInteger(now))
  return null;
 const match=DATE_PATTERN.exec(token);
 if(!match)return null;
 const issuedAt=Number(match[1]),expiresAt=Number(match[2]);
 if(!Number.isSafeInteger(issuedAt)||!Number.isSafeInteger(expiresAt)||
   issuedAt>now+5000||issuedAt<now-MAX_TTL||
   expiresAt-issuedAt!==MAX_TTL||now>=expiresAt)return null;
 const expected=Buffer.from(mac(token.slice(0,token.lastIndexOf('.')),secret),'hex');
 const received=Buffer.from(match[4],'hex');
 if(received.length!==expected.length||!timingSafeEqual(received,expected))return null;
 return {expiresAt};
}
function cookieValue(req){
 const raw=String(req?.headers?.cookie||'');
 if(raw.length>8192)return null;
 const values=raw.split(';').map(s=>s.trim()).filter(x=>x.startsWith(SESSION_COOKIE+'='));
 if(values.length!==1)return null;
 const value=values[0].slice(SESSION_COOKIE.length+1);
 return value.length<=200?value:null;
}
export function authenticatedTradeSession(req,now=Date.now(),env=process.env){
 return verifyTradeSession(cookieValue(req),now,env);
}
export function cookieForSession(token){
 if(typeof token!=='string'||!DATE_PATTERN.test(token))throw Error('Invalid session token');
 return SESSION_COOKIE+'='+token+
   '; Max-Age='+SESSION_SECONDS+'; Path=/; Secure; HttpOnly; SameSite=Strict';
}
export function cookieForLogout(){
 return SESSION_COOKIE+'=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict';
}
