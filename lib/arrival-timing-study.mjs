// Pure, read-only timing audit of confirmed alerts actually accepted by ntfy.
// No orders, keys, live entry permissions, fills, or future-candle inference.
const MINUTE=60_000,FIVE=5*MINUTE;
const berlinClock=new Intl.DateTimeFormat('en-GB',{
 timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
});
const clock=t=>berlinClock.format(t);
const roundedBps=(start,end,side)=>{
 const bps=Math.round(side*(end-start)/start*100_000)/10;
 return bps===0?0:bps; // avoid signed negative zero in a flat market
};
const positive=x=>Number.isFinite(x)&&x>0;

// Recover the precise CLOSED 5m candle from a timestamp actually printed
// in the original notification. Never guess a timestamp from arrival alone.
export function alertCandleCloseAt(body,sentAt){
 if(typeof body!=='string'||!Number.isSafeInteger(sentAt)||sentAt<=0)return null;
 const match=body.match(/(?:^|\n)🕒 Свеча (\d{2}:\d{2}:\d{2})(?: ·|$)/u);
 if(!match)return null;
 const candidate=Math.floor(sentAt/FIVE)*FIVE;
 for(let t=candidate;t>=sentAt-90_000;t-=FIVE)
  if(t<=sentAt&&clock(t)===match[1])return t;
 return null;
}
const validBar=(c,now)=>c&&Number.isSafeInteger(c.time)&&c.time%MINUTE===0&&
 c.closeTime===c.time+MINUTE&&c.closeTime<=now-1000&&
 [c.open,c.high,c.low,c.close].every(positive)&&
 c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close);
function fullMinutes(map,start,n,now){
 const result=[];
 for(let i=0;i<n;i++){
  const time=start+i*MINUTE;
  if(time+MINUTE>now-1000)return {status:'PENDING',bars:null};
  const bar=map.get(time);
  if(!validBar(bar,now))return {status:'NO_DATA',bars:null};
  result.push(bar);
 }
 return {status:'OBSERVED',bars:result};
}
export function studyConfirmedArrival(a,candles,now=Date.now()){
 const blank=()=>({mode:'READ_ONLY_CONFIRMED_TIMING',
  status:'NO_CANDLE_TIMESTAMP',lagSeconds:null,
  pre5mMoveBps:null,closeToAlertBps:null,
  after5mMoveBps:null,after5mStatus:'NO_DATA',
  after10mMoveBps:null,after10mStatus:'NO_DATA',
  tradeReady:false,notATrade:true});
 const result=blank();
 if(!a||!['LONG','SHORT'].includes(a.direction)||
   !positive(a.entry)||!Number.isSafeInteger(a.sentAt)||a.sentAt<=0||
   !Number.isSafeInteger(now))return result;
 if(!Number.isSafeInteger(a.candleCloseAt)||
   a.candleCloseAt>a.sentAt||a.sentAt-a.candleCloseAt>90_000||
   a.candleCloseAt%FIVE!==0)return result;
 result.lagSeconds=Math.round((a.sentAt-a.candleCloseAt)/1000);
 if(!Array.isArray(candles)){
  result.status='NO_DATA';return result;
 }
 const seen=new Map();
 for(const bar of candles){
  if(!Number.isSafeInteger(bar?.time))continue;
  if(seen.has(bar.time)){result.status='NO_DATA';return result}
  seen.set(bar.time,bar);
 }
 const side=a.direction==='LONG'?1:-1;
 const before=fullMinutes(seen,a.candleCloseAt-FIVE,5,now);
 if(before.status==='OBSERVED'){
  const start=before.bars[0],last=before.bars[4];
  result.pre5mMoveBps=roundedBps(start.open,last.close,side);
  // This uses the quote rounded in the original notification. It is not
  // a historical trade fill and must not be interpreted as latency alone.
  result.closeToAlertBps=roundedBps(last.close,a.entry,side);
 }
 const startAfter=Math.ceil(a.sentAt/MINUTE)*MINUTE;
 for(const [n,field,statusKey] of [
  [5,'after5mMoveBps','after5mStatus'],
  [10,'after10mMoveBps','after10mStatus']
 ]){
  const measured=fullMinutes(seen,startAfter,n,now);
  result[statusKey]=measured.status;
  if(measured.status==='OBSERVED')
   result[field]=roundedBps(a.entry,measured.bars.at(-1).close,side);
 }
 result.status=before.status==='OBSERVED'?'OBSERVED':'NO_DATA';
 return result;
}
export function summarizeConfirmedArrival(rows){
 const timings=(Array.isArray(rows)?rows:[]).map(r=>r.arrivalTiming).filter(Boolean);
 const lags=timings.map(x=>x.lagSeconds).filter(Number.isFinite).sort((a,b)=>a-b);
 const pre=timings.filter(x=>Number.isFinite(x.pre5mMoveBps));
 const after=timings.filter(x=>x.after5mStatus==='OBSERVED'&&
   Number.isFinite(x.after5mMoveBps));
 return {total:timings.length,lagMeasured:lags.length,
  lagMedianSeconds:lags.length?lags[Math.floor((lags.length-1)/2)]:null,
  lagMaxSeconds:lags.length?lags.at(-1):null,
  pre5mMeasured:pre.length,
  pre5mAtLeast10Bps:pre.filter(x=>x.pre5mMoveBps>=10).length,
  after5mMeasured:after.length,
  after5mFavorable:after.filter(x=>x.after5mMoveBps>0).length,
  after5mAdverse:after.filter(x=>x.after5mMoveBps<0).length,
  after5mFlat:after.filter(x=>x.after5mMoveBps===0).length,
  after5mPending:timings.filter(x=>x.after5mStatus==='PENDING').length,
  preDefinition:'Directional move from open to close of the completed 5m breakout candle BEFORE the ntfy alert.',
  lagDefinition:'Seconds between the CLOSED 5m candle and actual ntfy server timestamp recovered from the original message.',
  postDefinition:'Directional change from original quoted alert entry to close of 5 complete 1m candles starting strictly AFTER the ntfy minute; gaps stay NO_DATA.',
  limits:'Read-only timing evidence, not order fills, realizable profit, phone delivery verification, or calibrated win probability.'};
}
