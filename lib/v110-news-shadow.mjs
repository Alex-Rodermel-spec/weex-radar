// V110 NEWS RADAR read-only research of PUBLIC issue #62 event annotations.
// This is NOT an automated news trading gate or proof of pre-market detection.
// Existing independent NEWS RADAR collector runs separately and may supply
// future structured annotations after checking ORIGINAL primary timestamps.
const ISSUE=62,REPO='Alex-Rodermel-spec/weex-radar';
const COMMENTS='https://api.github.com/repos/'+REPO+'/issues/'+ISSUE+'/comments?per_page=100&page=1';
const HOSTS=new Set(['federalreserve.gov','www.federalreserve.gov',
 'bls.gov','www.bls.gov','sec.gov','www.sec.gov',
 'investor.nvidia.com','www.whitehouse.gov','whitehouse.gov',
 'reuters.com','www.reuters.com']);
const TYPES=new Set(['FED','CPI','EMPLOYMENT','SEC','EARNINGS',
 'TARIFFS','GEOPOLITICS','OTHER']);
const MS=60000;
const integer=n=>Number.isSafeInteger(n);
const isoDate=s=>{
 if(typeof s!=='string'||s.length>32||
  !/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(s))return null;
 const date=Date.parse(s);
 return Number.isFinite(date)?date:null;
};
function sourceAllowed(raw){
 try{
  const url=new URL(raw);
  return url.protocol==='https:'&&HOSTS.has(url.hostname.toLowerCase())&&
   !url.username&&!url.password&&url.href.length<=650;
 }catch{return false}
}
export const V110_NEWS_POLICY=Object.freeze({
 version:'v110-public-news-shadow-v1',
 publicIssue:REPO+'/issues/'+ISSUE,
 minVerifiedEventsBeforeComparison:30,
 detectionDelaySecondsForEarlyCandidate:60,
 requiresVerifiedOriginalPublicationTime:true,
 noMarketPrediction:true,noTradingSignal:true,
 noLiveGate:true,noOrders:true,noNewCron:true
});
export function parseV110NewsComment(body){
 if(typeof body!=='string'||body.length>16000)return [];
 const found=[];
 for(const line of body.split(/\r?\n/).slice(0,130)){
  if(!line.startsWith('NEWS_RADAR_V110_EVENT '))continue;
  const payload=line.slice('NEWS_RADAR_V110_EVENT '.length);
  if(payload.length>2200)continue;
  let o;
  try{o=JSON.parse(payload)}catch{continue}
  if(!o||typeof o!=='object'||Array.isArray(o)||
    typeof o.eventId!=='string'||!/^[A-Za-z0-9_-]{8,70}$/.test(o.eventId)||
    typeof o.category!=='string'||!TYPES.has(o.category)||
    !sourceAllowed(o.sourceUrl)||typeof o.primaryTimeVerified!=='boolean')continue;
  const publishedAt=isoDate(o.publishedAt),detectedAt=isoDate(o.detectedAt);
  if(publishedAt===null||detectedAt===null||
    detectedAt<publishedAt-2*MS||detectedAt>publishedAt+7*86400000)continue;
  found.push({eventId:o.eventId,category:o.category,
   publishedAt,detectedAt,primaryTimeVerified:o.primaryTimeVerified,
   planned:o.planned===true,sourceHost:new URL(o.sourceUrl).hostname.toLowerCase()});
  if(found.length>=12)break;
 }
 return found;
}
export function summarizeV110NewsStudy(comments,now=Date.now()){
 if(!Array.isArray(comments)||comments.length>100||!integer(now))throw Error('V110_NEWS_INVALID');
 const observations=new Map();
 for(const comment of comments){
  for(const e of parseV110NewsComment(comment?.body))
   if(e.publishedAt<=now&&e.detectedAt<=now&&!observations.has(e.eventId))
    observations.set(e.eventId,e);
 }
 const rows=[...observations.values()],
  verified=rows.filter(x=>x.primaryTimeVerified&&!x.planned),
  early=verified.filter(x=>x.detectedAt-x.publishedAt<=
   V110_NEWS_POLICY.detectionDelaySecondsForEarlyCandidate*1000);
 const delayed=verified.filter(x=>x.detectedAt-x.publishedAt>5*MS);
 return {
  mode:'V110_PUBLIC_NEWS_SHADOW',source:'PUBLIC_GITHUB_ISSUE_62',
  sourceUrl:'https://github.com/'+REPO+'/issues/'+ISSUE,
  status:verified.length>=V110_NEWS_POLICY.minVerifiedEventsBeforeComparison?
   'TIMESTAMP_COHORT_READY_FOR_MARKET_REPLAY':'INSUFFICIENT_VERIFIED_EARLY_NEWS',
  rawPublicComments:comments.length,structuredEvents:rows.length,
  originalTimeVerified:verified.length,earlyWithin60sCandidates:early.length,
  lateAfter5m:delayed.length,
  warning:'Early timestamp alone does NOT prove the news preceded market movement; first price move and source timestamp still need independent verification. Annotation assertions are not verified by this endpoint. Reuters publication is NOT necessarily original event time.',
  coverage:'Only capped first 100 public issue comments, not a complete news feed.',
  policy:V110_NEWS_POLICY,
  changesLiveSignals:false,ordersSent:0
 };
}
export async function handleV110NewsStudy(req,res,fetchImpl=fetch){
 res.setHeader('Cache-Control','public, s-maxage=120, stale-while-revalidate=120');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{
  const r=await fetchImpl(COMMENTS,{cache:'no-store',
   signal:AbortSignal.timeout(7500),
   headers:{Accept:'application/vnd.github+json',
    'User-Agent':'WEEX-RADAR-V110-NEWS-RESEARCH/1.0'}});
  if(!r.ok)throw Error('ISSUE_READ_FAILED');
  const raw=await r.text();
  if(raw.length>175000)throw Error('ISSUE_TOO_LARGE');
  const comments=JSON.parse(raw);
  const result=summarizeV110NewsStudy(comments);
  return res.status(200).json(result);
 }catch(e){
  console.warn('V110_NEWS_SHADOW_UNAVAILABLE '+String(e.message||e).slice(0,55));
  return res.status(503).json({mode:'V110_PUBLIC_NEWS_SHADOW',
   status:'PUBLIC_SOURCE_UNAVAILABLE',changesLiveSignals:false,ordersSent:0});
 }
}
