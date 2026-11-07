// GitHub-OIDC-only, read-only WEEX Futures connection probe.
// Never expose credentials, balances, account IDs, positions, or raw exchange replies.
import {jwtVerify,createRemoteJWKSet} from 'jose';
import {weex,configured,marketPlan,orderPayload} from '../lib/weex-order.mjs';
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
  // Public server clock and THREE independent authenticated reads.
  // Never echo account configuration, balances, positions, raw errors or secrets.
  let clockSkewMs=null;
  try{
    const r=await fetch('https://api-contract.weex.com/capi/v3/market/time',
      {method:'GET',signal:AbortSignal.timeout(6000),cache:'no-store'});
    const t=await r.json();
    if(r.ok&&Number.isFinite(Number(t?.serverTime)))
      clockSkewMs=Math.round((Date.now()-Number(t.serverTime))/100)*100;
  }catch{}
  const [account,balance,positions]=await Promise.allSettled([weex.account(),weex.balance(),weex.positions()]);
  const check={
    account:account.status==='fulfilled'
      ?(typeof account.value?.canTrade==='boolean'?'authenticated':'unexpected_schema')
      :safeProbeError(account.reason).code||safeProbeError(account.reason).stage,
    balance:balance.status==='fulfilled'
      ?(Array.isArray(balance.value)?'authenticated':'unexpected_schema')
      :safeProbeError(balance.reason).code||safeProbeError(balance.reason).stage,
    positions:positions.status==='fulfilled'
      ?(Array.isArray(positions.value)?'authenticated':'unexpected_schema')
      :safeProbeError(positions.reason).code||safeProbeError(positions.reason).stage
  };
  // Verify the remaining read-only prerequisites used by the trade preview.
  const [orders,settings,info,book,apiSymbols]=await Promise.allSettled([
    weex.openOrders(),weex.symbolConfig('XRPUSDT'),weex.info('XRPUSDT'),
    weex.book('XRPUSDT'),weex.apiTradingSymbols()
  ]);
  const summarize=(x,valid)=>x.status==='fulfilled'
    ?(valid(x.value)?'authenticated':'unexpected_schema')
    :safeProbeError(x.reason).code||safeProbeError(x.reason).stage;
  check.openOrders=summarize(orders,Array.isArray);
  check.symbolConfig=summarize(settings,Array.isArray);
  check.exchangeInfo=summarize(info,x=>Array.isArray(x?.symbols));
  check.bookTicker=summarize(book,x=>(Array.isArray(x)?x.length>0:Boolean(x&&typeof x==='object')));
  check.apiTradingSymbols=summarize(apiSymbols,Array.isArray);
  // Dry-run: build a *synthetic* local plan from real market metadata.
  // This never submits an order and is not an investment signal.
  // The GitHub diagnostic receives only pass/fail, never account data.
  let dryRunPlan=false;
  if(info.status==='fulfilled'&&book.status==='fulfilled'&&
     apiSymbols.status==='fulfilled'&&Array.isArray(apiSymbols.value)&&
     apiSymbols.value.includes('XRPUSDT')) {
    try {
      const quote=(Array.isArray(book.value)?book.value:[book.value])
        .find(x=>x?.symbol==='XRPUSDT');
      const ask=Number(quote?.askPrice),now=Date.now();
      if(Number.isFinite(ask)&&ask>0){
        const synthetic={symbol:'XRPUSDT',status:'ok',exchange:'WEEX',
          level:'NORMAL',direction:'LONG',price:ask,
          stop:ask*0.99,take:ask*1.02,
          candleCloseTime:now-15000,expiresAt:now+120000};
        const plan=marketPlan(synthetic,info.value,book.value,now);
        const prepared=orderPayload(plan); // local data object, NO HTTP call
        dryRunPlan=prepared.symbol==='XRPUSDT'&&prepared.type==='MARKET'&&
          prepared.quantity===plan.quantity&&
          prepared.tpTriggerPrice===String(plan.takeProfit)&&
          prepared.slTriggerPrice===String(plan.stopLoss);
      }
    }catch{}
  }
  check.dryRunPlan=dryRunPlan?'authenticated':'unavailable';
  const ok=Object.values(check).every(v=>v==='authenticated');
  return res.status(ok?200:502).json({
    ok,stage:ok?'authenticated':'three_endpoint_diagnosis',code:ok?null:
      (Object.values(check).find(v=>v!=='authenticated')||'unknown'),
    checks:check,
    clockSkewMs,
    ordersSent:0
  });
}
