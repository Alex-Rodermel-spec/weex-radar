// Read-only decision layer for 5m confirmed signals. No trade orders,
// push suppression, risk parameter changes or estimates of win probability.
// Uses the SAME checks already displayed in phone notifications.
import {alertPresentation} from './alert-presentation.mjs';
import {COST_MIN_NET_RR} from './net-costs.mjs';

const descriptions={
 trend_mismatch:'Тренд 5м и 15м не согласован',
 no_breakout:'Нет свежего пробоя с подходящим RSI',
 candle_quality:'Пробойная свеча слишком рискованная',
 live_price:'Свежая цена уже не подходит для входа',
 risk_reward:'Недостаточно прибыли относительно риска или близко препятствие',
 sideways:'Слабый пробой боковика',
 expired:'Сигнал уже устарел',
 quote_unavailable:'Свежая биржевая котировка недоступна',
 data_unavailable:'Нет надёжных рыночных данных',
 unknown:'Условия не подтверждены'
};
const statuses=['REVIEW','WAIT','SKIP','NO_SETUP','UNAVAILABLE'];

export function adviseSymbol(s,now=Date.now()){
 const common={
  symbol:s?.symbol||null,
  direction:['LONG','SHORT'].includes(s?.direction)?s.direction:null,
  trend15:s?.indicators?.trend15==='UP'?'UP':
   s?.indicators?.trend15==='DOWN'?'DOWN':null,
  exchange:s?.exchange||null,
  expiresAt:Number.isFinite(s?.expiresAt)?s.expiresAt:null,
  entry:Number.isFinite(s?.livePrice)&&s.livePrice>0?s.livePrice:null,
  stop:Number.isFinite(s?.stop)&&s.stop>0?s.stop:null,
  take:Number.isFinite(s?.take)&&s.take>0?s.take:null,
  grossRR:Number.isFinite(s?.entryQuality?.rr)?s.entryQuality.rr:null,
  netRR:s?.costReview?.mode==='SHADOW_COSTS'&&
   Number.isFinite(s.costReview.netRR)?s.costReview.netRR:null,
  modelOnly:true
 };
 const result=(status,reason)=>({...common,status,reason});
 if(s?.status!=='ok')return result('UNAVAILABLE','Биржевые данные недоступны');
 const stage=s?.filterDiagnostic?.stage;
 if(!common.direction){
  return result('NO_SETUP',descriptions[stage]||'Нет подтверждённого входа');
 }
 // This layer is informational. Never extend a scanner's 3-minute expiry.
 if(!Number.isFinite(s?.expiresAt)||s.expiresAt<=now+15000)
  return result('SKIP','Времени до окончания сигнала слишком мало');
 if(!Number.isFinite(s?.livePrice)||s.livePrice<=0)
  return result('SKIP','Нет подтверждённой свежей котировки');
 if(!s.entryQuality?.ok)
  return result('SKIP','Не пройдена проверка риска и уровней');
 // For Bybit the WEEX fee model is deliberately inapplicable.
 if(s.exchange!=='WEEX'||s.costReview?.mode!=='SHADOW_COSTS')
  return result('WAIT','Расходы этой биржи не проверены');
 const action=alertPresentation(s);
 if(action.status==='SKIP')return result('SKIP',action.reason);
 // Cost model must be explicitly positive; unknown is NOT a green light.
 if(s.costReview.status!=='PASS_ESTIMATE'||!(s.costReview.netRR>=COST_MIN_NET_RR))
  return result('SKIP','После предполагаемых расходов вход не подходит');
 // A just-rejected breakout of the SAME direction makes a fresh
 // positive manual-review label premature. Leave core signals unchanged.
 const recent=s.levelReview?.recentFakeouts?.[common.direction];
 if(Number.isInteger(recent?.barsAgo)&&recent.barsAgo<=2)
  return result('WAIT','Недавний ложный пробой уровня '+recent.level+
   ' — дождись нового удержания и проверь риск');
 if(action.status==='CHECK')return result('REVIEW',
  'Расходы и ретест проверены; перепроверь цену вручную перед решением');
 return result('WAIT',action.reason);
}

export function summarizeAdvisor(symbols,now=Date.now()){
 const decisions=(Array.isArray(symbols)?symbols:[]).map(s=>adviseSymbol(s,now));
 const counts=Object.fromEntries(statuses.map(k=>[k,0]));
 for(const d of decisions)counts[d.status]++;
 return {
  mode:'READ_ONLY_MANUAL_REVIEW',
  timestamp:now,
  counts,
  marketCount:decisions.length,
  notices:{
   actions:'REVIEW means check manually, NOT permission to place an order.',
   fees:'WEEX fee/slippage model is illustrative; real account fees and execution can differ.',
   evidence:'The live strategy has not demonstrated profitability.',
   orders:'This endpoint never places trades and does not alter push or scanner thresholds.'
  }
 };
}
