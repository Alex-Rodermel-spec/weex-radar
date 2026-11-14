// Bounded research-only source generator for six pre-registered V110 rules.
// It emits inert proposal code under research/, never edits or imports live
// №108 code; human approval and independent forward evidence remain mandatory.
import {V110_PROPOSAL_POLICY_IDS} from './v110-owner-proposal.mjs';

export function buildV110CandidateModule(policyId){
 if(!V110_PROPOSAL_POLICY_IDS.includes(policyId))return null;
 const side=policyId.startsWith('LONG_')?'LONG':'SHORT';
 const usesCaution=policyId.endsWith('_CAUTION')||
  policyId.endsWith('_CAUTION_CHASE');
 const usesChase=policyId.endsWith('_CHASE');
 return `// PROPOSED POLICY: RESEARCH-ONLY, NOT CONNECTED TO LIVE SIGNALS.
// Generated from a fixed allowlist; this module MUST NOT be imported by
// №108 until independent prospective testing and explicit owner approval.
// This is NOT an executable order rule and does not imply profitability.
export const CANDIDATE=Object.freeze({
 id:${JSON.stringify(policyId)},
 side:${JSON.stringify(side)},
 excludeCaution:${usesCaution},
 excludeAlreadyMoved10bps:${usesChase},
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
`;
}
