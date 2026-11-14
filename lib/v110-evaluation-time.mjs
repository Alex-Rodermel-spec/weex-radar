// Strict independent evaluation-time validation for new forward journal exports.
// outcomeKnownAt is publication/availability time, NOT the target price sampling time.
const H=new Set([1,5,10,15,30]);
export function validateV110EvaluationTimes(rows,{toleranceMs=5000}={}){
 if(!Array.isArray(rows)||rows.length>10000||!Number.isInteger(toleranceMs)||toleranceMs<0||toleranceMs>30000)
  return {status:'INVALID_INPUT',valid:[],rejected:[]};
 const valid=[],rejected=[];
 for(const r of rows){
  const start=Date.parse(r?.observedAt),sample=Date.parse(r?.evaluatedAt),known=Date.parse(r?.outcomeKnownAt);
  const expected=r?.horizonMinutes*60000;
  const ok=H.has(r?.horizonMinutes)&&typeof r?.evaluatedAt==='string'&&
   Number.isFinite(start)&&Number.isFinite(sample)&&Number.isFinite(known)&&
   Math.abs(sample-start-expected)<=toleranceMs&&known>=sample;
  (ok?valid:rejected).push(r);
 }
 return {status:'VALIDATED',valid,rejected};
}
