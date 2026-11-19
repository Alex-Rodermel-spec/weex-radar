// Paper-only automatic 5-coin journal using private Vercel Blob.
// Never calls an authenticated WEEX trade endpoint. No ntfy or real orders.
import {get,put,del} from '@vercel/blob';
import {PAPER_POLICY,validPaperPortfolio,
 stepPaperPortfolio,publicPaperStatus} from './paper-trading.mjs';

const STATE='paper-15eur-five/v1/portfolio.json';
const LOCK='paper-15eur-five/v1/cron.lock';
const staleLockMs=150_000;
const isConflict=e=>/exist|already|conflict|409/i.test(String(e?.message||e));
const readJson=async path=>{
 const blob=await get(path,{access:'private'});
 if(!blob?.stream)return null;
 return JSON.parse(await new Response(blob.stream).text());
};
export async function readPaperPortfolio(){
 const data=await readJson(STATE);
 if(data!==null&&!validPaperPortfolio(data))throw Error('PAPER_SAVED_STATE_INVALID');
 return data;
}
export async function paperTradingStatus(){
 const state=await readPaperPortfolio();
 return {enabled:process.env.WEEX_PAPER_TRADING_DISABLED!=='true',
  ...publicPaperStatus(state)};
}
async function acquirePaperLock(now){
 try{
  await put(LOCK,JSON.stringify({createdAt:now}),{
   access:'private',allowOverwrite:false,addRandomSuffix:false,
   contentType:'application/json'
  });
  return true;
 }catch(e){
  if(!isConflict(e))throw e;
  // Only a timed-out worker can leave a lock this old: the cron function
  // itself has a 60s server timeout. Never forcibly cancel a fresh run.
  let lock;
  try{lock=await readJson(LOCK)}catch{return false;}
  if(!lock||!Number.isFinite(lock.createdAt)||now-lock.createdAt<=staleLockMs)
   return false;
  try{
   await del(LOCK);
   await put(LOCK,JSON.stringify({createdAt:now}),{
    access:'private',allowOverwrite:false,addRandomSuffix:false,
    contentType:'application/json'
   });
   return true;
  }catch(e2){if(isConflict(e2))return false;throw e2;}
 }
}
async function collectQuotes(symbols,quoteReader){
 const quotes={};let cursor=0,failed=0;
 async function worker(){
  while(cursor<symbols.length){
   const symbol=symbols[cursor++];
   try{quotes[symbol]=await quoteReader(symbol)}
   catch{failed++;}
  }
 }
 await Promise.all(Array.from({length:Math.min(3,symbols.length)},()=>worker()));
 return {quotes,failed};
}
export async function runPaperTrading({
 confirmed=[],quoteReader,now=Date.now()
}={}){
 const base={mode:'PAPER_ONLY',ordersSent:0,realOrders:false,
  maxPositions:PAPER_POLICY.maxPositions,marginEur:PAPER_POLICY.marginEur,
  leverage:PAPER_POLICY.leverage};
 if(process.env.WEEX_PAPER_TRADING_DISABLED==='true')
  return {...base,enabled:false,reason:'OWNER_KILL_SWITCH'};
 if(!Array.isArray(confirmed)||typeof quoteReader!=='function')
  throw Error('PAPER_INVALID_CRON_INPUT');
 // Most minutes have no fresh confirmed signal. Do not create a new
 // blob/lock or spend extra quote requests while no simulated position exists.
 const before=await readPaperPortfolio();
 if(!before?.active?.length&&!confirmed.length)
  return {...base,enabled:true,opened:0,closed:0,active:0,
   realizedNetEur:before?.realizedNetEur||0};
 if(!(await acquirePaperLock(now)))
  return {...base,enabled:true,lockBusy:true,opened:0,closed:0,
   active:before?.active.length??0};
 try{
  // Load again inside lock so a competing run cannot overwrite recent entries.
  const state=await readPaperPortfolio();
  const active=state?.active||[];
  const allowed=new Set(PAPER_POLICY.allowedCrypto);
  const candidates=confirmed.filter(x=>x?.exchange==='WEEX'&&allowed.has(x?.symbol));
  const symbols=[...new Set([...active.map(x=>x.symbol),
   ...candidates.slice(0,10).map(x=>x.symbol)])].slice(0,10);
  const received=await collectQuotes(symbols,quoteReader);
  const {portfolio,metrics}=stepPaperPortfolio(state,candidates,received.quotes,now);
  // Save event changes and one low-frequency operational heartbeat.
  if(!state||metrics.opened||metrics.closed||
   !state.lastCycleAt||now-state.lastCycleAt>=5*60_000){
   await put(STATE,JSON.stringify(portfolio),{
    access:'private',allowOverwrite:true,addRandomSuffix:false,
    contentType:'application/json'
   });
  }
  return {...base,enabled:true,...metrics,quoteFailures:received.failed};
 }finally{
  try{await del(LOCK)}catch{/* A stale lock fails closed until expiry */ }
 }
}
