// WEEX RADAR owner Passkey/WebAuthn: private key remains on Android.
// Store only public-key material in the already configured private Vercel Blob.
// An active passkey must authorize EACH real trade, in addition to the
// explicit manual 45s trade proposal. No biometric data reaches the server.
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {get,put} from '@vercel/blob';
import {
 generateRegistrationOptions,verifyRegistrationResponse,
 generateAuthenticationOptions,verifyAuthenticationResponse
} from '@simplewebauthn/server';
import {authenticatedTradeSession,issueTradeSession,cookieForSession} from './trade-session.mjs';

export const RP_ID='weex-radar.vercel.app',ORIGIN='https://weex-radar.vercel.app';
const RECORD='trading/passkey-v1/owner.json';
const FLOW_COOKIE='__Host-radar-passkey-flow';
const FLOW_TTL=90_000;
const B64=/^[A-Za-z0-9_-]{16,1024}$/;
const CRED=/^[A-Za-z0-9_-]{16,600}$/;
const h=x=>createHash('sha256').update(String(x)).digest('hex');
const secret=()=>{
 const p=process.env.WEEX_TRADE_APPROVAL_PASSWORD;
 if(typeof p!=='string'||p.length<20)throw Error('Passkey requires configured RADAR approval secret');
 return createHash('sha256').update('WEEX-RADAR-passkey-v1\0'+p).digest();
};
const sig=x=>createHmac('sha256',secret()).update(x).digest('hex');
function eq(a,b){
 if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length||a.length!==64)return false;
 return timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
}
const validateStored=r=>{
 if(!r||r.v!==1||!CRED.test(r.id)||!B64.test(r.publicKey)||
   !Number.isSafeInteger(r.counter)||r.counter<0||!Array.isArray(r.transports)||
   r.transports.length>8||!r.transports.every(x=>typeof x==='string'&&x.length<30))
  throw Error('Private Passkey record invalid; live trading blocked');
 return r;
};
export async function readPasskey(read=get){
 const f=await read(RECORD,{access:'private'});
 if(!f)return null;
 const raw=await new Response(f.stream).text();
 if(raw.length>4000)throw Error('Passkey record too large');
 return validateStored(JSON.parse(raw));
}
export async function storePasskey(record,overwrite=false,putFn=put){
 return putFn(RECORD,JSON.stringify(validateStored(record)),{
  access:'private',allowOverwrite:overwrite,addRandomSuffix:false,contentType:'application/json'
 });
}
export function newFlow(mode,challenge,context='',now=Date.now()){
 if(!['register','login','trade'].includes(mode)||!B64.test(challenge)||
   typeof context!=='string'||context.length>80)throw Error('Invalid passkey flow');
 const x={v:1,mode,challenge,context,expiresAt:now+FLOW_TTL,nonce:randomBytes(16).toString('hex')};
 const body=Buffer.from(JSON.stringify(x)).toString('base64url');
 return {cookie:FLOW_COOKIE+'='+body+'.'+sig(body)+
  '; Max-Age=90; Path=/; Secure; HttpOnly; SameSite=Strict',challenge};
}
export function clearFlowCookie(){
 return FLOW_COOKIE+'=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict';
}
export function requiredFlow(req,mode,context='',now=Date.now()){
 const raw=String(req?.headers?.cookie||'');
 if(raw.length>8192)throw Error('Passkey challenge cookie unavailable');
 const matches=raw.split(';').map(x=>x.trim()).filter(x=>x.startsWith(FLOW_COOKIE+'='));
 if(matches.length!==1)throw Error('Passkey challenge missing; retry device verification');
 const value=matches[0].slice(FLOW_COOKIE.length+1);
 const dot=value.lastIndexOf('.');
 if(dot<1||value.length>1100)throw Error('Bad passkey challenge');
 const body=value.slice(0,dot),tag=value.slice(dot+1);
 if(!eq(tag,sig(body)))throw Error('Invalid passkey challenge signature');
 const flow=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
 if(flow?.v!==1||flow.mode!==mode||flow.context!==context||
   !B64.test(flow.challenge)||!Number.isSafeInteger(flow.expiresAt)||
   now>=flow.expiresAt||now<flow.expiresAt-FLOW_TTL-5000||
   !/^[a-f0-9]{32}$/.test(flow.nonce))
  throw Error('Passkey challenge expired; retry device verification');
 return flow;
}
export async function registrationOptions(){
 const options=await generateRegistrationOptions({
  rpName:'WEEX RADAR',rpID:RP_ID,userName:'RADAR owner',
  userID:new Uint8Array(createHash('sha256').update('WEEX RADAR owner credential').digest()),
  attestationType:'none',authenticatorSelection:{
   authenticatorAttachment:'platform',residentKey:'preferred',userVerification:'required'
  },supportedAlgorithmIDs:[-7,-257],timeout:60000
 });
 return {options,flow:newFlow('register',options.challenge)};
}
export async function registrationFinish(req,body){
 const flow=requiredFlow(req,'register');
 const result=await verifyRegistrationResponse({
  response:body,expectedChallenge:flow.challenge,expectedOrigin:ORIGIN,
  expectedRPID:RP_ID,requireUserVerification:true
 });
 if(!result.verified||!result.registrationInfo?.credential)throw Error('Phone did not verify new passkey');
 const c=result.registrationInfo.credential;
 const record={v:1,id:c.id,publicKey:Buffer.from(c.publicKey).toString('base64url'),
  counter:c.counter,transports:c.transports||[]};
 await storePasskey(record,false);
 return {ok:true};
}
export async function authenticationOptions(mode,context='',record){
 const r=validateStored(record);
 const options=await generateAuthenticationOptions({
  rpID:RP_ID,userVerification:'required',timeout:60000,
  allowCredentials:[{id:r.id,transports:r.transports}]
 });
 return {options,flow:newFlow(mode,options.challenge,context)};
}
export async function authenticatedAssertion(req,response,mode,context='',record){
 const flow=requiredFlow(req,mode,context);
 const r=validateStored(record);
 if(!response||response.id!==r.id)throw Error('Unknown RADAR passkey');
 const result=await verifyAuthenticationResponse({
  response,expectedChallenge:flow.challenge,expectedOrigin:ORIGIN,
  expectedRPID:RP_ID,requireUserVerification:true,
  credential:{id:r.id,publicKey:Uint8Array.from(Buffer.from(r.publicKey,'base64url')),
   counter:r.counter,transports:r.transports}
 });
 if(!result.verified||!result.authenticationInfo?.userVerified)
  throw Error('Device did not verify the owner');
 const c=result.authenticationInfo.newCounter;
 if(!Number.isSafeInteger(c)||c<r.counter)throw Error('Passkey counter invalid');
 if(c>r.counter)await storePasskey({...r,counter:c},true);
 return true;
}
export const tradeContext=proposal=>h(proposal);
export async function verifyLiveTradePasskey(req,proposal){
 // Fail closed if private store is unreachable; no bypass to password
 // when a passkey has been enrolled.
 const record=await readPasskey();
 if(!record)return {required:false};
 await authenticatedAssertion(req,req.body?.passkeyAssertion,'trade',tradeContext(proposal),record);
 return {required:true};
}
export const sessionForPasskey=()=>{const s=issueTradeSession();return {
  expiresAt:s.expiresAt,cookie:cookieForSession(s.token)
}};
export const ownerSession=req=>Boolean(authenticatedTradeSession(req));
