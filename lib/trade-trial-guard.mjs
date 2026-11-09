// FIRST-TRADE SAFETY: at most one bot-submitted real order per Berlin day.
// Count the attempt if a real order request was sent (even with an ambiguous
// network outcome). This is NOT a realized-P&L or exchange-wide loss cap.
export function berlinTradingDay(now=Date.now()){
 if(!Number.isFinite(now))throw Error('Invalid timestamp');
 const parts=new Intl.DateTimeFormat('en-GB',{
  timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(new Date(now));
 const field=type=>parts.find(p=>p.type===type)?.value;
 const year=field('year'),month=field('month'),day=field('day');
 if(!/^\d{4}$/.test(year||'')||!/^\d{2}$/.test(month||'')||!/^\d{2}$/.test(day||''))
  throw Error('Cannot verify trial trading day');
 return year+'-'+month+'-'+day;
}
export function dayTradeKey(now=Date.now()){
 return 'trading/trial-one-order-per-day/'+berlinTradingDay(now)+'.json';
}
