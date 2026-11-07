// GitHub-OIDC-only, read-only WEEX Futures connection probe.
// Never expose credentials, balances, account IDs, positions, or raw exchange replies.
import {jwtVerify,createRemoteJWKSet} from 'jose';
import {weex,configured} from '../lib/weex-order.mjs';
const jwks=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
export async function validProbeToken(token,verify=jwtVerify) {
  if(typeof token!=='string'||!token||token.length>8000)return false;
  try{
    const {payload}=await verify(token,jwks,{issuer:'https://token.actions.githubusercontent.com',
      audience:'weex-radar-auth-probe'});
    return payload.repository==='Alex-Rodermel-spec/weex-radar'&&
      payload.ref==='refs/heads/main'&&payload.event_name==='push'&&
      payload.workflow_ref==='Alex-Rodermel-spec/weex-radar/.github/workflows/weex-auth-probe.yml@refs/heads/main';
  }catch{return false}
}
export function safeProbeError(error) {
  const code=String(error?.message||'').match(/^WEEX_CODE_(-?\d{1,6})$/)?.[1];
  if(code)return {stage:'api',code};
  const http=String(error?.message||'').match(/^WEEX_HTTP_(\d{3})$/)?.[1];
  if(http)return {stage:'http',code:http};
  return {stage:'network_or_response',code:null};
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({ok:false});
  const auth=String(req.headers.authorization||'');
  if(!auth.startsWith('Bearer ')||!(await validProbeToken(auth.slice(7))))
    return res.status(401).json({ok:false});
  if(!configured())return res.status(503).json({ok:false,stage:'missing_credentials'});
  try{
    const account=await weex.account();
    if(typeof account?.canTrade!=='boolean'||typeof account?.dualSidePosition!=='boolean')
      return res.status(502).json({ok:false,stage:'unexpected_account_schema'});
    return res.status(200).json({ok:true,stage:'authenticated',ordersSent:0});
  }catch(error){
    return res.status(502).json({ok:false,...safeProbeError(error),ordersSent:0});
  }
}
