// Read-only classification of one live 5m scan. Stages describe the FIRST gate
// not passed, never a missed profitable trade or a count of unique opportunities.
export const STAGES=Object.freeze([
 'trend_mismatch','no_breakout','candle_quality','live_price',
 'risk_reward','sideways','expired','ready','quote_unavailable',
 'data_unavailable','unknown'
]);

export function classifyFilterStage({candidate,hasAlignedTrend,quality,
 priceQuality,entryQuality,sidewaysGate,active}){
 if(!candidate)return hasAlignedTrend?'no_breakout':'trend_mismatch';
 if(quality?.ok!==true)return 'candle_quality';
 if(priceQuality?.ok!==true)return 'live_price';
 if(entryQuality?.ok!==true)return 'risk_reward';
 if(sidewaysGate?.blocked)return 'sideways';
 return active?'ready':'expired';
}

export function summarizeFilterDiagnostics(symbols){
 const counts=Object.fromEntries(STAGES.map(stage=>[stage,0]));
 for(const symbol of Array.isArray(symbols)?symbols:[]){
  const stage=symbol?.status==='ok'?symbol?.filterDiagnostic?.stage:'data_unavailable';
  counts[STAGES.includes(stage)?stage:'unknown']++;
 }
 return {
  unit:'Current 16-market snapshot (not unique signals or profitable trades)',
  scanned:Array.isArray(symbols)?symbols.length:0,
  noSetup:counts.trend_mismatch+counts.no_breakout,
  candidatesBlocked:counts.candle_quality+counts.live_price+
   counts.risk_reward+counts.sideways+counts.expired+counts.quote_unavailable,
  ready:counts.ready,
  unavailable:counts.data_unavailable+counts.unknown,
  counts
 };
}
