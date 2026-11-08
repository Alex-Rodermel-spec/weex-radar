// Optional Telegram backup for WEEX RADAR. Does not trade, and never logs secrets.
import {createHash,timingSafeEqual} from 'node:crypto';
import {formatNotice} from './alert-format.mjs';
import {get,put,del} from '@vercel/blob';

const ownerFile='telegram/owner.json',cursorFile='telegram/cursor.json';
const hash=s=>createHash('sha256').update(s).digest('hex');
const conflict=e=>/exist|already|conflict|409/i.test(String(e?.message||e));
const validChat=id=>Number.isSafeInteger(id)&&id>0;
function matchSecret(a,b){
 if(typeof a!=='string'||typeof b!=='string')return false;
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&timingSafeEqual(x,y);
}
export function telegramConfigured(){
 return /^\d{5,15}:[A-Za-z0-9_-]{30,}$/.test(process.env.TELEGRAM_BOT_TOKEN||'')&&
  /^[A-Za-z0-9_-]{16,64}$/.test(process.env.TELEGRAM_PAIR_CODE||'')&&
  Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}
async function api(method,data){
 if(!telegramConfigured())throw Error('TELEGRAM_NOT_CONFIGURED');
 // Never log this request URL: it contains the bot token.
 const response=await fetch('https://api.telegram.org/bot'+process.env.TELEGRAM_BOT_TOKEN+'/'+method,{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),
  signal:AbortSignal.timeout(5500),cache:'no-store'
 });
 if(!response.ok)throw Error('TELEGRAM_HTTP_'+response.status);
 const json=await response.json();
 if(!json?.ok)throw Error('TELEGRAM_API_ERROR');
 return json.result;
}
async function load(path){
 const value=await get(path,{access:'private'});
 return value?.stream?JSON.parse(await new Response(value.stream).text()):null;
}
function price(v){
 const n=Number(v);
 return Number.isFinite(n)&&n>0?n.toLocaleString('ru-RU',{maximumFractionDigits:n<1?8:4}):'—';
}
function messageText(kind,signals){
 const one=signals[0],isEarly=kind==='early';
 const url=isEarly?'https://weex-radar.vercel.app/tradingview.html?symbol='+
  encodeURIComponent(one.symbol)+'&interval=1':'https://weex-radar.vercel.app/';
 if(signals.length===1){
  const display=formatNotice(kind,one);
  return (display?display.title+'\n'+display.body:
   '⚠️ WEEX RADAR · данные неполные')+'\n'+url;
 }
 const details=signals.slice(0,5).map(s=>{
  const d=formatNotice(kind,s,{compact:true});
  return (d?.status||'🟡 ПРОВЕРИТЬ')+' '+(s.level==='STRONG'?'🟣 ':'')+
   s.exchange+' · '+s.symbol+' '+s.direction+' · '+price(s.livePrice||s.closePrice||s.price);
 });
 return ['WEEX RADAR · '+(isEarly?'1м WATCH':'5м сигналы'),
  ...details,isEarly?'⚠️ НЕ ВХОДИТЬ без подтверждения 5м.':
  '⚠️ Проверь цену, TP/SL и расходы; не гарантия прибыли.',url].join('\n');
}
export async function telegramPoll(){
 if(!telegramConfigured())return {enabled:false};
 const saved=await load(cursorFile),offset=Number.isSafeInteger(saved?.next)?saved.next:0;
 const updates=await api('getUpdates',{offset,limit:50,timeout:0,allowed_updates:['message']});
 if(!Array.isArray(updates))throw Error('TELEGRAM_UPDATES_INVALID');
 let last=offset,owner=await load(ownerFile),newlyPaired=false;
 for(const item of updates){
  if(!Number.isSafeInteger(item?.update_id))continue;
  last=Math.max(last,item.update_id+1);
  const msg=item.message,chat=msg?.chat,id=chat?.id;
  if(chat?.type!=='private'||!validChat(id)||typeof msg?.text!=='string')continue;
  const text=msg.text.trim(),match=text.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{16,64})$/);
  if(match&&matchSecret(match[1],process.env.TELEGRAM_PAIR_CODE)){
   if(!owner){
    try{await put(ownerFile,JSON.stringify({chatId:id,at:Date.now()}),
      {access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json'});
      owner={chatId:id};newlyPaired=true;
    }catch(e){if(!conflict(e))throw e;owner=await load(ownerFile);}
   }
   if(newlyPaired){
    await api('sendMessage',{chat_id:id,text:'✅ WEEX RADAR подключён!\n🧪 ТЕСТ: Telegram получает сообщения от сервера. Это НЕ торговый сигнал.\nТеперь будут приходить подходящие 1м WATCH и сигналы 5м.\nОтключить: /stop'});
   }
  }else if(owner?.chatId===id&&text==='/stop'){
   await del(ownerFile);owner=null;
   await api('sendMessage',{chat_id:id,text:'🔕 Telegram-оповещения выключены. Chrome Push продолжает работать.'});
  }else if(owner?.chatId===id&&['/status','/start','/help'].includes(text)){
   await api('sendMessage',{chat_id:id,text:'✅ WEEX RADAR Telegram активен. Ждём условия LONG/SHORT. Для отключения: /stop. Сделки не открываются.'});
  }
 }
 if(last>offset){
  const state=await load(cursorFile);
  await put(cursorFile,JSON.stringify({next:Math.max(last,Number.isSafeInteger(state?.next)?state.next:0)}),
    {access:'private',allowOverwrite:true,contentType:'application/json'});
 }
 if(newlyPaired)console.info('WEEX_RADAR_TELEGRAM_PAIRED '+JSON.stringify({ok:true}));
 return {enabled:true,paired:Boolean(owner),processed:updates.length};
}
export async function telegramSend(kind,signals){
 const result={enabled:telegramConfigured(),delivered:0,failed:0,duplicates:0};
 if(!result.enabled||!['early','confirmed'].includes(kind)||!Array.isArray(signals)||!signals.length)return result;
 const owner=await load(ownerFile);
 if(!validChat(owner?.chatId))return {...result,paired:false};
 const now=Date.now(),eligible=signals.filter(s=>
  ['LONG','SHORT'].includes(s.direction)&&
  Number.isFinite(s.candleCloseTime)&&Number.isFinite(s.expiresAt)&&
  s.candleCloseTime<=now&&s.expiresAt>now+10000&&
  (kind==='early'?s.exchange==='WEEX'&&s.level==='EARLY_WATCH'&&now-s.candleCloseTime<=45000:
   ['WEEX','Bybit'].includes(s.exchange)&&now-s.candleCloseTime<=90000)).slice(0,5);
 if(!eligible.length)return result;
 const marks=[];
 for(const s of eligible){
  const path='telegram/delivered/'+hash([kind,s.exchange,s.symbol,s.direction,s.candleCloseTime].join('|'))+'.txt';
  try{await put(path,'1',{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'text/plain'});marks.push({path,signal:s})}
  catch(e){if(conflict(e)){result.duplicates++}else throw e}
 }
 if(!marks.length)return result;
 try{
  await api('sendMessage',{chat_id:owner.chatId,text:messageText(kind,marks.map(x=>x.signal)),
   disable_notification:false,link_preview_options:{is_disabled:true}});
  result.delivered=1;
  console.info('WEEX_RADAR_TELEGRAM_SENT '+JSON.stringify({kind,count:marks.length,accepted:true}));
 }catch(e){
  result.failed=1;
  for(const m of marks)try{await del(m.path)}catch{}
  console.warn('WEEX_RADAR_TELEGRAM_FAILED '+String(e.message||e).slice(0,70));
 }
 return result;
}
export const _test={matchSecret,price,messageText};
