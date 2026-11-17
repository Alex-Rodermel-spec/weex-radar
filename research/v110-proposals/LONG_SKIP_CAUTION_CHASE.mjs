// PROPOSED POLICY: RESEARCH-ONLY, NOT CONNECTED TO LIVE SIGNALS.
// Generated from a fixed allowlist; this module MUST NOT be imported by
// №108 until independent prospective testing and explicit owner approval.
// This is NOT an executable order rule and does not imply profitability.
export const CANDIDATE=Object.freeze({
 id:"LONG_SKIP_CAUTION_CHASE",
 side:"LONG",
 excludeCaution:true,
 excludeAlreadyMoved10bps:true,
 status:'FORWARD_TEST_REQUIRED',
 approvedForLive:false
});
export function researchDecision(row){
 if(!row||row.direction!==CANDIDATE.side)return 'NOT_APPLICABLE';
 if(!['STRONG','STANDARD','CAUTION'].includes(row.strength))return 'UNKNOWN';
 if(CANDIDATE.excludeCaution&&row.strength==='CAUTION')return 'EXCLUDE';
 if(CANDIDATE.excludeAlreadyMoved10bps){
  // Missing pre-publication value is UNKNOWN, not evidence of a safe entry.
  if(typeof row.preMove5mBps!=='number'||
     !Number.isFinite(row.preMove5mBps))return 'UNKNOWN';
  if(row.preMove5mBps>=10)return 'EXCLUDE';
 }
 return 'ELIGIBLE_FOR_RESEARCH';
}
