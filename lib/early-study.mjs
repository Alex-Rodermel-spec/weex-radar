// Research only: compare ntfy EARLY WATCH / PRE_BREAK alerts with later WEEX candles.
// Not a trade signal, order, strategy change, claim of profitability, or calibrated forecast.
export const EARLY_HORIZONS=[5,15,30];
const MINUTE=60_000;
const validNumber=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const round=(n,d=2)=>Number(n.toFixed(d));
const watchTitle=/^🟡 ЖДАТЬ · ([A-Z0-9]{2,24}) (LONG|SHORT) · ⚡ EARLY WATCH$/u;
// #108 adds the honest ordinary label; keep historical title compatibility.
const forecastTitle=/^🔮 ПРОГНОЗ · ([A-Z0-9]{2,24}) (LONG|SHORT)(?: · 🔵 ОБЫЧНЫЙ)? · 🟡 ЖДАТЬ$/u;

export function parseEarlyNotification(msg){
 if(msg?.event!=='message'||typeof msg.title!=='string'||
    typeof msg.message!=='string')return null;
 const watch=msg.title.match(watchTitle),forecast=msg.title.match(forecastTitle);
 if(!watch&&!forecast)return null;
 const type=forecast?'PRE_BREAK':'BREAKOUT',parts=forecast||watch;
 const exactSource=forecast?
  /WEEX · 📍 Сейчас:\s*([0-9]+(?:[.,][0-9]+)?)\s+USDT/u:
  /^(?:📈 РОСТ|📉 ПАДЕНИЕ) · WEEX\s*$/mu;
 if(!exactSource.test(msg.message))return null;
 const price=forecast?
  msg.message.match(/WEEX · 📍 Сейчас:\s*([0-9]+(?:[.,][0-9]+)?)\s+USDT/u):
  msg.message.match(/^📍 Вход:\s*([0-9]+(?:[.,][0-9]+)?)\s+USDT\s*$/mu);
 const entry=Number(price?.[1]?.replace(',','.')),seconds=Number(msg.time);
 if(!validNumber(entry)||!Number.isSafeInteger(seconds)||seconds<=0)return null;
 const sentAt=seconds*1000;
 // Forecast levels are printed to the owner's ntfy body (rounded
 // display values). Missing legacy levels stay null, never fabricated.
 const triggerText=forecast?msg.message.match(
  /^🔑 Подтверждение: (выше|ниже)\s+([0-9]+(?:[.,][0-9]+)?)\s*$/mu):null;
 const cancelText=forecast?msg.message.match(
  /^❌ Отмена сценария: (выше|ниже)\s+([0-9]+(?:[.,][0-9]+)?)\s*$/mu):null;
 const tr=Number(triggerText?.[2]?.replace(',','.'));
 const inv=Number(cancelText?.[2]?.replace(',','.'));
 const goodGeometry=Number.isFinite(tr)&&tr>0&&Number.isFinite(inv)&&inv>0&&
  (parts[2]==='LONG'?tr>inv:tr<inv)&&
  triggerText?.[1]===(parts[2]==='LONG'?'выше':'ниже')&&
  cancelText?.[1]===(parts[2]==='LONG'?'ниже':'выше');
 return {symbol:parts[1],direction:parts[2],watchType:type,entry,sentAt,
  trigger:forecast&&goodGeometry?tr:null,
  invalidation:forecast&&goodGeometry?inv:null,
  key:typeof msg.sequence_id==='string'&&/^[a-f0-9]{32}$/.test(msg.sequence_id)?
   msg.sequence_id:parts[1]+'|'+parts[2]+'|'+type+'|'+sentAt};
}

export function normalizeEarlyCandles(rows,now=Date.now()){
 if(!Array.isArray(rows)||rows.length>500)throw Error('BAD_EARLY_CANDLES');
 const unique=new Map();
 for(const row of rows){
  if(!Array.isArray(row)||row.length<6)continue;
  const [time,open,high,low,close,volume]=row.slice(0,6).map(Number);
  if(!Number.isSafeInteger(time)||time<now-3*60*60*1000||
    time+MINUTE>now-1000||![open,high,low,close,volume].every(Number.isFinite)||
    Math.min(open,low,close)>high||Math.max(open,high,close)<low||
    Math.min(open,high,low,close)<=0||volume<0||
    high<Math.max(open,close)||low>Math.min(open,close))continue;
  unique.set(time,{time,closeTime:time+MINUTE,open,high,low,close});
 }
 return [...unique.values()].sort((a,b)=>a.time-b.time);
}

