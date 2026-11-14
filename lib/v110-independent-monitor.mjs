// Read-only directional quality monitor. Requires independent, time-stamped forward outcomes.
const H=[1,5,10,15,30];
const validTime=x=>Number.isFinite(Date.parse(x));
export function evaluateV110IndependentMonitor({baseline,candidate,now=Date.now(),minSamples=50,maxAgeMs=15*60_000}={}){
 const unsafe=reason=>({status:'UNSAFE',reason,fresh:false,healthy:false,qualityNonRegressing:false,observations:0,canTrade:false});
 if(!Array.isArray(baseline)||!Array.isArray(candidate)||!Number.isFinite(now)||baseline.length>10000||candidate.length>10000)return unsafe('INVALID_INPUT');
 const valid=rows=>rows.filter(r=>r&&['LONG','SHORT'].includes(r.direction)&&H.includes(r.horizonMinutes)&&
 Number.isFinite(r.signedMoveBps)&&validTime(r.observedAt)&&Date.parse(r.observedAt)<=now&&
 r.source==='independent-forward'&&r.outcomeKnownAt&&validTime(r.outcomeKnownAt)&&Date.parse(r.outcomeKnownAt)<=now);
 const b=valid(baseline),c=valid(candidate);
 if(b.length<minSamples||c.length<minSamples)return unsafe('INSUFFICIENT_INDEPENDENT_OUTCOMES');
 const latest=Math.max(...c.map(r=>Date.parse(r.observedAt)));
 if(now-latest>maxAgeMs)return unsafe('STALE_OUTCOMES');
 const rate=rows=>rows.filter(r=>r.signedMoveBps>0).length/rows.length;
 const baseRate=rate(b),candidateRate=rate(c);
 const nonRegressing=candidateRate>=baseRate;
 return {status:nonRegressing?'HEALTHY':'UNSAFE',reason:nonRegressing?'NONREGRESSING':'DIRECTIONAL_REGRESSION',
 fresh:true,healthy:nonRegressing,qualityNonRegressing:nonRegressing,observations:c.length,
 baselineAccuracy:baseRate,candidateAccuracy:candidateRate,canTrade:false,
 note:'Descriptive comparison only; not proof of significance or deploy readiness.'};
}
