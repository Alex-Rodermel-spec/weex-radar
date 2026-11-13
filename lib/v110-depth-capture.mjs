// V110 read-only, opt-in research capture from WEEX PUBLIC order-book snapshots.
// Only called for the <=2 already selected forecast notifications per 10m bucket.
// No trading, no extra cron, new storage, GitHub credentials or ntfy alerts.
// Book data is a LOCAL HTTP receipt, not a WEEX exchange-event timestamp.
import {createHmac,timingSafeEqual} from 'node:crypto';
import {normalizeBook} from './liquidity-analysis.mjs';

const LIMIT=200,MAX_RESPONSE=160000,MAX_CAPTURE_AGE=10000;
const PREFIX='#v110d=';
const CLICK='https://weex-radar.vercel.app/forecast.html';
const safeSymbol=s=>typeof s==='string'&&/^[A-Z0-9]{2,24}$/.test(s);
const validTime=t=>Number.isSafeInteger(t)&&t>0;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const round=(n,d=1)=>Number(n.toFixed(d));
const topicSecret=env=>typeof env?.NTFY_TOPIC==='string'&&
 /^[A-Za-z0-9_-]{16,64}$/.test(env.NTFY_TOPIC);
function mac(secret,id,part){
 return createHmac('sha256',secret).update('WEEX_V110_DEPTH_CLICK_V1\0')
  .update(id).update('\0').update(part).digest('base64url').slice(0,22);
}
function pressure(sideA,sideB){
 if(!finite(sideA)||!finite(sideB)||sideA<0||sideB<0||sideA+sideB<=0)return null;
 return round((sideA-sideB)/(sideA+sideB)*100);
}
function nearDepth(rows,mid,bandPct,isBid){
 const edge=mid*(1+(isBid?-bandPct:bandPct)/100);
 let sum=0;
 for(const {price,size} of rows){
  if(isBid?price>=edge:price<=edge)sum+=price*size;
 }
 return sum;
}
export function makeV110DepthSnapshot(raw,symbol,receiptAt){
 if(!safeSymbol(symbol)||!validTime(receiptAt))return null;
 try{
  const book=normalizeBook(raw),mid=book.mid;
  const bid025=nearDepth(book.bids,mid,.25,true);
  const ask025=nearDepth(book.asks,mid,.25,false);
  const bid050=nearDepth(book.bids,mid,.5,true);
  const ask050=nearDepth(book.asks,mid,.5,false);
  const p=pressure(bid025,ask025),q=pressure(bid050,ask050);
  const spreadBps=round((book.bestAsk-book.bestBid)/mid*10000,2);
  if(p===null||q===null||!finite(spreadBps)||spreadBps<0||spreadBps>100||
    book.bids.length>LIMIT||book.asks.length>LIMIT)return null;
  return {v:1,t:receiptAt,p,q,s:spreadBps};
 }catch{return null}
}
export async function captureV110Depth(symbol,{fetchImpl=fetch,clock=Date.now}={}){
 if(!safeSymbol(symbol))return null;
 try{
  const r=await fetchImpl('https://api-contract.weex.com/capi/v3/market/depth?symbol='+
   encodeURIComponent(symbol)+'&limit=200',{
   cache:'no-store',signal:AbortSignal.timeout(900),
   headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-V110-DEPTH-SHADOW/1.0'}
  });
  if(!r.ok||Number(r.headers?.get?.('content-length')||0)>MAX_RESPONSE)return null;
  const body=await r.text();
  if(body.length>MAX_RESPONSE)return null;
  const receiptAt=clock();
  return makeV110DepthSnapshot(JSON.parse(body),symbol,receiptAt);
 }catch{return null} // Depth outages MUST NEVER block notifications.
}
export function validateV110Depth(value,sentAt){
 if(!value||value.v!==1||!validTime(value.t)||!validTime(sentAt)||
  value.t>sentAt+999||sentAt-value.t>MAX_CAPTURE_AGE||
  ![value.p,value.q,value.s].every(finite)||
  Math.abs(value.p)>100||Math.abs(value.q)>100||
  value.s<0||value.s>100)return null;
 return {v:1,t:value.t,p:round(value.p),q:round(value.q),s:round(value.s,2)};
}
export function attachV110DepthClick(click,feature,{id,env=process.env}={}){
 if(click!==CLICK||!topicSecret(env)||!/^[a-f0-9]{32}$/.test(id||'')||
  !feature||feature.v!==1||!validTime(feature.t)||
  ![feature.p,feature.q,feature.s].every(finite))return click;
 const payload=Buffer.from(JSON.stringify(feature),'utf8').toString('base64url');
 if(payload.length>145)return click;
 return CLICK+PREFIX+payload+'.'+mac(env.NTFY_TOPIC,id,payload);
}
export function readV110DepthClick(click,{id,sentAt,env=process.env}={}){
 if(typeof click!=='string'||click.length>350||!topicSecret(env)||
  !/^[a-f0-9]{32}$/.test(id||'')||!validTime(sentAt))return null;
 if(!click.startsWith(CLICK+PREFIX))return null;
 const fragment=click.slice((CLICK+PREFIX).length);
 const m=fragment.match(/^([A-Za-z0-9_-]{20,145})\.([A-Za-z0-9_-]{22})$/);
 if(!m)return null;
 const expected=mac(env.NTFY_TOPIC,id,m[1]);
 const a=Buffer.from(m[2]),b=Buffer.from(expected);
 if(a.length!==b.length||!timingSafeEqual(a,b))return null;
 try{
  const payload=JSON.parse(Buffer.from(m[1],'base64url').toString('utf8'));
  return validateV110Depth(payload,sentAt);
 }catch{return null}
}
export const V110_DEPTH_CAPTURE_POLICY=Object.freeze({
 version:'v110-depth-capture-v1',
 productionStudyOnly:true,ordersEnabled:false,liveSignalChanges:false,
 maxSnapshotsPerBucket:2,bucketMinutes:10,depthFetchTimeoutMs:900,
 maxBeforePublicationMs:MAX_CAPTURE_AGE,
 source:'WEEX public top 200 level snapshot',
 captureClock:'LOCAL_HTTP_RECEIPT_NOT_EXCHANGE_TIME',
 unitsUnverified:true,notTradingProfit:true,ownerApprovalRequired:true
});