// Evaluate only FULL minutes following an alert: never use the unknown
// intraminute price path at the moment ntfy accepted the message.
export function evaluateEarlyDirection(alert,candles,minutes,now=Date.now()){
 if(!alert||!(EARLY_HORIZONS.includes(minutes)||minutes===10)||!validNumber(alert.entry))
  return {status:'NO_DATA',moveBps:null,favorableBps:null,adverseBps:null};
 const first=Math.ceil(alert.sentAt/MINUTE)*MINUTE;
 const end=first+minutes*MINUTE;
 if(now<end+1000)return {status:'PENDING',moveBps:null,favorableBps:null,adverseBps:null};
 if(!Array.isArray(candles))return {status:'NO_DATA',moveBps:null,favorableBps:null,adverseBps:null};
 const byTime=new Map(candles.map(c=>[c.time,c]));
 let final=null,favorable=0,adverse=0;
 const side=alert.direction==='LONG'?1:alert.direction==='SHORT'?-1:0;
 if(!side)return {status:'NO_DATA',moveBps:null,favorableBps:null,adverseBps:null};
 for(let i=0;i<minutes;i++){
  const bar=byTime.get(first+i*MINUTE);
  if(!bar||![bar.high,bar.low,bar.close].every(validNumber)||bar.high<bar.low||
     bar.high<bar.close||bar.low>bar.close)
   return {status:'NO_DATA',moveBps:null,favorableBps:null,adverseBps:null};
  final=bar;
  const best=side===1?bar.high:bar.low;
  const worst=side===1?bar.low:bar.high;
  favorable=Math.max(favorable,side*(best/alert.entry-1)*10000);
  adverse=Math.min(adverse,side*(worst/alert.entry-1)*10000);
 }
 return {status:'OBSERVED',moveBps:round(side*(final.close/alert.entry-1)*10000),
  favorableBps:round(favorable),adverseBps:round(adverse)};
}

// A later confirmation is a comparison, not evidence the early warning
// was a safe or executable entry. Positive chaseBps = later price was worse.
export function pairConfirmation(alert,confirmed){
 if(!alert||!Array.isArray(confirmed))return null;
 const match=confirmed.filter(c=>c.symbol===alert.symbol&&
  c.direction===alert.direction&&validNumber(c.entry)&&
  c.sentAt>alert.sentAt&&c.sentAt<=alert.sentAt+30*MINUTE)
  .sort((a,b)=>a.sentAt-b.sentAt)[0];
 if(!match)return null;
 const side=alert.direction==='LONG'?1:-1;
 return {delayMinutes:round((match.sentAt-alert.sentAt)/MINUTE,1),
  chaseBps:round(side*(match.entry/alert.entry-1)*10000)};
}

export function summarizeEarlyStudy(alerts,candlesBySymbol,confirmed,now=Date.now()){
 const unique=new Map();
 for(const a of alerts)if(a&&a.key&&!unique.has(a.key))unique.set(a.key,a);
 const rows=[...unique.values()].map(a=>{
  const windows=Object.fromEntries(EARLY_HORIZONS.map(m=>[
   m,evaluateEarlyDirection(a,candlesBySymbol.get(a.symbol),m,now)
  ]));
  return {symbol:a.symbol,direction:a.direction,watchType:a.watchType,
   entry:a.entry,sentAt:a.sentAt,windows,confirmation:pairConfirmation(a,confirmed)};
 });
 const windows={};
 for(const m of EARLY_HORIZONS){
  const observed=rows.map(r=>r.windows[m]).filter(x=>x.status==='OBSERVED');
  const sum=observed.reduce((s,x)=>s+x.moveBps,0);
  const favorable=observed.filter(x=>x.moveBps>0).length;
  const adverse=observed.filter(x=>x.moveBps<0).length;
  windows[m]={observed:observed.length,favorable,adverse,
   flat:observed.length-favorable-adverse,
   pending:rows.filter(r=>r.windows[m].status==='PENDING').length,
   noData:rows.filter(r=>r.windows[m].status==='NO_DATA').length,
   favorablePct:observed.length?round(100*favorable/observed.length,1):null,
   meanDirectionBps:observed.length?round(sum/observed.length):null};
 }
 const byType={};
 for(const type of ['PRE_BREAK','BREAKOUT']){
  const group=rows.filter(r=>r.watchType===type);
  byType[type]={total:group.length,windows:{}};
  for(const m of EARLY_HORIZONS){
   const evaluated=group.map(r=>r.windows[m]).filter(w=>w.status==='OBSERVED');
   const favorable=evaluated.filter(w=>w.moveBps>0).length;
   byType[type].windows[m]={observed:evaluated.length,
    favorable,adverse:evaluated.filter(w=>w.moveBps<0).length,
    favorablePct:evaluated.length?round(favorable/evaluated.length*100,1):null};
  }
 }
 const pairs=rows.map(r=>r.confirmation).filter(Boolean);
 const meanPenalty=pairs.length?
  round(pairs.reduce((s,x)=>s+x.chaseBps,0)/pairs.length):null;
 return {totalEarly:rows.length,types:{
  PRE_BREAK:rows.filter(r=>r.watchType==='PRE_BREAK').length,
  BREAKOUT:rows.filter(r=>r.watchType==='BREAKOUT').length
 },windows,pairs:{confirmedWithin30m:pairs.length,
  meanChaseBps:meanPenalty,
  laterEntryWorse:pairs.filter(p=>p.chaseBps>0).length,
  laterEntryBetter:pairs.filter(p=>p.chaseBps<0).length},
  byType,rows:rows.sort((a,b)=>b.sentAt-a.sentAt)};
}
